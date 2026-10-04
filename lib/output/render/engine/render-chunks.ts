// render-chunks.ts: a render's frames drawn chunk by chunk, each chunk in a browser of its own (render-browser.ts), so
// whatever a page holds or leaks lives only as long as one chunk, and a crash costs one chunk. Node only.
//
// A watchdog on the host watches each chunk: its frames arriving, and its page's lines for the terminal
// (render-page-log.ts), which a painted shot logs as it solves. Neither for max(RENDER_STALL_FLOOR_MS, 5 × the
// chunk's slowest frame past its first), and the page or its GPU process is stuck: the browser is closed and the chunk
// fails. A chunk that fails as a stuck or crashed page or a lost GPU does is drawn again once, in a fresh browser.

import { makeCancelSignal, type BrowserLog, type HeadlessBrowser, type RenderFramesOptions } from '@remotion/renderer';
import { inRenderBrowser, printRenderPageLog } from '#lib/platform/browser/engine/render-browser.ts';
import { renderPageLogText } from '#lib/platform/browser/models/render-page-log.ts';

/**
 * Frames a chunk draws. A fresh browser costs a few seconds, so a chunk is long; short enough that a page's growth
 * over many distinct frames never reaches a crash.
 */
export const RENDER_CHUNK_FRAMES = 150;

/** The least time a chunk may go with no frame and no page line before it's stuck. */
export const RENDER_STALL_FLOOR_MS = 120_000;

/** What a chunk's draw passes renderFrames, so the watchdog sees its frames and lines and can stop it. */
export type RenderChunkWatch = Required<Pick<RenderFramesOptions, 'cancelSignal' | 'onFrameUpdate' | 'onBrowserLog'>>;

/** One chunk's draw: in `browser`, frames `frames`, renderFrames given `watch`. */
export type RenderChunkDraw<T> = (browser: HeadlessBrowser, frames: readonly number[], watch: RenderChunkWatch) => Promise<T>;

/** `frames` in chunks of `size`, in order. */
export function renderChunksOf(frames: readonly number[], size: number): number[][] {
  return Array.from({ length: Math.ceil(frames.length / size) }, (_, i) => frames.slice(i * size, (i + 1) * size));
}

/**
 * Whether a chunk failing with `message` failed as its browser did rather than as its frames do, so drawing it again
 * in a fresh browser may pass: a page stuck or crashed, a target gone, a GPU process lost or fallen back to software.
 */
export function renderChunkRetryable(message: string): boolean {
  return [
    /hasn't drawn in \d+ s: its page or GPU process is stuck/, /stalled: no solve has finished/, /Page crashed!/, /Target closed|Session closed/,
    /gpu: the device was lost/, /render's browser fell back to/, /no GL backend: its GPU process is gone/,
  ].some((pattern) => pattern.test(message));
}

const framesText = (frames: readonly number[]) => `frames ${frames[0]}–${frames.at(-1)}`;

/** Runs `draw` with a watch over its frames and lines that closes `browser` once they stop: rejected as stuck then. */
async function watchedChunkDraw<T>(browser: HeadlessBrowser, frames: readonly number[], draw: RenderChunkDraw<T>, stallFloorMs: number): Promise<T> {
  const { cancel, cancelSignal } = makeCancelSignal();
  const drawn = new Set<number>();
  let alive = performance.now(), slowest = 0, stuck: Error | null = null;
  const timer = setInterval(() => {
    const quiet = performance.now() - alive;
    if (stuck || quiet < Math.max(stallFloorMs, 5 * slowest)) return;
    const waiting = frames.find((frame) => !drawn.has(frame)) ?? frames.at(-1);
    stuck = new Error(`frame ${waiting} hasn't drawn in ${Math.round(quiet / 1000)} s: its page or GPU process is stuck`);
    // Cancelled first: renderFrames replaces a browser that closes under it, and a cancelled one stops instead.
    cancel();
    void browser.close({ silent: true });
  }, 1000);
  const watch: RenderChunkWatch = {
    cancelSignal,
    onFrameUpdate: (_count, frame, ms) => {
      // A tab's first frame loads its page, and a painted shot warms there: not a frame's cost.
      if (drawn.size) slowest = Math.max(slowest, ms);
      drawn.add(frame);
      alive = performance.now();
    },
    onBrowserLog: (log: BrowserLog) => {
      if (renderPageLogText(log.text) !== null) alive = performance.now();
      printRenderPageLog(log);
    },
  };
  try {
    return await draw(browser, frames, watch);
  } catch (error) {
    throw stuck ?? error;
  } finally {
    clearInterval(timer);
  }
}

/**
 * Draws `frames` chunk by chunk, each `chunkFrames` long, each in a browser of its own given to `draw`, watched, and
 * drawn once more on a retryable failure; hands each chunk's result to `take` while the next draws, one at a time.
 * Returns the GPU the chunks drew on, refusing chunks that drew on two, and the seconds they waited for the GPU lease.
 */
export async function renderInChunks<T>(frames: readonly number[], draw: RenderChunkDraw<T>, { take, chunkFrames = RENDER_CHUNK_FRAMES, stallFloorMs = RENDER_STALL_FLOOR_MS }: {
  take?: (frames: readonly number[], drawn: T) => Promise<void>; chunkFrames?: number; stallFloorMs?: number;
} = {}): Promise<{ gpu: string; drawn: T[]; waited: number }> {
  const attempt = (chunk: readonly number[]) => inRenderBrowser((browser) => watchedChunkDraw(browser, chunk, draw, stallFloorMs));
  const drawChunk = (chunk: readonly number[]) => attempt(chunk).catch((error: Error) => {
    if (!renderChunkRetryable(error.message)) throw error;
    process.stderr.write(`  ${framesText(chunk)}: ${error.message}\n  drawing ${framesText(chunk)} again in a fresh browser\n`);
    return attempt(chunk).catch((again: Error) => Promise.reject(Object.assign(again, { message: `${framesText(chunk)} failed twice, each in a fresh browser: ${again.message}` })));
  });
  type Drawn = { gpu: string | null; drawn: T[]; waited: number; taking: Promise<void> };
  // One chunk after another: each draws in a browser of its own on the one GPU, while the chunk before is taken.
  const last = await renderChunksOf(frames, chunkFrames).reduce<Promise<Drawn>>(async (before, chunk) => {
    const { gpu, drawn, waited, taking } = await before;
    const done = await drawChunk(chunk);
    if (gpu !== null && done.gpu !== gpu) throw new Error(`${framesText(chunk)} drew on ${done.gpu}, and the frames before on ${gpu}: a GPU rounds a frame its own way`);
    await taking;
    const next = take?.(chunk, done.result) ?? Promise.resolve();
    // Awaited after the next chunk draws; caught now, so a failure meanwhile isn't an unhandled rejection.
    next.catch(() => {});
    return { gpu: done.gpu, drawn: [...drawn, done.result], waited: waited + done.waited, taking: next };
  }, Promise.resolve({ gpu: null, drawn: [], waited: 0, taking: Promise.resolve() }));
  await last.taking;
  return { gpu: last.gpu!, drawn: last.drawn, waited: last.waited };
}
