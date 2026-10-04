// render-session.ts: one project bundled for rendering, and what every render command does with it. Node only.
//
// Each session bundles just its own project, so another project's missing captures can't break it.
//
// renderVideo (renderTransparentVideo, for a transparent format) is the one way the composition reaches a video file,
// writing the render's snapshot beside it: a render made any other way has no known timeline. Stills and frame files
// write none: they're working images a command reads, not renders anyone reviews.
//
// Frames are drawn in chunks, each in a watched browser of its own (render-chunks.ts); a video's are kept lossless and
// encoded once. A pass only measuring frames or gathering sound draws no picture.
import { renderFrames, renderMedia, selectComposition, type HeadlessBrowser, type OnArtifact } from '@remotion/renderer';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, getPriority, setPriority } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { VideoConfig } from 'remotion';
import { projectSlug, replaySlug } from './project-bundle.ts';
import { readProjectDeclaration } from '#lib/platform/project/engine/studio-project.ts';
import { bundleStudioProject } from './studio-bundle.ts';
import { refuseProjectPaintingErrors } from './render-preflight.ts';
import { countVideoFrames, runFfmpegAsync } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { writeRenderSnapshot, type RenderSnapshot } from './render-snapshot.ts';
import { renderInChunks } from './render-chunks.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { readProjectClock } from './project-clock.ts';
import { renderVoiceOf } from '#lib/timing/voice/engine/voice-project.ts';
import { wholeBrowserPageError } from '#lib/platform/browser/engine/browser-page-error.ts';
import { inRenderBrowser, RENDER_PAGE_OPTIONS } from '#lib/platform/browser/engine/render-browser.ts';
import { releaseStudioGpuLease } from '#lib/platform/gpu/engine/gpu-lease.ts';
import type { MotionTracks } from '#lib/picture/measurement/models/motion-tracks.ts';
import type { CompositionRenderSettings, PaintingValuesProp, ReplayProps, VideoProps } from '#lib/picture/video/models/composition-props.ts';
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
import type { LensMode } from '#lib/picture/lens/models/lens-mode.ts';

export type RenderSession = Awaited<ReturnType<typeof openRenderSession>>;

/**
 * The timeline report's file name: the artifact frame 0 emits (Video.tsx's TIMELINE_ARTIFACT, which Node can't load
 * from a .tsx), and the check's report in out/check/.
 */
export const TIMELINE_REPORT_NAME = 'timeline.json';

/** The delivered soundtrack's codec: a mastered mix is muxed with it, and checked through the same encode. */
export const DELIVERY_AUDIO_CODEC = ['-c:a', 'aac', '-b:a', '192k'] as const;

/** How a video's picture is encoded from its lossless frames: H.264 at `crf`, with x264's `preset`. */
export type VideoEncoding = { readonly crf: number; readonly preset: 'veryfast' | 'medium' | 'slow' };

/** A delivered video's encoding, and a slice's and a join's, which stand in for it. */
export const DELIVERY_ENCODING: VideoEncoding = { crf: 18, preset: 'slow' };

/**
 * A video's sound: `none`; `own`, the composition's, muxed in when any plays; or `apart`, a wav handed to the render's
 * `approve` to master.
 */
export type VideoSound = 'none' | 'own' | 'apart';

/**
 * Tabs a render runs at once, unless the command's --workers or the video's `renderWorkers` says otherwise. The tabs
 * share one GPU, so more don't draw faster: on a 10-core M1 Max the showcase delivered in the same time on 2, 3, 5 or
 * 9, and checked fastest on 3, while fewer left the machine's own apps far more of it.
 */
export const DEFAULT_RENDER_WORKERS = Math.min(3, Math.max(1, availableParallelism() - 1));

/**
 * Tabs a project that paints (its project.ts names styles) draws its picture in: one. Each tab solves its paint on a
 * device and cache of its own, so a second only repeats the first's solves on the same GPU.
 */
export const PAINTING_RENDER_WORKERS = 1;

/**
 * The niceness a render runs at, which its browsers and ffmpeg inherit: the machine's own apps come first, and a
 * render on an otherwise idle machine loses nothing.
 */
const RENDER_NICENESS = 10;

/** One timed pass of a command's renders: `workers` and `gpu` where it rendered frames. */
export type RenderPass = { pass: string; seconds: number; workers?: number; gpu?: string };

/** The pass a wait for the GPU lease is recorded as, so it never reads as a render's own time. */
const GPU_WAIT_PASS = 'waiting for the GPU';
/** A wait shorter than this is the lease's own bookkeeping, not a queue, and isn't recorded. */
const GPU_WAIT_RECORDED_SECONDS = 0.1;

