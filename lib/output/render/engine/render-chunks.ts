// render-chunks.ts: a render's frames drawn chunk by chunk, each chunk in a watched browser of its own
// (render-watch.ts), so whatever a page holds or leaks lives only as long as one chunk, and a crash costs one chunk. A
// piece of frames that fails as its browser did (stuck, crashed, its GPU lost: render-browser-failure.ts) is drawn
// again in halves, each in a fresh browser, down to a lone frame. A crash that grows with what a page has drawn (its
// heap filled by several cold solves) passes in a smaller piece; one that doesn't narrows to its frame, which then
// fails the render by name. Node only.

import type { HeadlessBrowser } from '@remotion/renderer';
import { isRenderBrowserFailure, renderBrowserFailureCause } from '#lib/platform/browser/models/render-browser-failure.ts';
import { inWatchedRenderBrowser, type RenderWatch } from '#lib/platform/browser/engine/render-watch.ts';
import { traceClock, type TraceCollector, type TraceSpanHandle } from '#lib/platform/trace/engine/trace-collector.ts';
import { TRACE_WINDOW_KIND } from '#lib/platform/trace/models/trace-model.ts';
import { recordRenderGpuWait, RENDER_SPAN_KINDS } from './render-ledger.ts';

/**
 * Frames a chunk draws. A fresh browser's page starts cold, solving its paint again (lake dawn-to-dusk: ~28 s), so a
 * chunk is long; short enough that a page's growth over many distinct frames never reaches a crash.
 */
export const RENDER_CHUNK_FRAMES = 300;

/** A wait on the last chunk's packing shorter than this is a promise settling, not a queue, and isn't recorded. */
const PACKING_WAIT_RECORDED_MS = 50;

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
 * Records under `chunk`, the span of one attempt at drawing a piece begun at `start`, its GPU lease wait (`waited` s),
 * its startup (the browser opening through its first frame, at `arrivals[0]`) and its steady drawing (first frame to
 * last).
 */
function recordChunkPhases(trace: TraceCollector, chunk: TraceSpanHandle, { start, waited, arrivals }: { start: number; waited: number; arrivals: readonly number[] }): void {
  recordRenderGpuWait(trace, waited, { start, parent: chunk });
  const [first, last] = [arrivals[0], arrivals.at(-1)];
  if (first === undefined || last === undefined) return;
  trace.record('startup', { start: start + waited, end: first, parent: chunk, kind: TRACE_WINDOW_KIND });
  if (arrivals.length > 1) {
    const frames = arrivals.length - 1;
    trace.record('drawing', {
      start: first, end: last, parent: chunk, kind: TRACE_WINDOW_KIND,
      attributes: { frames: { value: frames, unit: 'frames' }, msPerFrame: { value: ((last - first) * 1000) / frames, unit: 'ms/frame' } },
    });
  }
}

/**
 * Where a chunked draw records its spans: each attempt at a chunk under `parent`, on its main track, and each chunk's
 * packing under `parent` too, on a track of its own (it runs while the next chunk draws), caused by the chunk's attempt.
 */
export type RenderChunkSpans = { readonly trace: TraceCollector; readonly parent: TraceSpanHandle };

/**
 * Draws `frames` in chunks of `chunkFrames`, each piece in a watched browser of its own given to `draw`, and again as
 * renderPieceRetries says when its browser failed; a lone frame failing again is named by `describeFrame`. Hands each
 * piece to `take` as the next draws, recording chunks, packing and waits on it in `spans`. Returns the GPU and results.
 */
export async function renderInChunks<T>(frames: readonly number[], draw: RenderChunkDraw<T>, { take, chunkFrames = RENDER_CHUNK_FRAMES, stallMs, describeFrame = async (frame) => `frame ${frame}`, spans }: {
  take?: (frames: readonly number[], drawn: T) => Promise<void>; chunkFrames?: number; stallMs?: number; describeFrame?: (frame: number) => Promise<string>; spans?: RenderChunkSpans;
} = {}): Promise<{ gpu: string; drawn: T[] }> {
  const drawn: T[] = [];
  let gpu: string | null = null, taking = Promise.resolve();
  /** Records a wait on the last chunk's packing, begun at `waiting` (performance.now()), when it queued. */
  const recordPackingWait = (waiting: number) => {
    if (spans && performance.now() - waiting >= PACKING_WAIT_RECORDED_MS) spans.trace.record('waiting on packing', { start: traceClock(waiting), end: traceClock(), parent: spans.parent });
  };
  /** Draws `piece`, its frames having failed once already when `again`. */
  const drawPiece = async (piece: readonly number[], again: boolean): Promise<void> => {
    // Begun before `start` is read, so the startup measured from it lies inside the chunk.
    const chunk = spans?.trace.begin(framesText(piece), { parent: spans.parent, kind: RENDER_SPAN_KINDS.chunk });
    const start = traceClock(), arrivals: number[] = [];
    const done = await inWatchedRenderBrowser((browser, watch) => draw(browser, piece, {
      ...watch,
      frameDrawn: (frame) => {
        arrivals.push(traceClock());
        watch.frameDrawn(frame);
      },
    }), {
      pass: framesText(piece), frames: piece, ...(stallMs !== undefined && { stallMs }),
      ...(spans && chunk && { trace: { trace: spans.trace, parent: chunk.id, name: framesText(piece) } }),
    }).catch((error: Error) => error);
    if (spans && chunk) {
      recordChunkPhases(spans.trace, chunk, { start, waited: done instanceof Error ? 0 : done.waited, arrivals });
      const attributes = { frames: { value: piece.length, unit: 'frames' } };
      if (done instanceof Error) chunk.fail(done, attributes);
      else chunk.end({ ...attributes, gpu: done.gpu });
    }
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
    drawn.push(done.result);
    const waiting = performance.now();
    await taking;
    recordPackingWait(waiting);
    const pack = () => take?.(piece, done.result);
    if (spans && chunk) {
      taking = spans.trace.run(`packing ${framesText(piece)}`, async (packing) => {
        spans.trace.flow(chunk, packing);
        await pack();
      }, { parent: spans.parent, track: 'packing', kind: RENDER_SPAN_KINDS.packing });
    } else taking = pack() ?? Promise.resolve();
    // Awaited after the next piece draws; caught now, so a failure meanwhile isn't an unhandled rejection.
    taking.catch(() => {});
  };
  await inTurn(renderChunksOf(frames, chunkFrames), (chunk) => drawPiece(chunk, false));
  const waiting = performance.now();
  await taking;
  recordPackingWait(waiting);
  return { gpu: gpu!, drawn };
}
