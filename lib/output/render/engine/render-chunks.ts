// render-chunks.ts: a render's frames drawn chunk by chunk, each chunk in a watched browser of its own
// (render-watch.ts), so whatever a page holds or leaks lives only as long as one chunk, and a crash costs one chunk. A
// piece of frames that fails as its browser did (stuck, crashed, its GPU lost: render-browser-failure.ts) is drawn
// again in halves, each in a fresh browser, down to a lone frame. A crash that grows with what a page has drawn (its
// heap filled by several cold solves) passes in a smaller piece; one that doesn't narrows to its frame, which then
// fails the render by name. Node only.

import type { HeadlessBrowser } from '@remotion/renderer';
import { isRenderBrowserFailure, renderBrowserFailureCause } from '#lib/platform/browser/models/render-browser-failure.ts';
import { inWatchedRenderBrowser, type RenderWatch } from '#lib/platform/browser/engine/render-watch.ts';

/**
 * Frames a chunk draws. A fresh browser costs a few seconds, so a chunk is long; short enough that a page's growth
 * over many distinct frames never reaches a crash.
 */
export const RENDER_CHUNK_FRAMES = 150;

/** One piece's draw: in `browser`, frames `frames`, telling `watch` its progress. */
export type RenderChunkDraw<T> = (browser: HeadlessBrowser, frames: readonly number[], watch: RenderWatch) => Promise<T>;

/** `frames` in chunks of `size`, in order. */
function renderChunksOf(frames: readonly number[], size: number): number[][] {
  return Array.from({ length: Math.ceil(frames.length / size) }, (_, i) => frames.slice(i * size, (i + 1) * size));
}

/**
 * What a piece whose browser failed is drawn again as: its halves, or a lone frame as itself, so no frame fails the
 * render before it has failed twice, the second time alone.
 */
const renderPieceRetries = (piece: readonly number[]): (readonly number[])[] =>
  (piece.length === 1 ? [piece] : [piece.slice(0, Math.ceil(piece.length / 2)), piece.slice(Math.ceil(piece.length / 2))]);

const framesText = (frames: readonly number[]) => (frames.length === 1 ? `frame ${frames[0]}` : `frames ${frames[0]}–${frames.at(-1)}`);

/** Runs `run` on each of `pieces`, one after another: each draws in a browser of its own on the one GPU. */
const inTurn = (pieces: readonly (readonly number[])[], run: (piece: readonly number[]) => Promise<void>) =>
  pieces.reduce((before, piece) => before.then(() => run(piece)), Promise.resolve());

/**
 * Draws `frames` in chunks of `chunkFrames`, each piece in a watched browser of its own given to `draw`, and again as
 * renderPieceRetries says when its browser failed; a lone frame failing again is named by `describeFrame`. Hands each
 * piece to `take` as the next draws. Returns their GPU (two are refused), results and GPU lease wait, s.
 */
export async function renderInChunks<T>(frames: readonly number[], draw: RenderChunkDraw<T>, { take, chunkFrames = RENDER_CHUNK_FRAMES, stallMs, describeFrame = async (frame) => `frame ${frame}` }: {
  take?: (frames: readonly number[], drawn: T) => Promise<void>; chunkFrames?: number; stallMs?: number; describeFrame?: (frame: number) => Promise<string>;
} = {}): Promise<{ gpu: string; drawn: T[]; waited: number }> {
  const drawn: T[] = [];
  let gpu: string | null = null, waited = 0, taking = Promise.resolve();
  /** Draws `piece`, its frames having failed once already when `again`. */
  const drawPiece = async (piece: readonly number[], again: boolean): Promise<void> => {
    const done = await inWatchedRenderBrowser((browser, watch) => draw(browser, piece, watch), {
      pass: framesText(piece), frames: piece, ...(stallMs !== undefined && { stallMs }),
    }).catch((error: Error) => error);
    if (done instanceof Error) {
      if (!isRenderBrowserFailure(done.message)) throw done;
      if (again && piece.length === 1) throw new Error(`${await describeFrame(piece[0])} failed again, drawn alone in a fresh browser: ${renderBrowserFailureCause(done.message)}`);
      const retries = renderPieceRetries(piece);
      const how = retries.length === 1 ? 'alone in a fresh browser' : `in halves, ${retries.map(framesText).join(' and ')}, each in a fresh browser`;
      process.stderr.write(`  ${framesText(piece)}: ${done.message}\n  drawing ${framesText(piece)} again ${how}\n`);
      return inTurn(retries, (retry) => drawPiece(retry, true));
    }
    if (gpu !== null && done.gpu !== gpu) throw new Error(`${framesText(piece)} drew on ${done.gpu}, and the frames before on ${gpu}: a GPU rounds a frame its own way`);
    gpu = done.gpu;
    waited += done.waited;
    drawn.push(done.result);
    await taking;
    taking = take?.(piece, done.result) ?? Promise.resolve();
    // Awaited after the next piece draws; caught now, so a failure meanwhile isn't an unhandled rejection.
    taking.catch(() => {});
  };
  await inTurn(renderChunksOf(frames, chunkFrames), (chunk) => drawPiece(chunk, false));
  await taking;
  return { gpu: gpu!, drawn, waited };
}