/** How a chunk's frames are written: PNG, JPEG at a quality, or not at all (a pass that only measures). */
type FrameImage = { imageFormat: 'png' } | { imageFormat: 'jpeg'; jpegQuality: number } | { imageFormat: 'none' };

/** A frame's file in a folder of `f-<frame>` images: Remotion pads the number to the composition's length. */
function framesInDir(dir: string): (frame: number) => string {
  const byFrame = new Map(readdirSync(dir).filter((f) => /^f-\d+\.(jpe?g|png)$/.test(f)).map((f) => [Number(/f-(\d+)/.exec(f)![1]), join(dir, f)]));
  return (frame) => byFrame.get(frame)!;
}

/** A concat list of `files`, for ffmpeg's concat demuxer. */
const concatList = (files: readonly string[]) => files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n');

/**
 * `workers` overrides the video's `renderWorkers` and the default tabs, as a command's --workers does; `lens` is how
 * every render of the session draws the lens, as --lens says; `paintingValues`, what its paintings are painted at over
 * the scenes' values, as `studio look --set` checked them.
 */
export async function openRenderSession(
  project: string, { workers, lens = 'fast', paintingValues }: { workers?: number; lens?: LensMode; paintingValues?: PaintingValuesProp } = {},
) {
  if (workers !== undefined && !(Number.isInteger(workers) && workers > 0)) throw new Error(`--workers is ${workers}: give a whole number above 0`);
  // Only ever lower: raising a process's priority back takes root.
  if (getPriority() < RENDER_NICENESS) setPriority(RENDER_NICENESS);
  const opened = performance.now();
  const paintings = await refuseProjectPaintingErrors(project);
  const checked = performance.now();
  const serveUrl = await bundleStudioProject(project);
  const passes: RenderPass[] = [
    ...(paintings ? [{ pass: `${paintings} ${paintings === 1 ? 'painting' : 'paintings'} checked`, seconds: (checked - opened) / 1000 }] : []),
    { pass: 'bundle', seconds: (performance.now() - checked) / 1000 },
  ];
  // Read with the bundle, so every snapshot the session writes holds the clock its renders were made on.
  const clock = (await readProjectClock(project)) ?? null;
  const declaration = await readProjectDeclaration(project);
  // A silent video delivers with no mix and no audio track (render-pipeline.ts).
  const silent = declaration?.capability === 'silent', paints = Boolean(declaration?.styles?.length);
  const props = (p: Partial<VideoProps> = {}): VideoProps => ({ captions: false, probe: false, blockouts: false, lens, ...(paintingValues && { paintingValues }), ...p });
  const selectIn = (inputProps: VideoProps, browser: HeadlessBrowser) =>
    selectComposition({ ...RENDER_PAGE_OPTIONS, serveUrl, id: projectSlug(project), inputProps, puppeteerInstance: browser });
  /** The composition at `inputProps`, in `browser`, or with none in a render browser of its own, under the GPU lease. */
  async function compositionFor(inputProps: VideoProps, browser?: HeadlessBrowser): Promise<VideoConfig> {
    if (browser) return selectIn(inputProps, browser).catch((error: Error) => Promise.reject(wholeBrowserPageError(error)));
    const { result, waited } = await inRenderBrowser((own) => selectIn(inputProps, own));
    recordGpuWait(waited);
    return result;
  }

  /**
   * Tabs for a render of `composition` with `inputProps`: the session's `workers`, else the video's `renderWorkers`,
   * else PAINTING_RENDER_WORKERS for a painting project's picture, else the default.
   */
  function workersFor(composition: VideoConfig, { picture = true }: Partial<VideoProps> = {}): number {
    const { renderWorkers } = composition.defaultProps as CompositionRenderSettings;
    if (renderWorkers !== undefined && !(Number.isInteger(renderWorkers) && renderWorkers > 0)) {
      throw new Error(`the video's renderWorkers is ${renderWorkers}: give a whole number above 0`);
    }
    return workers ?? renderWorkers ?? (paints && picture ? PAINTING_RENDER_WORKERS : DEFAULT_RENDER_WORKERS);
  }

  /** Records the wait for the GPU lease an inRenderBrowser call reports, when it queued. */
  function recordGpuWait(waited: number) {
    if (waited >= GPU_WAIT_RECORDED_SECONDS) passes.push({ pass: GPU_WAIT_PASS, seconds: waited });
  }

  /** Runs `run` and records it as `pass`. */
  async function timed<T>(pass: string, run: () => Promise<T> | T, more: Omit<RenderPass, 'pass' | 'seconds'> = {}): Promise<T> {
    const started = performance.now();
    const result = await run();
    passes.push({ pass, seconds: (performance.now() - started) / 1000, ...more });
    return result;
  }

  /**
   * Renders in a browser of its own (see render-browser.ts), recording the pass with the GPU backends it had, and apart
   * from it any wait for the GPU lease.
   */
  async function inBrowser<T>(pass: string, render: (browser: HeadlessBrowser) => Promise<{ result: T; workers?: number }>): Promise<T> {
    const started = performance.now();
    const { result: { result, workers: used }, gpu, waited } = await inRenderBrowser(render);
    recordGpuWait(waited);
    passes.push({ pass, seconds: (performance.now() - started) / 1000 - waited, workers: used, gpu });
    return result;
  }

  /**
   * Draws `frames` chunk by chunk (render-chunks.ts) as `image` files into `into(chunk)`, `width` px wide (the
   * composition's unless given), in `tabs` (workersFor's unless given), each chunk handed to `take` once drawn.
   * Records the pass; returns the GPU, and whether any frame played sound.
   */
  async function drawChunks(pass: string, frames: readonly number[], inputProps: VideoProps | ReplayProps, { compose = (browser) => compositionFor(inputProps, browser), image, into, width, tabs, chunkFrames, onFrame, onArtifact, take }: {
    compose?: (browser: HeadlessBrowser) => Promise<VideoConfig>; image: FrameImage; into: (chunk: readonly number[]) => string; width?: number; tabs?: number;
    chunkFrames?: number; onFrame?: (frame: number) => void; onArtifact?: OnArtifact; take?: (chunk: readonly number[], dir: string) => Promise<void>;
  }): Promise<{ gpu: string; heard: boolean }> {
    const started = performance.now();
    let used = 0;
    const { gpu, drawn, waited } = await renderInChunks<{ dir: string; heard: boolean }>(frames, async (browser, chunk, watch) => {
      const composition = await compose(browser), outputDir = into(chunk);
      used = Math.min(tabs ?? workersFor(composition, inputProps), chunk.length);
      mkdirSync(outputDir, { recursive: true });
      const { assetsInfo } = await renderFrames({
        ...RENDER_PAGE_OPTIONS, ...watch, ...image, ...(onArtifact && { onArtifact }), composition, serveUrl, puppeteerInstance: browser, inputProps, outputDir,
        frames: [...chunk], concurrency: used, scale: (width ?? composition.width) / composition.width, imageSequencePattern: 'f-[frame].[ext]', onStart: () => {},
        onFrameUpdate: (count, frame, ms) => {
          watch.onFrameUpdate(count, frame, ms);
          onFrame?.(frame);
        },
      });
      return { dir: outputDir, heard: assetsInfo.assets.some(({ audioAndVideoAssets, inlineAudioAssets }) => audioAndVideoAssets.length + inlineAudioAssets.length > 0) };
    }, { ...(take && { take: (chunk, { dir }) => take(chunk, dir) }), ...(chunkFrames !== undefined && { chunkFrames }) });
    recordGpuWait(waited);
    passes.push({ pass, seconds: (performance.now() - started) / 1000 - waited, workers: used, gpu });
    return { gpu, heard: drawn.some(({ heard }) => heard) };
  }

  /**
   * Frames `from`–`end` (exclusive) drawn chunk by chunk into `dir`, each chunk kept as a lossless FFV1 file (with
   * its alpha when `alpha`) as the next draws. Returns a concat list of them in order, the GPU, and whether any frame
   * played sound.
   */
  async function drawLossless(pass: string, { from, end }: RenderSnapshot['frames'], { inputProps, dir, fps, alpha = false, onProgress, onArtifact }: {
    inputProps: VideoProps; dir: string; fps: number; alpha?: boolean; onProgress?: (p: { progress: number }) => void; onArtifact?: OnArtifact;
  }): Promise<{ list: string; gpu: string; heard: boolean }> {
    const frames = Array.from({ length: end - from }, (_, i) => from + i), seen = new Set<number>(), files: string[] = [];
    const drawn = await drawChunks(pass, frames, inputProps, {
      image: { imageFormat: 'png' }, into: (chunk) => join(dir, `frames-${chunk[0]}`), ...(onArtifact && { onArtifact }),
      onFrame: (frame) => onProgress?.({ progress: seen.add(frame).size / frames.length }),
      take: async (chunk, images) => {
        const file = join(dir, `chunk-${chunk[0]}.mkv`);
        // Remotion pads the frame numbers, so the glob's order is the video's.
        await runFfmpegAsync(['-y', '-v', 'error', '-framerate', String(fps), '-pattern_type', 'glob', '-i', join(images, 'f-*.png'),
          '-c:v', 'ffv1', '-level', '3', '-slices', '16', '-pix_fmt', alpha ? 'bgra' : 'bgr0', file]);
        rmSync(images, { recursive: true });
        files.push(file);
      },
    });
    const list = join(dir, 'chunks.txt');
    writeFileSync(list, concatList(files));
    return { list, ...drawn };
  }

  /**
   * Renders chosen frames as JPEGs `w` wide (the video's own width unless given) into `dir`, a new or empty folder the
   * caller owns, in `tabs` at once (the render's, unless given); returns each frame's file. Repeats are rendered once.
   * `lossless` writes PNGs, for comparing frames: JPEG can round a ±1 difference away.
   */
  async function renderStills(dir: string, wanted: number[], { w, captions = false, tabs, lossless }: { w?: number; captions?: boolean; tabs?: number; lossless?: boolean } = {}) {
    const frames = [...new Set(wanted)];
    await drawChunks('stills', frames, props({ captions }), {
      image: lossless ? { imageFormat: 'png' } : { imageFormat: 'jpeg', jpegQuality: 90 }, into: () => dir, ...(w !== undefined && { width: w }), ...(tabs !== undefined && { tabs }),
    });
    const fileFor = framesInDir(dir);
    const missing = frames.filter((frame) => !fileFor(frame));
    if (missing.length) throw new Error(`rendered ${frames.length - missing.length} of ${frames.length} stills: none of frame ${missing.join(', ')}`);
    return { fileFor };
  }

  /**
   * Renders the video's frames in `order`, one after another in a single tab and browser, so each has the history it's
   * given, into `dir`, a new or empty folder the caller owns, as PNGs, to compare with stills rendered `lossless`.
   * `fileFor(i)` is the render of order[i].
   */
  async function renderReplay(dir: string, order: number[]) {
    const inputProps: ReplayProps = { ...props(), order }, indices = order.map((_, i) => i);
    await drawChunks('replay', indices, inputProps, {
      compose: (browser) => selectComposition({ ...RENDER_PAGE_OPTIONS, serveUrl, puppeteerInstance: browser, id: replaySlug(project), inputProps }),
      image: { imageFormat: 'png' }, into: () => dir, tabs: 1, chunkFrames: indices.length,
    });
    return { fileFor: framesInDir(dir) };
  }

  /**
   * Renders `frames` with no picture, only to collect the artifacts they emit (the timeline report on frame 0, a
   * probe's measurements on every frame), into `onArtifact`. Drawing nothing, it runs in one browser.
   */
  function measureFrames(pass: string, frames: number[], inputProps: VideoProps, onArtifact: OnArtifact) {
    return withStudioTemp('measure', (dir) => drawChunks(pass, frames, { ...inputProps, picture: false }, {
      image: { imageFormat: 'none' }, into: () => dir, chunkFrames: frames.length, onArtifact,
    }));
  }

  /** The timeline as the composition lays it out, from the report frame 0 emits. */
  async function readTimeline(): Promise<TimelineReport> {
    const sink = artifactSink();
    await measureFrames('timeline', [0], props(), sink.onArtifact);
    return sink.json<TimelineReport>(TIMELINE_REPORT_NAME);
  }

  /**
   * The video, or `frames` of it, as H.264 at `out` encoded as `encoding` says, with its snapshot; with `lossless`,
   * its frames kept there too as FFV1, with theirs. `approve` runs after the picture renders, before `out` is
   * written: it may refuse by throwing, and returns a `soundtrack` wav to mux in and any `motion` it measured.
   */
  async function renderVideo({ out, frames, sound, encoding, lossless, timeline: given, approve, inputProps = props(), onProgress, onArtifact }: {
    out: string; frames?: RenderSnapshot['frames']; sound: VideoSound; encoding: VideoEncoding; lossless?: string; timeline?: TimelineReport; inputProps?: VideoProps;
    approve?: (rendered: { sound?: string }) => Promise<{ soundtrack?: string; motion?: MotionTracks }>;
    onProgress?: (p: { progress: number }) => void; onArtifact?: OnArtifact;
  }): Promise<string> {
    const timeline = given ?? await readTimeline(), span = frames ?? { from: 0, end: timeline.durationInFrames };
    const name = basename(out), count = span.end - span.from;
    mkdirSync(dirname(out), { recursive: true });
    return withStudioTemp('video', async (tmp) => {
      const drawn = await drawLossless(`${name} frames`, span, { inputProps, dir: tmp, fps: timeline.fps, ...(onProgress && { onProgress }), ...(onArtifact && { onArtifact }) });
      const picture = join(tmp, name), chunks = ['-f', 'concat', '-safe', '0', '-i', drawn.list];
      await timed(`${name} encode`, () => runFfmpegAsync(['-y', '-v', 'error', ...chunks, '-c:v', 'libx264', '-crf', String(encoding.crf), '-preset', encoding.preset,
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', picture]));
      const encoded = countVideoFrames(picture);
      if (encoded !== count) throw new Error(`${name} encoded ${encoded} frames of the ${count} drawn`);
      const wav = sound === 'apart' || (sound === 'own' && drawn.heard) ? await renderAudio({ out: join(tmp, 'sound.wav'), inputProps, frames: span }) : undefined;
      const { soundtrack, motion } = (await approve?.({ ...(sound === 'apart' && { sound: wav }) })) ?? {};
      const track = soundtrack ?? (sound === 'own' ? wav : undefined);
      if (track) {
        await timed(`${name} mux`, () => runFfmpegAsync(['-y', '-v', 'error', '-i', picture, '-i', track, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...DELIVERY_AUDIO_CODEC, '-movflags', '+faststart', out]));
      } else {
        copyFileSync(picture, out);
      }
      const made = { frames: span, timeline, clock, voice: renderVoiceOf(project), gpu: drawn.gpu };
      writeRenderSnapshot(out, { ...made, ...(motion && { motion }) });
      if (lossless) {
        await runFfmpegAsync(['-y', '-v', 'error', ...chunks, '-c', 'copy', lossless]);
        writeRenderSnapshot(lossless, made);
      }
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
    // A second of 1080p frames is a few hundred MB, so they go even when the render or an encode fails.
    await withStudioTemp('alpha', async (tmp) => {
      const { list, gpu } = await drawLossless(`${basename(webm)} frames`, { from: 0, end: timeline.durationInFrames }, {
        inputProps, dir: tmp, fps: timeline.fps, alpha: true, ...(onProgress && { onProgress }), ...(onArtifact && { onArtifact }),
      });
      const { motion } = (await approve?.()) ?? {};
      const frames = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list];
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
      for (const out of [webm, mov]) writeRenderSnapshot(out, { frames: { from: 0, end: timeline.durationInFrames }, timeline, clock, voice: renderVoiceOf(project), gpu, ...(motion && { motion }) });
    });
    return [webm, mov];
  }

  /** The video's sound alone, or `frames` of it, as an uncompressed wav at `out`, gathered with no picture drawn. */
  async function renderAudio({ out, inputProps = props(), frames }: { out: string; inputProps?: VideoProps; frames?: RenderSnapshot['frames'] }): Promise<string> {
    const heard = { ...inputProps, picture: false };
    await inBrowser('sound', async (browser) => {
      const composition = await compositionFor(heard, browser), concurrency = workersFor(composition, heard);
      await renderMedia({
        ...RENDER_PAGE_OPTIONS, composition, serveUrl, puppeteerInstance: browser, concurrency, inputProps: heard, codec: 'wav', outputLocation: out,
        ...(frames && { frameRange: [frames.from, frames.end - 1] }),
      });
      return { result: undefined, workers: concurrency };
    });
    return out;
  }

  /** The video's frames as `imageFormat` files in `outputDir`, each `f-<frame>`, its number padded to the video's length. */
  async function renderFrameFiles({ outputDir, imageFormat, inputProps = props() }: { outputDir: string; imageFormat: 'png' | 'jpeg'; inputProps?: VideoProps }) {
    const { durationInFrames } = await readTimeline();
    await drawChunks('frame files', Array.from({ length: durationInFrames }, (_, i) => i), inputProps, {
      image: imageFormat === 'png' ? { imageFormat } : { imageFormat, jpegQuality: 90 }, into: () => outputDir,
    });
  }

  return {
    project, serveUrl, clock, silent, paints, lens, opened, passes, props, compositionFor, workersFor, timed, inBrowser,
    renderStills, renderReplay, measureFrames, readTimeline, renderVideo, renderTransparentVideo, renderAudio, renderFrameFiles,
    /**
     * Gives the GPU back to the queue before the command ends, for a stretch that doesn't draw (a paid generation's
     * minutes). A render after it queues again.
     */
    doneDrawing: releaseStudioGpuLease,
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
