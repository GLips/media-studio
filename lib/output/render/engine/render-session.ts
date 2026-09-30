// render-session.ts: one project bundled for rendering, and what every render command does with it. Node only.
//
// Each session bundles just its own project, so another project's missing captures can't break it.
//
// renderVideo (renderTransparentVideo, for a transparent format) is the one way the composition reaches a video file,
// and it writes the render's snapshot beside it: a render made any other way would be a file with no known timeline.
// A video joined from its slices writes one too. Stills and frame files write none: they're working images a command
// reads, not renders anyone reviews.
//
// Every render runs in a browser of its own whose GPU backends are checked, on the session's workers, and is timed:
// `passes` holds each pass's seconds.
import { renderFrames, renderMedia, selectComposition, type HeadlessBrowser, type OnArtifact, type RenderFramesOptions, type RenderMediaOptions } from '@remotion/renderer';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { availableParallelism, getPriority, setPriority } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { VideoConfig } from 'remotion';
import { projectSlug, replaySlug } from './project-bundle.ts';
import { readProjectCapability } from '#lib/platform/project/engine/studio-project.ts';
import { bundleStudioProject } from './studio-bundle.ts';
import { runFfmpeg, runFfmpegAsync } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { writeRenderSnapshot, type RenderSnapshot } from './render-snapshot.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { readProjectClock } from './project-clock.ts';
import { renderVoiceOf } from '#lib/timing/voice/engine/voice-project.ts';
import { inRenderBrowser, RENDER_CHROMIUM } from './render-browser.ts';
import type { MotionTracks } from '#lib/picture/measurement/models/motion-tracks.ts';
import type { CompositionRenderSettings, ReplayProps, VideoProps } from '#lib/picture/video/models/composition-props.ts';
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';

export type RenderSession = Awaited<ReturnType<typeof openRenderSession>>;

/** What a session fills in on every render: its own bundle, composition, browser and tab count. */
type SessionRenderOptions = 'composition' | 'serveUrl' | 'chromiumOptions' | 'inputProps' | 'concurrency' | 'puppeteerInstance';

/** What renderVideo decides itself: the codec, the file, the frames (every one, as its snapshot says) and the sound. */
type VideoRenderOptions = SessionRenderOptions | 'codec' | 'outputLocation' | 'frameRange' | 'everyNthFrame' | 'muted' | 'audioCodec' | 'separateAudioTo';

/**
 * The timeline report's file name: the artifact frame 0 emits (Video.tsx's TIMELINE_ARTIFACT, which Node can't load
 * from a .tsx), and the check's report in out/check/.
 */
export const TIMELINE_REPORT_NAME = 'timeline.json';

/** The delivered soundtrack's codec: a mastered mix is muxed with it, and checked through the same encode. */
export const DELIVERY_AUDIO_CODEC = ['-c:a', 'aac', '-b:a', '192k'] as const;

/**
 * Tabs a render runs at once, unless the command's --workers or the video's `renderWorkers` says otherwise. The tabs
 * share one GPU, so more don't draw faster: on a 10-core M1 Max the showcase delivered in the same time on 2, 3, 5 or
 * 9, and checked fastest on 3, while fewer left the machine's own apps far more of it.
 */
export const DEFAULT_RENDER_WORKERS = Math.min(3, Math.max(1, availableParallelism() - 1));

/**
 * The niceness a render runs at, which its browsers and ffmpeg inherit: the machine's own apps come first, and a
 * render on an otherwise idle machine loses nothing.
 */
const RENDER_NICENESS = 10;

/** One timed pass of a command's renders: `workers` and `gpu` where it rendered frames. */
export type RenderPass = { pass: string; seconds: number; workers?: number; gpu?: string };

