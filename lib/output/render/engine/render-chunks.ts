// render-chunks.ts: a render's frames drawn chunk by chunk, each chunk in a watched browser of its own
// (render-watch.ts), so whatever a page holds or leaks lives only as long as one chunk, and a crash costs one chunk. A
// chunk that fails as its browser did (stuck, crashed, its GPU lost: render-browser-failure.ts) is drawn again once,
// in a fresh browser. Node only.

import type { HeadlessBrowser } from '@remotion/renderer';
import { isRenderBrowserFailure } from '#lib/platform/browser/models/render-browser-failure.ts';
import { inWatchedRenderBrowser, type RenderWatch } from '#lib/platform/browser/engine/render-watch.ts';

/**
 * Frames a chunk draws. A fresh browser costs a few seconds, so a chunk is long; short enough that a page's growth
 * over many distinct frames never reaches a crash.
 */
export const RENDER_CHUNK_FRAMES = 150;

/** One chunk's draw: in `browser`, frames `frames`, telling `watch` its progress. */
export type RenderChunkDraw<T> = (browser: HeadlessBrowser, frames: readonly number[], watch: RenderWatch) => Promise<T>;

/** `frames` in chunks of `size`, in order. */
function renderChunksOf(frames: readonly number[], size: number): number[][] {
  return Array.from({ length: Math.ceil(frames.length / size) }, (_, i) => frames.slice(i * size, (i + 1) * size));
}

const framesText = (frames: readonly number[]) => `frames ${frames[0]}–${frames.at(-1)}`;

/**
 * Draws `frames` chunk by chunk, each `chunkFrames` long, each in a watched browser of its own given to `draw`, and
 * drawn once more when it failed as its browser did; hands each chunk's result to `take` while the next draws. Returns
 * the GPU they drew on, refusing chunks on two, and their wait for the GPU lease, s.
 */
export async function renderInChunks<T>(frames: readonly number[], draw: RenderChunkDraw<T>, { take, chunkFrames = RENDER_CHUNK_FRAMES, stallFloorMs }: {
  take?: (frames: readonly number[], drawn: T) => Promise<void>; chunkFrames?: number; stallFloorMs?: number;
} = {}): Promise<{ gpu: string; drawn: T[]; waited: number }> {
  const attempt = (chunk: readonly number[]) => inWatchedRenderBrowser((browser, watch) => draw(browser, chunk, watch), {
    pass: framesText(chunk), frames: chunk, ...(stallFloorMs !== undefined && { stallFloorMs }),
  });
  const drawChunk = (chunk: readonly number[]) => attempt(chunk).catch((error: Error) => {
    if (!isRenderBrowserFailure(error.message)) throw error;
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
