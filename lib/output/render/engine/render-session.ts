// render-session.ts: one project bundled for rendering, and what every render command does with it. Node only.
//
// Each session bundles just its own project, so another project's missing captures can't break it.
//
// renderVideo (renderTransparentVideo, for a transparent format) is the one way the composition reaches a video file,
// writing the render's snapshot beside it: a render made any other way has no known timeline. Stills and frame files
// write none: they're working images a command reads, not renders anyone reviews.
//
// Every page opens in a watched browser (render-watch.ts); frames draw in chunks (render-chunks.ts), a video's kept
// lossless and encoded once. A pass only measuring frames or gathering sound draws no picture.
import { renderFrames, renderMedia, RenderInternals, selectComposition, type HeadlessBrowser, type OnArtifact } from '@remotion/renderer';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { getPriority, setPriority } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { VideoConfig } from 'remotion';
import { projectSlug, replaySlug } from './project-bundle.ts';
import { bundleStudioProject } from './studio-bundle.ts';
import { refuseProjectPaintingErrors } from './render-preflight.ts';
import { countVideoFrames, runFfmpegAsync } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { writeRenderSnapshot, type RenderSnapshot } from './render-snapshot.ts';
import { renderInChunks } from './render-chunks.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { openRenderLedger, renderGpuWaitSeconds, RENDER_SPAN_KINDS, RENDER_TRACE_PRODUCER, type RenderLedger } from './render-ledger.ts';
import { traceClock } from '#lib/platform/trace/engine/trace-collector.ts';
import type { TraceDetail } from '#lib/platform/trace/models/trace-detail.ts';
import { traceLabel, traceQuantity, type TraceSpan } from '#lib/platform/trace/models/trace-model.ts';
import { renderVoiceOf } from '#lib/timing/voice/engine/voice-project.ts';
import { RENDER_PAGE_OPTIONS } from '#lib/platform/browser/engine/render-browser.ts';
import { inWatchedRenderBrowser, watchedRenderFrames, watchedRenderMedia, type RenderWatch } from '#lib/platform/browser/engine/render-watch.ts';
import { releaseStudioGpuLease } from '#lib/platform/gpu/engine/gpu-lease.ts';
import type { MotionTracks } from '#lib/picture/measurement/models/motion-tracks.ts';
import type { CompositionRenderSettings, PaintingValuesProp, ReplayProps, VideoProps } from '#lib/picture/video/models/composition-props.ts';
import { timelineFrameText, type TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
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
 * The most tabs Remotion opens at once: the cores it counts, the fewer of Node's count and nproc's. A cloud container
 * (remote-render) counts only the cores it reserves, though it bursts past them, so a video's renderWorkers or its
 * sound pass's default would be refused there.
 */
const RENDER_CORES = RenderInternals.resolveConcurrency('100%');

/**
 * Tabs a render runs at once, unless the command's --workers or the video's `renderWorkers` says otherwise. The tabs
 * share one GPU, so more don't draw faster: on a 10-core M1 Max the showcase delivered in the same time on 2, 3, 5 or
 * 9, and checked fastest on 3, while fewer left the machine's own apps far more of it.
 */
const DEFAULT_RENDER_WORKERS = Math.min(3, Math.max(1, RENDER_CORES - 1));

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

/** How a chunk's frames are written: PNG, JPEG at a quality, or not at all (a pass that only measures). */
type FrameImage = { imageFormat: 'png' } | { imageFormat: 'jpeg'; jpegQuality: number } | { imageFormat: 'none' };

/** A frame's file in a folder of `f-<frame>` images: Remotion pads the number to the composition's length. */
function framesInDir(dir: string): (frame: number) => string {
  const byFrame = new Map(readdirSync(dir).filter((f) => /^f-\d+\.(jpe?g|png)$/.test(f)).map((f) => [Number(/f-(\d+)/.exec(f)![1]), join(dir, f)]));
  return (frame) => byFrame.get(frame)!;
}

/** A concat list of `files`, for ffmpeg's concat demuxer. */
export const concatList = (files: readonly string[]) => files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n');

/** The lossless frames concat list `list` names, encoded as `encoding` says to H.264 at `out`, silent. */
export function encodeLosslessList(list: string, out: string, encoding: VideoEncoding): Promise<void> {
  return runFfmpegAsync(['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-crf', String(encoding.crf), '-preset', encoding.preset,
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
}

/**
 * `picture`, `frames` long at `fps`, at `out` with `soundtrack` under it, encoded for delivery. The sound is padded past
 * the picture and cut half a frame after it, so the last frame keeps its sound and the file is the picture's length.
 */
export function muxDeliveredSound(picture: string, soundtrack: string, out: string, { frames, fps }: { frames: number; fps: number }): Promise<void> {
  return runFfmpegAsync(['-y', '-v', 'error', '-i', picture, '-i', soundtrack, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...DELIVERY_AUDIO_CODEC, '-af', 'apad',
    '-t', String((frames + 0.5) / fps), '-movflags', '+faststart', out]);
}

/**
 * How frames are drawn: of `inputProps`, in `compose`'s composition (the video's unless given), as `image` files
 * `width` px wide (the composition's unless given), in `tabs` (workersFor's unless given); each drawn told to
 * `onFrame`, its artifacts to `onArtifact`.
 */
type FrameDraw = {
  readonly inputProps: VideoProps | ReplayProps; readonly image: FrameImage; readonly compose?: (browser: HeadlessBrowser) => Promise<VideoConfig>;
  readonly width?: number; readonly tabs?: number; readonly onFrame?: (frame: number) => void; readonly onArtifact?: OnArtifact;
};

/** The lossless chunks `list` names, copied whole into one file at `out`, with its snapshot. */
async function keepLossless(list: string, out: string, made: Pick<RenderSnapshot, 'frames' | 'timeline' | 'clock' | 'voice' | 'gpu'>) {
  await runFfmpegAsync(['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  writeRenderSnapshot(out, made);
}

/**
 * `workers` overrides the video's `renderWorkers` and the default tabs (--workers); `lens`, how every render draws the
 * lens (--lens); `paintingValues`, what its paintings are painted at over the scenes' values (`studio look --set`);
 * `traceDetail`, the frames its renders trace in detail (--trace). `ledger`: one the command opened already (`studio
 * render`, for its history).
 */
export async function openRenderSession(project: string, { workers, lens = 'fast', paintingValues, traceDetail, ledger: opened }: {
  workers?: number; lens?: LensMode; paintingValues?: PaintingValuesProp; traceDetail?: TraceDetail; ledger?: RenderLedger;
} = {}) {
  if (workers !== undefined && !(Number.isInteger(workers) && workers > 0)) throw new Error(`--workers is ${workers}: give a whole number above 0`);
  // Only ever lower: raising a process's priority back takes root.
  if (getPriority() < RENDER_NICENESS) setPriority(RENDER_NICENESS);
  const ledger = opened ?? await openRenderLedger(project), { clock, paints, trace, recordGpuWait } = ledger;
  const checking = traceClock();
  const paintings = await refuseProjectPaintingErrors(project);
  if (paintings) trace.record(`${paintings} ${paintings === 1 ? 'painting' : 'paintings'} checked`, { start: checking, end: traceClock() });
  const serveUrl = await trace.run('bundle', () => bundleStudioProject(project));
  const props = (p: Partial<VideoProps> = {}): VideoProps => ({ captions: false, probe: false, blockouts: false, lens, ...(paintingValues && { paintingValues }), ...(traceDetail && { traceDetail }), ...p });
  const selectVideo = (inputProps: VideoProps, browser: HeadlessBrowser) => selectComposition({ ...RENDER_PAGE_OPTIONS, serveUrl, id: projectSlug(project), inputProps, puppeteerInstance: browser });
  /** The video's composition with `inputProps`, selected in `browser`, or in a watched one of its own, under the GPU lease. */
  async function compositionFor(inputProps: VideoProps, browser?: HeadlessBrowser): Promise<VideoConfig> {
    if (browser) return selectVideo(inputProps, browser);
    const start = traceClock();
    const { result, waited } = await inWatchedRenderBrowser((own) => selectVideo(inputProps, own), { pass: 'composition' });
    recordGpuWait(waited, { start, parent: null });
    return result;
  }

  /**
   * Tabs for a render of `composition` with `inputProps`: the session's `workers`, else the video's `renderWorkers`,
   * else PAINTING_RENDER_WORKERS for a painting project's picture, else the default; never more than RENDER_CORES.
   */
  function workersFor(composition: VideoConfig, { picture = true }: Partial<VideoProps> = {}): number {
    const { renderWorkers } = composition.defaultProps as CompositionRenderSettings;
    if (renderWorkers !== undefined && !(Number.isInteger(renderWorkers) && renderWorkers > 0)) {
      throw new Error(`the video's renderWorkers is ${renderWorkers}: give a whole number above 0`);
    }
    return Math.min(RENDER_CORES, workers ?? renderWorkers ?? (paints && picture ? PAINTING_RENDER_WORKERS : DEFAULT_RENDER_WORKERS));
  }

  /**
   * Renders in a watched browser of its own (render-watch.ts), `pass` naming it, recording the pass's span with the GPU
   * backends it had and the tabs `render` says it used, and under it any wait for the GPU lease.
   */
  async function inBrowser<T>(pass: string, render: (browser: HeadlessBrowser, watch: RenderWatch) => Promise<{ result: T; workers?: number }>): Promise<T> {
    return trace.run(pass, async (span) => {
      const start = traceClock();
      const { result: { result, workers: used }, gpu, waited } = await inWatchedRenderBrowser(render, { pass, trace: { trace, parent: span.id, name: pass } });
      recordGpuWait(waited, { start, parent: span });
      span.end({ ...(used !== undefined && { workers: { value: used, unit: 'tabs' } }), gpu });
      return result;
    });
  }

  /**
   * `frames` drawn as `draw` says by one renderFrames call in `browser`, under `watch`, into `outputDir` (null for
   * images of 'none'). Returns the tabs it drew in at once, and whether any frame played sound.
   */
  async function drawFrames(browser: HeadlessBrowser, watch: RenderWatch, frames: readonly number[], outputDir: string | null, draw: FrameDraw): Promise<{ concurrency: number; heard: boolean }> {
    const { inputProps, image, compose = (b: HeadlessBrowser) => selectVideo(inputProps, b), width, tabs, onFrame, onArtifact } = draw;
    const composition = await (watch.trace ? trace.run('composition select', () => compose(browser), { parent: watch.trace.parent }) : compose(browser)), concurrency = Math.min(tabs ?? workersFor(composition, inputProps), frames.length);
    if (outputDir) mkdirSync(outputDir, { recursive: true });
    const { assetsInfo } = await renderFrames({
      ...RENDER_PAGE_OPTIONS, ...watchedRenderFrames(watch, onFrame), ...image, ...(onArtifact && { onArtifact }), composition, serveUrl, puppeteerInstance: browser, inputProps,
      outputDir, frames: [...frames], concurrency, scale: (width ?? composition.width) / composition.width, imageSequencePattern: 'f-[frame].[ext]', onStart: () => {},
    });
    return { concurrency, heard: assetsInfo.assets.some(({ audioAndVideoAssets, inlineAudioAssets }) => audioAndVideoAssets.length + inlineAudioAssets.length > 0) };
  }

  /**
   * Frame `frame` as a failed render names it, by its scene in `timeline`. Read only when a frame fails for good, and
   * when not given; a timeline that can't be read then leaves the frame bare rather than hiding why it failed.
   */
  async function describeRenderFrame(frame: number, timeline?: TimelineReport): Promise<string> {
    const read = timeline ?? await readTimeline().catch(() => null);
    return read ? timelineFrameText(read, frame) : `frame ${frame}`;
  }

  /**
   * `frames` drawn chunk by chunk (render-chunks.ts) as `draw` says, each piece into `into(piece)` and handed to `take`
   * once drawn; a frame that fails is named by its scene in `timeline` (read then, when not given). Records the pass's
   * span, each chunk's under it; returns the GPU, and whether any frame played sound.
   */
  async function drawChunks(pass: string, frames: readonly number[], draw: FrameDraw, { into, take, timeline }: {
    into: (piece: readonly number[]) => string; take?: (piece: readonly number[], dir: string) => Promise<void>; timeline?: TimelineReport;
  }): Promise<{ gpu: string; heard: boolean }> {
    return trace.run(pass, async (span) => {
      let used = 0;
      const { gpu, drawn } = await renderInChunks<{ dir: string; heard: boolean }>(frames, async (browser, piece, watch) => {
        const dir = into(piece), { concurrency, heard } = await drawFrames(browser, watch, piece, dir, draw);
        used = Math.max(used, concurrency);
        return { dir, heard };
      }, {
        ...(take && { take: (piece, { dir }) => take(piece, dir) }), describeFrame: (frame) => describeRenderFrame(frame, timeline), spans: { trace, parent: span },
      });
      span.end({ workers: { value: used, unit: 'tabs' }, gpu, frames: { value: frames.length, unit: 'frames' } });
      return { gpu, heard: drawn.some(({ heard }) => heard) };
    });
  }

  /**
   * Frames `from`–`end` (exclusive) of `timeline` drawn chunk by chunk into `dir`, each piece kept as a lossless FFV1
   * file (with its alpha when `alpha`) as the next draws. Returns a concat list of them in order, the GPU, and whether
   * any frame played sound.
   */
  async function drawLossless(pass: string, { from, end }: RenderSnapshot['frames'], { inputProps, dir, timeline, alpha = false, onProgress, onArtifact }: {
    inputProps: VideoProps; dir: string; timeline: TimelineReport; alpha?: boolean; onProgress?: (p: { progress: number }) => void; onArtifact?: OnArtifact;
  }): Promise<{ list: string; gpu: string; heard: boolean }> {
    const frames = Array.from({ length: end - from }, (_, i) => from + i), seen = new Set<number>(), files: string[] = [];
    const drawn = await drawChunks(pass, frames, {
      inputProps, image: { imageFormat: 'png' }, ...(onArtifact && { onArtifact }), onFrame: (frame) => onProgress?.({ progress: seen.add(frame).size / frames.length }),
    }, {
      timeline,
      into: (piece) => {
        // Emptied first: a piece drawn again after its browser failed shares its first frame's folder with the failed
        // draw, whose frames past it would join its file.
        const images = join(dir, `frames-${piece[0]}`);
        rmSync(images, { recursive: true, force: true });
        return images;
      },
      take: async (piece, images) => {
        const file = join(dir, `chunk-${piece[0]}.mkv`);
        // Remotion pads the frame numbers, so the glob's order is the video's.
        await runFfmpegAsync(['-y', '-v', 'error', '-framerate', String(timeline.fps), '-pattern_type', 'glob', '-i', join(images, 'f-*.png'),
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
    await drawChunks('stills', frames, {
      inputProps: props({ captions }), image: lossless ? { imageFormat: 'png' } : { imageFormat: 'jpeg', jpegQuality: 90 }, ...(w !== undefined && { width: w }), ...(tabs !== undefined && { tabs }),
    }, { into: () => dir });
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
    await inBrowser('replay', async (browser, watch) => {
      const { concurrency } = await drawFrames(browser, watch, indices, dir, {
        inputProps, image: { imageFormat: 'png' }, tabs: 1,
        compose: (b) => selectComposition({ ...RENDER_PAGE_OPTIONS, serveUrl, puppeteerInstance: b, id: replaySlug(project), inputProps }),
      });
      return { result: undefined, workers: concurrency };
    });
    return { fileFor: framesInDir(dir) };
  }

  /**
   * Renders `frames` with no picture, only to collect the artifacts they emit (the timeline report on frame 0, a
   * probe's measurements on every frame), into `onArtifact`. Drawing nothing, it runs in one browser.
   */
  function measureFrames(pass: string, frames: number[], inputProps: VideoProps, onArtifact: OnArtifact) {
    return inBrowser(pass, async (browser, watch) => {
      const { concurrency } = await drawFrames(browser, watch, frames, null, { inputProps: { ...inputProps, picture: false }, image: { imageFormat: 'none' }, onArtifact });
      return { result: undefined, workers: concurrency };
    });
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
      const drawn = await drawLossless(`${name} frames`, span, { inputProps, dir: tmp, timeline, ...(onProgress && { onProgress }), ...(onArtifact && { onArtifact }) });
      const picture = join(tmp, name);
      await trace.run(`${name} encode`, () => encodeLosslessList(drawn.list, picture, encoding));
      const encoded = countVideoFrames(picture);
      if (encoded !== count) throw new Error(`${name} encoded ${encoded} frames of the ${count} drawn`);
      const wav = sound === 'apart' || (sound === 'own' && drawn.heard) ? await renderAudio({ out: join(tmp, 'sound.wav'), inputProps, frames: span }) : undefined;
      const { soundtrack, motion } = (await approve?.({ ...(sound === 'apart' && { sound: wav }) })) ?? {};
      const track = soundtrack ?? (sound === 'own' ? wav : undefined);
      if (track) await trace.run(`${name} mux`, () => muxDeliveredSound(picture, track, out, { frames: count, fps: timeline.fps }));
      else copyFileSync(picture, out);
      const made = { frames: span, timeline, clock, voice: renderVoiceOf(project), gpu: drawn.gpu };
      writeRenderSnapshot(out, { ...made, ...(motion && { motion }) });
      if (lossless) await keepLossless(drawn.list, lossless, made);
      return out;
    });
  }

  /**
   * `frames` of the video kept lossless at `out` as a slice keeps them for --join (FFV1), with its snapshot, and
   * nothing encoded: a remote render's piece, which the machine that asked for it encodes.
   */
  async function renderLosslessVideo({ out, frames, timeline, onProgress }: {
    out: string; frames: RenderSnapshot['frames']; timeline: TimelineReport; onProgress?: (p: { progress: number }) => void;
  }): Promise<string> {
    mkdirSync(dirname(out), { recursive: true });
    return withStudioTemp('lossless', async (tmp) => {
      const drawn = await drawLossless(`${basename(out)} frames`, frames, { inputProps: props(), dir: tmp, timeline, ...(onProgress && { onProgress }) });
      await keepLossless(drawn.list, out, { frames, timeline, clock, voice: renderVoiceOf(project), gpu: drawn.gpu });
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
        inputProps, dir: tmp, timeline, alpha: true, ...(onProgress && { onProgress }), ...(onArtifact && { onArtifact }),
      });
      const { motion } = (await approve?.()) ?? {};
      const frames = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list];
      // Tagged on the frames, which is what the encoders read: -color_primaries and the like are overridden by them. An
      // untagged HEVC's colours shift in AVFoundation, Safari's decoder.
      const bt709 = 'setparams=color_primaries=bt709:color_trc=bt709';
      await trace.run(`${basename(webm)} and ${basename(mov)} encode`, () => Promise.all([
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
    await inBrowser('sound', async (browser, watch) => {
      const composition = await selectVideo(heard, browser), concurrency = workersFor(composition, heard);
      await renderMedia({
        ...RENDER_PAGE_OPTIONS, ...watchedRenderMedia(watch), composition, serveUrl, puppeteerInstance: browser, concurrency, inputProps: heard, codec: 'wav', outputLocation: out,
        ...(frames && { frameRange: [frames.from, frames.end - 1] }),
      });
      return { result: undefined, workers: concurrency };
    });
    return out;
  }

  /** The video's frames as `imageFormat` files in `outputDir`, each `f-<frame>`, its number padded to the video's length. */
  async function renderFrameFiles({ outputDir, imageFormat, inputProps = props() }: { outputDir: string; imageFormat: 'png' | 'jpeg'; inputProps?: VideoProps }) {
    const timeline = await readTimeline();
    await drawChunks('frame files', Array.from({ length: timeline.durationInFrames }, (_, i) => i), {
      inputProps, image: imageFormat === 'png' ? { imageFormat } : { imageFormat, jpegQuality: 90 },
    }, { into: () => outputDir, timeline });
  }

  return {
    ...ledger, serveUrl, lens, props, compositionFor, workersFor, inBrowser,
    renderStills, renderReplay, measureFrames, readTimeline, renderVideo, renderLosslessVideo, renderTransparentVideo, renderAudio, renderFrameFiles,
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

/** Seconds `spans` took between them. */
const spanSeconds = (spans: readonly TraceSpan[]) => spans.reduce((sum, s) => sum + s.end - s.start, 0);

/** A chunked pass's chunks in one line: how they started, drew and packed, which their spans hold one by one. */
function formatChunkSpans(pass: TraceSpan, spans: readonly TraceSpan[]): string {
  const chunks = spans.filter((s) => s.parent === pass.id && s.kind === RENDER_SPAN_KINDS.chunk);
  const underChunks = (name: string) => spans.filter((s) => s.name === name && chunks.some((c) => c.id === s.parent));
  const startups = underChunks('startup').map((s) => (s.end - s.start).toFixed(1)), drawing = underChunks('drawing');
  const frames = drawing.reduce((sum, s) => sum + (traceQuantity(s, 'frames') ?? 0), 0);
  const ofPass = (test: (s: TraceSpan) => boolean) => spans.filter((s) => s.parent === pass.id && test(s));
  const failed = chunks.filter((c) => c.status !== 'ok').length;
  return [
    `${chunks.length} chunk${chunks.length > 1 ? 's' : ''}${failed ? ` (${failed} failed)` : ''}`,
    `startup ${startups.join(', ')}s`,
    ...(frames ? [`steady ${Math.round((spanSeconds(drawing) * 1000) / frames)} ms/frame`] : []),
    `packing ${spanSeconds(ofPass((s) => s.kind === RENDER_SPAN_KINDS.packing)).toFixed(1)}s (waited on ${spanSeconds(ofPass((s) => s.name === 'waiting on packing')).toFixed(1)}s)`,
  ].join(' · ');
}

/**
 * The ledger's spans as a table, with the workers and GPU backends its renders had: where a command's time went. Each
 * top-level span is a row, its children under it, a chunked pass's chunks summed in a line. Spans overlap, so rows don't
 * add up: the wall-clock (the whole process) and the GPU lease wait close it.
 */
export function formatRenderSpans({ trace }: Pick<RenderLedger, 'trace'>): string[] {
  // The command's own spans: its pages' are in the trace, read with `npm run trace`.
  const spans = trace.trace().spans.filter((s) => s.producer === RENDER_TRACE_PRODUCER);
  const ordered = spans.toSorted((a, b) => a.start - b.start), childrenOf = (id: string | null) => ordered.filter((s) => s.parent === id);
  const width = Math.max(...ordered.map((s) => s.name.length + 2), 'GPU lease wait'.length);
  const gpu = [...new Set(spans.flatMap((s) => traceLabel(s, 'gpu') ?? []))];
  const row = (span: Pick<TraceSpan, 'name' | 'status'>, seconds: number, at?: number, workers?: number) =>
    `  ${(span.status === 'ok' ? span.name : `${span.name} (${span.status})`).padEnd(width)}  ${seconds.toFixed(1).padStart(6)}s${at === undefined ? '' : `  at ${at.toFixed(1)}s`}${workers ? `  ${workers} worker${workers > 1 ? 's' : ''}` : ''}`;
  const chunked = new Set<string>([RENDER_SPAN_KINDS.chunk, RENDER_SPAN_KINDS.packing]);
  const rowsOf = (span: TraceSpan): string[] => {
    const children = childrenOf(span.id);
    return [
      row(span, span.end - span.start, span.start, traceQuantity(span, 'workers')),
      ...children.filter((c) => !chunked.has(c.kind ?? '') && c.name !== 'waiting on packing').map((c) => `  ${row(c, c.end - c.start, c.start)}`),
      ...(children.some((c) => c.kind === RENDER_SPAN_KINDS.chunk) ? [`      ${formatChunkSpans(span, spans)}`] : []),
    ];
  };
  return [
    `timing, GPU ${gpu.join('; ') || 'unused'}:`,
    ...childrenOf(null).flatMap(rowsOf),
    row({ name: 'GPU lease wait', status: 'ok' }, renderGpuWaitSeconds(spans)),
    row({ name: 'wall-clock', status: 'ok' }, traceClock()),
  ];
}
