// render-placements.ts: a render's paintings placed once, in Node, and served to every page that draws them. Each
// browser's page placed every painting again at its cold start (the lake's ~5 s of stamps a page); now workers place
// them beside the bundle and the browsers' start, and each page adopts them by their keys before it compiles
// (painting-render-placements.ts). A page still places what isn't here: a hand's pressure curve, which is keyed by
// identity in its page alone, and a deposit a frame's values move. Nothing is kept past the render. Node only.

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Worker } from 'node:worker_threads';
import { paintingPlacementsFramed, type PaintingPlacementsPacked } from '#lib/paint/document/engine/painting-placements-packed.ts';
import { projectPaintingSourceFiles } from '#lib/paint/document/engine/painting-source-load.ts';
import type { PaintingValuesProp } from '#lib/picture/video/models/composition-props.ts';
import type { RenderPlacementsAsk, RenderPlacementsWork } from './render-placements-worker.ts';

/**
 * Workers placing a render's paintings at once, each taking the next source as it finishes one: the lake's take ~5 s
 * in one, its two largest ~1.8 and ~1.5 s, while the browsers starting beside them want cores of their own.
 */
const RENDER_PLACEMENT_WORKERS = 3;

/** What placing made: how many placements, their bytes, and each source left to the pages, why. */
export type RenderPlacementsPlaced = { readonly placements: number; readonly bytes: number; readonly skipped: readonly string[] };

/** A render's placements: where its pages fetch them, and what placing them made, once settled. */
export type RenderPlacements = { readonly url: string; readonly placed: Promise<RenderPlacementsPlaced> };

type WorkerSays = { readonly ready: true } | { readonly placed: string } | { readonly packed: PaintingPlacementsPacked };

/** `files` placed by `workers` workers at `paintingValues`, each worker's placements packed. */
function placeInWorkers(files: readonly string[], workers: number, paintingValues?: PaintingValuesProp): Promise<PaintingPlacementsPacked[]> {
  const queue = [...files], work: RenderPlacementsWork = { ...(paintingValues && { paintingValues }) };
  return Promise.all(Array.from({ length: Math.min(workers, files.length) }, () => new Promise<PaintingPlacementsPacked>((resolve, reject) => {
    const worker = new Worker(new URL('render-placements-worker.ts', import.meta.url), { workerData: work });
    // Unref'd, it lasts as long as the render's process does and never holds it open.
    worker.unref();
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker thread's port, not a window
    const ask = (asked: RenderPlacementsAsk) => worker.postMessage(asked);
    const next = () => {
      const file = queue.shift();
      ask(file === undefined ? { pack: true } : { place: file });
    };
    worker.on('message', (says: WorkerSays) => {
      if ('packed' in says) {
        resolve(says.packed);
        void worker.terminate();
      } else next();
    });
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`a worker placing paintings exited ${code} before it posted them`)));
  })));
}

/**
 * Starts placing `project`'s paintings at `paintingValues`, and serves them, once placed, to any page asking; null
 * when it paints none. A page asking sooner is answered when they are; one asking after a failure is told why.
 */
export async function serveRenderPlacements(project: string, { paintingValues }: { paintingValues?: PaintingValuesProp } = {}): Promise<RenderPlacements | null> {
  const files = await projectPaintingSourceFiles(project);
  if (!files.length) return null;
  const parts = placeInWorkers(files, RENDER_PLACEMENT_WORKERS, paintingValues);
  // A failure is told to the pages that ask, and to whoever awaits `placed`; none of them may be left waiting.
  parts.catch(() => {});
  const server = createServer((_request, response) => {
    const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    void (async () => {
      const packed = await parts.catch((error: Error) => error);
      if (packed instanceof Error) {
        response.writeHead(500, { ...headers, 'content-type': 'text/plain' }).end(packed.message);
        return;
      }
      const framed = paintingPlacementsFramed(packed);
      response.writeHead(200, { ...headers, 'content-type': 'application/octet-stream', 'content-length': framed.reduce((sum, piece) => sum + piece.byteLength, 0) });
      for (const piece of framed) response.write(piece);
      response.end();
    })();
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  server.unref();
  // SAFETY: a server listening on a TCP port is addressed by an AddressInfo.
  const { port } = server.address() as AddressInfo;
  const placed = parts.then((packed) => ({
    placements: packed.reduce((sum, { placements }) => sum + placements, 0), bytes: packed.reduce((sum, { buffer }) => sum + buffer.byteLength, 0),
    skipped: packed.flatMap(({ skipped }) => skipped),
  }));
  placed.catch(() => {});
  return { url: `http://127.0.0.1:${port}/placements`, placed };
}
