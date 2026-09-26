// render-session.ts: one project bundled for rendering, and what every render command does with it. Node only.
//
// Each session bundles just its own project (see project-bundle.ts), so another project's missing captures can't
// break it.
//
// renderVideo (renderTransparentVideo, for a transparent format) is the one way the composition reaches a video file,
// and it writes the render's snapshot beside it (lib/engine/snapshot/render-snapshot.ts): a render made any other way
// would be a file nothing can say the timeline of.
// A video joined from its slices (render-pipeline.ts's joinVideoSlices) writes one too.
// Stills and frame files write none: they're working images a command reads, not renders anyone reviews.
import { renderFrames, renderMedia, selectComposition, type OnArtifact, type RenderFramesOptions, type RenderMediaOptions } from '@remotion/renderer';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VideoConfig } from 'remotion';
import { projectSlug, replaySlug } from '../bundle/project-bundle.ts';
import { readProjectCapability } from '../project/studio-project.ts';
import { bundleStudioProject } from '../bundle/studio-bundle.ts';
import { runFfmpeg, runFfmpegAsync } from '../ffmpeg/ffmpeg.ts';
import { writeRenderSnapshot, type RenderSnapshot } from '../snapshot/render-snapshot.ts';
import { readProjectClock } from '../timeline/project-clock.ts';
import type { MotionTracks } from '#models/motion/motion-tracks.ts';
import type { ReplayProps } from '#studio/composition/Root.tsx';
import type { TimelineReport, VideoProps } from '#studio/composition/Video.tsx';

export type RenderSession = Awaited<ReturnType<typeof openRenderSession>>;

/** What a session fills in on every render: its own bundle, composition, browser and tab count. */
type SessionRenderOptions = 'composition' | 'serveUrl' | 'chromiumOptions' | 'inputProps' | 'concurrency';

/** What renderVideo decides itself: the codec, the file, the frames (every one, as its snapshot says) and the sound. */
type VideoRenderOptions = SessionRenderOptions | 'codec' | 'outputLocation' | 'frameRange' | 'everyNthFrame' | 'muted' | 'audioCodec';

/**
 * The timeline report's file name: the artifact frame 0 emits (Video.tsx's TIMELINE_ARTIFACT, which Node can't load
 * from a .tsx), and the check's report in out/check/.
 */
export const TIMELINE_REPORT_NAME = 'timeline.json';

/** The delivered soundtrack's codec: a mastered mix is muxed with it, and checked through the same encode. */
export const DELIVERY_AUDIO_CODEC = ['-c:a', 'aac', '-b:a', '192k'] as const;

/**
 * Every render's browser runs on the GPU. Painted layers (lib/paint) draw with WebGL, which Remotion's default
 * software renderer makes crawl.
 */
export const RENDER_CHROMIUM = { gl: 'angle' } as const;

/**
 * Tabs per render. Remotion's default is half the cores; frames are screenshot-bound, so all but one core renders
 * about 20% faster, at under 1 GB.
 */
export const RENDER_CONCURRENCY = Math.max(1, availableParallelism() - 1);

