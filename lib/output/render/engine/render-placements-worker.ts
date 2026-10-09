// render-placements-worker.ts: one of render-placements.ts's worker threads. Places each painting source it's sent
// at the render's painting values, answering when done, and once told to pack, posts its placements packed, the
// buffer moved, not copied. Node only.

import { parentPort, workerData } from 'node:worker_threads';
import type { PaintingValuesProp } from '#lib/picture/video/models/composition-props.ts';

/** What the render starts its workers with: the values its paintings are painted at. */
export type RenderPlacementsWork = { readonly paintingValues?: PaintingValuesProp };

/** What a worker is sent: a source to place, or word to pack what it placed. */
export type RenderPlacementsAsk = { readonly place: string } | { readonly pack: true };

// Registered before any source loads: a painting timed by its project's timeline imports the track's audio.
await import('./tsx-test-hooks.ts');
const { setPaintingValueOverrides } = await import('#lib/paint/document/models/painting-source.ts');
const { createPaintingPlacer } = await import('#lib/paint/document/engine/painting-placements-packed.ts');
// SAFETY: render-placements.ts starts this worker with a RenderPlacementsWork, and nothing else does.
const { paintingValues } = workerData as RenderPlacementsWork;
if (paintingValues) setPaintingValueOverrides(paintingValues);
const placer = createPaintingPlacer(), port = parentPort!;
port.on('message', (ask: RenderPlacementsAsk) => {
  if ('place' in ask) {
    void placer.place(ask.place).then(() => port.postMessage({ placed: ask.place }));
    return;
  }
  const packed = placer.packed();
  port.postMessage({ packed }, [packed.buffer]);
});
port.postMessage({ ready: true });