/** `workers` overrides the video's `renderWorkers` and DEFAULT_RENDER_WORKERS, as a command's --workers does. */
export async function openRenderSession(project: string, { workers }: { workers?: number } = {}) {
  if (workers !== undefined && !(Number.isInteger(workers) && workers > 0)) throw new Error(`--workers is ${workers}: give a whole number above 0`);
  // Only ever lower: raising a process's priority back takes root.
  if (getPriority() < RENDER_NICENESS) setPriority(RENDER_NICENESS);
  const opened = performance.now();
  const serveUrl = await bundleStudioProject(project);
  const passes: RenderPass[] = [{ pass: 'bundle', seconds: (performance.now() - opened) / 1000 }];
  // Read with the bundle, so every snapshot the session writes holds the clock its renders were made on.
  const clock = (await readProjectClock(project)) ?? null;
  // A silent video delivers with no mix and no audio track (render-pipeline.ts).
  const silent = (await readProjectCapability(project)) === 'silent';
  const props = (p: Partial<VideoProps> = {}): VideoProps => ({ captions: false, probe: false, blockouts: false, ...p });
  const compositionFor = (inputProps: VideoProps, browser?: HeadlessBrowser) =>
    selectComposition({ serveUrl, chromiumOptions: RENDER_CHROMIUM, id: projectSlug(project), inputProps, puppeteerInstance: browser });

  /** Tabs for a render of `composition`: the session's `workers`, else the video's `renderWorkers`, else the default. */
  function workersFor(composition: VideoConfig): number {
    const { renderWorkers } = composition.defaultProps as CompositionRenderSettings;
    if (renderWorkers !== undefined && !(Number.isInteger(renderWorkers) && renderWorkers > 0)) {
      throw new Error(`the video's renderWorkers is ${renderWorkers}: give a whole number above 0`);
    }
    return workers ?? renderWorkers ?? DEFAULT_RENDER_WORKERS;
  }

  /** Runs `run` and records it as `pass`. */
  async function timed<T>(pass: string, run: () => Promise<T> | T, more: Omit<RenderPass, 'pass' | 'seconds'> = {}): Promise<T> {
    const started = performance.now();
    const result = await run();
    passes.push({ pass, seconds: (performance.now() - started) / 1000, ...more });
    return result;
  }

  /** Renders in a browser of its own (see render-browser.ts), recording the pass with the GPU backends it had. */
  async function inBrowser<T>(pass: string, render: (browser: HeadlessBrowser) => Promise<{ result: T; workers?: number }>): Promise<T> {
    const started = performance.now();
    const { result: { result, workers: used }, gpu } = await inRenderBrowser(render);
    passes.push({ pass, seconds: (performance.now() - started) / 1000, workers: used, gpu });
    return result;
  }

  async function renderFrameImages(dir: string, composition: VideoConfig, inputProps: Record<string, unknown>, frames: number[], browser: HeadlessBrowser, { w = composition.width, concurrency = workersFor(composition), lossless = false } = {}) {
    mkdirSync(dir, { recursive: true });
    await renderFrames({
      composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, puppeteerInstance: browser, inputProps, outputDir: dir, scale: w / composition.width, frames,
      ...(lossless ? { imageFormat: 'png' } : { imageFormat: 'jpeg', jpegQuality: 90 }),
      concurrency, imageSequencePattern: 'f-[frame].[ext]', onStart: () => {}, onFrameUpdate: () => {},
    });
    const files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/.test(f));
    if (files.length !== frames.length) throw new Error(`rendered ${files.length} of ${frames.length} stills`);
    // renderFrames pads the frame number to the composition's length, so match by value.
    const byFrame = new Map(files.map((f) => [Number(/f-(\d+)/.exec(f)![1]), join(dir, f)]));
    return { result: { fileFor: (frame: number) => byFrame.get(frame)! }, workers: concurrency };
  }

  /**
   * Renders chosen frames as JPEGs `w` wide (the video's own width unless given) into `dir`, a new or empty folder the
   * caller owns, in `tabs` at once (the render's, unless given); returns each frame's file. Repeats are rendered once.
   * `lossless` writes PNGs, for comparing frames: JPEG can round a ±1 difference away.
   */
  function renderStills(dir: string, wanted: number[], { w, captions = false, tabs, lossless }: { w?: number; captions?: boolean; tabs?: number; lossless?: boolean } = {}) {
    const inputProps = props({ captions });
    return inBrowser('stills', async (browser) => {
      const composition = await compositionFor(inputProps, browser);
      return renderFrameImages(dir, composition, inputProps, [...new Set(wanted)], browser, { w, concurrency: tabs ?? workersFor(composition), lossless });
    });
  }

  /**
   * Renders the video's frames in `order`, one after another in a single tab, so each has the history it's given, into
   * `dir`, a new or empty folder the caller owns, as PNGs, to compare with stills rendered `lossless`. `fileFor(i)` is
   * the render of order[i].
   */
  function renderReplay(dir: string, order: number[]) {
    const inputProps: ReplayProps = { ...props(), order };
    return inBrowser('replay', async (browser) => {
      const composition = await selectComposition({ serveUrl, chromiumOptions: RENDER_CHROMIUM, puppeteerInstance: browser, id: replaySlug(project), inputProps });
      return renderFrameImages(dir, composition, inputProps, order.map((_, i) => i), browser, { concurrency: 1, lossless: true });
    });
  }

  /**
   * Renders `frames` with no image, only to collect the artifacts they emit (the timeline report on frame 0, a
   * probe's measurements on every frame), into `onArtifact`.
   */
  function measureFrames(pass: string, frames: number[], inputProps: VideoProps, onArtifact: OnArtifact) {
    return inBrowser(pass, async (browser) => {
      const composition = await compositionFor(inputProps, browser), concurrency = Math.min(workersFor(composition), frames.length);
      await withStudioTemp('measure', (outputDir) => renderFrames({
        composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, puppeteerInstance: browser, inputProps, outputDir, concurrency,
        imageFormat: 'none', frames, onArtifact, onStart: () => {}, onFrameUpdate: () => {},
      }));
      return { result: composition, workers: concurrency };
    });
  }

  /** The timeline as the composition lays it out, from the report frame 0 emits. */
  async function readTimeline(): Promise<TimelineReport> {
    const sink = artifactSink();
    await measureFrames('timeline', [0], props(), sink.onArtifact);
    return sink.json<TimelineReport>(TIMELINE_REPORT_NAME);
  }

  /**
   * The video, or `frames` of it, as an H.264 file at `out`, with its snapshot. Its sound is the composition's, none
   * (`muted`), or kept apart (`separateSound`) as a wav handed to `approve`.
   *
   * `approve` runs after the picture renders, before `out` is written: it can refuse by throwing, and returns a
   * `soundtrack` wav to mux in and any `motion` it measured.
   */
  async function renderVideo({ out, frames, muted = false, separateSound = false, timeline, approve, inputProps = props(), onProgress, ...options }: Omit<RenderMediaOptions, VideoRenderOptions> & {
    out: string; frames?: RenderSnapshot['frames']; muted?: boolean; separateSound?: boolean; timeline?: TimelineReport; inputProps?: VideoProps;
    approve?: (rendered: { sound?: string }) => Promise<{ soundtrack?: string; motion?: MotionTracks }>;
  }): Promise<string> {
    const name = basename(out);
    mkdirSync(dirname(out), { recursive: true });
    return withStudioTemp('video', async (tmp) => {
      const picture = join(tmp, name), sound = separateSound ? join(tmp, 'sound.wav') : undefined;
      const started = performance.now();
      let framesDrawn: number | undefined, concurrency = 0;
      const { result: composition, gpu } = await inRenderBrowser(async (browser) => {
        const composition = await compositionFor(inputProps, browser);
        concurrency = workersFor(composition);
        const count = frames ? frames.end - frames.from : composition.durationInFrames;
        await renderMedia({
          ...options,
          onProgress: (progress) => {
            if (framesDrawn === undefined && progress.renderedFrames === count) framesDrawn = performance.now();
            onProgress?.(progress);
          },
          composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, puppeteerInstance: browser, concurrency, inputProps, codec: 'h264',
          outputLocation: picture, muted, ...(sound && { separateAudioTo: sound }), ...(frames && { frameRange: [frames.from, frames.end - 1] }),
        });
        return composition;
      });
      // Encoding runs beside the frames; what's left of it once they're all drawn is the encode's own time.
      const ended = performance.now();
      framesDrawn ??= ended;
      passes.push({ pass: `${name} frames`, seconds: (framesDrawn - started) / 1000, workers: concurrency, gpu }, { pass: `${name} encode`, seconds: (ended - framesDrawn) / 1000 });
      const { soundtrack, motion } = (await approve?.({ sound })) ?? {};
      if (soundtrack) {
        await timed(`${name} mux`, () => runFfmpeg(['-y', '-v', 'error', '-i', picture, '-i', soundtrack, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...DELIVERY_AUDIO_CODEC, '-movflags', '+faststart', out]));
      } else {
        copyFileSync(picture, out);
      }
      writeRenderSnapshot(out, { frames: frames ?? { from: 0, end: composition.durationInFrames }, timeline: timeline ?? await readTimeline(), clock, voice: renderVoiceOf(project), gpu, motion });
      return out;
    });
  }

  /**
   * A transparent video with its alpha, silent, each file with its snapshot: VP9 in WebM at `webm` for Chrome and
   * Firefox, and HEVC with alpha through VideoToolbox (macOS only) at `mov` for Safari, which plays no VP9 alpha.
   * `approve` is renderVideo's, called once the frames are drawn and before either encode.
   */
  async function renderTransparentVideo({ webm, mov, timeline, inputProps = props(), onArtifact, approve, onProgress }: {
    webm: string; mov: string; timeline: TimelineReport; inputProps?: VideoProps; onArtifact?: OnArtifact;
    approve?: () => Promise<{ motion?: MotionTracks }>; onProgress?: (p: { progress: number }) => void;
  }): Promise<string[]> {
    // A second of 1080p PNGs is about 100 MB, so they go even when the render or an encode fails.
    await withStudioTemp('alpha', async (tmp) => {
      const { fps, durationInFrames } = await inBrowser(`${basename(webm)} frames`, async (browser) => {
        const composition = await compositionFor(inputProps, browser), concurrency = workersFor(composition);
        await renderFrames({
          composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, puppeteerInstance: browser, concurrency, inputProps, outputDir: tmp, imageFormat: 'png',
          imageSequencePattern: 'f-[frame].[ext]', ...(onArtifact && { onArtifact }), onStart: () => {},
          onFrameUpdate: (rendered) => onProgress?.({ progress: rendered / composition.durationInFrames }),
        });
        return { result: composition, workers: concurrency };
      });
      // The pass inBrowser just recorded holds the GL the frames were drawn on.
      const gpu = passes.at(-1)!.gpu!;
      const { motion } = (await approve?.()) ?? {};
      // Remotion pads the frame numbers, so the glob's order is the video's.
      const frames = ['-y', '-v', 'error', '-framerate', String(fps), '-pattern_type', 'glob', '-i', join(tmp, 'f-*.png')];
      // Tagged on the frames, which is what the encoders read: -color_primaries and the like are overridden by them. An
      // untagged HEVC's colours shift in AVFoundation, Safari's decoder.
      const bt709 = 'setparams=color_primaries=bt709:color_trc=bt709';
      await timed(`${basename(webm)} and ${basename(mov)} encode`, () => Promise.all([
        runFfmpegAsync([...frames, '-vf', `scale=out_color_matrix=bt709,format=yuva420p,${bt709}:colorspace=bt709`, '-c:v', 'libvpx-vp9', '-crf', '18',
          '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', webm]),
        // hvc1, not hev1, or Safari won't play it. Chromium's PNGs are straight alpha, but AVFoundation reads HEVC's as
        // premultiplied (a translucent colour brighter than its alpha comes out white), so it's premultiplied here, and
        // VP9's isn't. VideoToolbox converts to YUV itself, so the matrix is an encoder option.
        runFfmpegAsync([...frames, '-vf', `format=bgra,premultiply=inplace=1,${bt709}`, '-c:v', 'hevc_videotoolbox', '-pix_fmt', 'bgra', '-colorspace', 'bt709', '-q:v', '70', '-alpha_quality', '0.9',
          '-tag:v', 'hvc1', '-movflags', '+faststart', mov]),
      ]));
      for (const out of [webm, mov]) writeRenderSnapshot(out, { frames: { from: 0, end: durationInFrames }, timeline, clock, voice: renderVoiceOf(project), gpu, motion });
    });
    return [webm, mov];
  }

  /** The video's sound alone, as an uncompressed wav at `out`. */
  async function renderAudio({ out, inputProps = props() }: { out: string; inputProps?: VideoProps }): Promise<string> {
    await inBrowser('sound', async (browser) => {
      const composition = await compositionFor(inputProps, browser), concurrency = workersFor(composition);
      await renderMedia({ composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, puppeteerInstance: browser, concurrency, inputProps, codec: 'wav', outputLocation: out });
      return { result: undefined, workers: concurrency };
    });
    return out;
  }

  /** The video's frames as image files in `outputDir`, named by Remotion's `imageSequencePattern`. */
  async function renderFrameFiles(options: Omit<RenderFramesOptions, SessionRenderOptions | 'onStart' | 'onFrameUpdate'> & { inputProps?: VideoProps }) {
    const inputProps = options.inputProps ?? props();
    await inBrowser('frame files', async (browser) => {
      const composition = await compositionFor(inputProps, browser), concurrency = workersFor(composition);
      await renderFrames({
        onStart: () => {}, onFrameUpdate: () => {}, ...options,
        composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, puppeteerInstance: browser, concurrency, inputProps,
      });
      return { result: undefined, workers: concurrency };
    });
  }

  return {
    project, serveUrl, clock, silent, opened, passes, props, compositionFor, workersFor, timed, inBrowser,
    renderStills, renderReplay, measureFrames, readTimeline, renderVideo, renderTransparentVideo, renderAudio, renderFrameFiles,
  };
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

/**
 * The session's passes as a table, with the workers and GPU backends its renders had: where a command's time went. A
 * render's pass includes opening its browser. The wall-clock runs from the session's opening, so it also holds what
 * no pass times (judging a check, writing reports).
 */
export function formatRenderPasses({ passes, opened }: Pick<RenderSession, 'passes' | 'opened'>): string[] {
  const width = Math.max(...passes.map((p) => p.pass.length));
  const gpu = [...new Set(passes.flatMap((p) => (p.gpu ? [p.gpu] : [])))];
  const total = passes.reduce((sum, p) => sum + p.seconds, 0);
  const row = (pass: string, seconds: number, workers?: number) =>
    `  ${pass.padEnd(width)}  ${seconds.toFixed(1).padStart(6)}s${workers ? `  ${workers} worker${workers > 1 ? 's' : ''}` : ''}`;
  return [
    `timing, GPU ${gpu.join('; ') || 'unused'}:`,
    ...passes.map((p) => row(p.pass, p.seconds, p.workers)),
    row('passes', total),
    row('wall-clock', (performance.now() - opened) / 1000),
  ];
}