export async function openRenderSession(project: string) {
  const serveUrl = await bundleStudioProject(project);
  // Read with the bundle, so every snapshot the session writes holds the clock its renders were made on.
  const clock = (await readProjectClock(project)) ?? null;
  // A silent video delivers with no mix and no audio track (render-pipeline.ts).
  const silent = (await readProjectCapability(project)) === 'silent';
  const props = (p: Partial<VideoProps> = {}): VideoProps => ({ captions: false, probe: false, blockouts: false, ...p });
  const compositionFor = (inputProps: VideoProps) => selectComposition({ serveUrl, chromiumOptions: RENDER_CHROMIUM, id: projectSlug(project), inputProps });

  async function renderJpegs(composition: VideoConfig, inputProps: Record<string, unknown>, frames: number[], w = composition.width, concurrency = RENDER_CONCURRENCY) {
    const dir = mkdtempSync(join(tmpdir(), 'stills-'));
    await renderFrames({
      composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, inputProps, outputDir: dir, imageFormat: 'jpeg', jpegQuality: 90, scale: w / composition.width, frames,
      concurrency, imageSequencePattern: 'f-[frame].[ext]', onStart: () => {}, onFrameUpdate: () => {},
    });
    const files = readdirSync(dir).filter((f) => /\.jpe?g$/.test(f));
    if (files.length !== frames.length) throw new Error(`rendered ${files.length} of ${frames.length} stills`);
    // renderFrames pads the frame number to the composition's length, so match by value.
    const byFrame = new Map(files.map((f) => [Number(/f-(\d+)/.exec(f)![1]), join(dir, f)]));
    return { dir, fileFor: (frame: number) => byFrame.get(frame)! };
  }

  /** Renders chosen frames as JPEGs `w` wide (the video's own width unless given); returns each frame's file. Repeats are rendered once. */
  async function renderStills(wanted: number[], { w, captions = false }: { w?: number; captions?: boolean } = {}) {
    const inputProps = props({ captions });
    return renderJpegs(await compositionFor(inputProps), inputProps, [...new Set(wanted)], w);
  }

  /**
   * Renders the video's frames in `order`, one after another in a single tab, so each has the history it's given.
   * `fileFor(i)` is the render of order[i].
   */
  async function renderReplay(order: number[]) {
    const inputProps: ReplayProps = { ...props(), order };
    const composition = await selectComposition({ serveUrl, chromiumOptions: RENDER_CHROMIUM, id: replaySlug(project), inputProps });
    return renderJpegs(composition, inputProps, order.map((_, i) => i), composition.width, 1);
  }

  /** The timeline as the composition lays it out, from the report frame 0 emits. */
  async function readTimeline(): Promise<TimelineReport> {
    const sink = artifactSink();
    const inputProps = props();
    await renderFrames({
      composition: await compositionFor(inputProps), serveUrl, chromiumOptions: RENDER_CHROMIUM, inputProps, outputDir: mkdtempSync(join(tmpdir(), 'timeline-')), concurrency: RENDER_CONCURRENCY,
      imageFormat: 'none', frames: [0], onArtifact: sink.onArtifact, onStart: () => {}, onFrameUpdate: () => {},
    });
    return sink.json<TimelineReport>(TIMELINE_REPORT_NAME);
  }

  /**
   * The video, or `frames` of it, as an H.264 file at `out`, with its snapshot beside it. Its sound is the
   * composition's, none (`muted`), or a `soundtrack` wav muxed in its place. The snapshot holds `timeline` (read from
   * the composition when not given) and `motion` when the caller measured it.
   */
  async function renderVideo({ out, frames, muted = false, soundtrack, timeline, motion, inputProps = props(), ...options }: Omit<RenderMediaOptions, VideoRenderOptions> & {
    out: string; frames?: RenderSnapshot['frames']; muted?: boolean; soundtrack?: string; timeline?: TimelineReport; motion?: MotionTracks; inputProps?: VideoProps;
  }): Promise<string> {
    const composition = await compositionFor(inputProps);
    const tmp = soundtrack ? mkdtempSync(join(tmpdir(), 'video-')) : undefined;
    await renderMedia({
      onProgress: () => {}, ...options,
      composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, concurrency: RENDER_CONCURRENCY, inputProps, codec: 'h264',
      outputLocation: tmp ? join(tmp, 'silent.mp4') : out, muted: muted || Boolean(soundtrack), ...(frames && { frameRange: [frames.from, frames.end - 1] }),
    });
    if (tmp) {
      runFfmpeg(['-y', '-v', 'error', '-i', join(tmp, 'silent.mp4'), '-i', soundtrack!, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...DELIVERY_AUDIO_CODEC, '-movflags', '+faststart', out]);
      rmSync(tmp, { recursive: true, force: true });
    }
    writeRenderSnapshot(out, { frames: frames ?? { from: 0, end: composition.durationInFrames }, timeline: timeline ?? await readTimeline(), clock, motion });
    return out;
  }

  /**
   * A transparent video (VideoFormat.transparent) with its alpha, silent, each file with its snapshot: frames as PNGs,
   * which Remotion screenshots without the page's background, encoded to VP9 in WebM at `webm` for Chrome and Firefox,
   * and to HEVC with alpha through VideoToolbox (macOS only) at `mov` for Safari, which plays no VP9 alpha.
   */
  async function renderTransparentVideo({ webm, mov, timeline, motion, inputProps = props(), onProgress }: {
    webm: string; mov: string; timeline: TimelineReport; motion?: MotionTracks; inputProps?: VideoProps; onProgress?: (p: { progress: number }) => void;
  }): Promise<string[]> {
    const composition = await compositionFor(inputProps);
    const { fps, durationInFrames } = composition;
    const tmp = mkdtempSync(join(tmpdir(), 'alpha-'));
    // A second of 1080p PNGs is about 100 MB, so they go even when the render or an encode fails.
    try {
      await renderFrames({
        composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, concurrency: RENDER_CONCURRENCY, inputProps, outputDir: tmp, imageFormat: 'png',
        imageSequencePattern: 'f-[frame].[ext]', onStart: () => {}, onFrameUpdate: (rendered) => onProgress?.({ progress: rendered / durationInFrames }),
      });
      // Remotion pads the frame numbers, so the glob's order is the video's.
      const frames = ['-y', '-v', 'error', '-framerate', String(fps), '-pattern_type', 'glob', '-i', join(tmp, 'f-*.png')];
      // Tagged on the frames, which is what the encoders read: -color_primaries and the like are overridden by them. An
      // untagged HEVC's colours shift in AVFoundation, Safari's decoder.
      const bt709 = 'setparams=color_primaries=bt709:color_trc=bt709';
      await Promise.all([
        runFfmpegAsync([...frames, '-vf', `scale=out_color_matrix=bt709,format=yuva420p,${bt709}:colorspace=bt709`, '-c:v', 'libvpx-vp9', '-crf', '18',
          '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', webm]),
        // hvc1, not hev1, or Safari won't play it. Chromium's PNGs are straight alpha, but AVFoundation reads HEVC's as
        // premultiplied (a translucent colour brighter than its alpha comes out white), so it's premultiplied here, and
        // VP9's isn't. VideoToolbox converts to YUV itself, so the matrix is an encoder option.
        runFfmpegAsync([...frames, '-vf', `format=bgra,premultiply=inplace=1,${bt709}`, '-c:v', 'hevc_videotoolbox', '-pix_fmt', 'bgra', '-colorspace', 'bt709', '-q:v', '70', '-alpha_quality', '0.9',
          '-tag:v', 'hvc1', '-movflags', '+faststart', mov]),
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    for (const out of [webm, mov]) writeRenderSnapshot(out, { frames: { from: 0, end: durationInFrames }, timeline, clock, motion });
    return [webm, mov];
  }

  /** The video's sound alone, as an uncompressed wav at `out`. */
  async function renderAudio({ out, inputProps = props() }: { out: string; inputProps?: VideoProps }): Promise<string> {
    await renderMedia({
      composition: await compositionFor(inputProps), serveUrl, chromiumOptions: RENDER_CHROMIUM, concurrency: RENDER_CONCURRENCY, inputProps, codec: 'wav', outputLocation: out,
    });
    return out;
  }

  /** The video's frames as image files in `outputDir`, named by Remotion's `imageSequencePattern`. */
  async function renderFrameFiles(options: Omit<RenderFramesOptions, SessionRenderOptions | 'onStart' | 'onFrameUpdate'> & { inputProps?: VideoProps }) {
    const inputProps = options.inputProps ?? props();
    await renderFrames({
      onStart: () => {}, onFrameUpdate: () => {}, ...options,
      composition: await compositionFor(inputProps), serveUrl, chromiumOptions: RENDER_CHROMIUM, concurrency: RENDER_CONCURRENCY, inputProps,
    });
  }

  return { project, serveUrl, clock, silent, props, compositionFor, renderStills, renderReplay, readTimeline, renderVideo, renderTransparentVideo, renderAudio, renderFrameFiles };
}

/** Collects the artifacts a render emits, by name. */
export function artifactSink() {
  const files = new Map<string, string>();
  const onArtifact: OnArtifact = (a) => { files.set(a.filename, Buffer.from(a.content).toString('utf8')); };
  const json = <T,>(name: string): T => {
    const content = files.get(name);
    if (content === undefined) throw new Error(`no ${name} artifact`);
    return JSON.parse(content);
  };
  return { onArtifact, json, names: () => [...files.keys()] };
}
