// painting-render-placements.ts: the placements a render made once in Node (lib/output/render/engine/render-
// placements.ts), adopted by this page before it compiles a painting, so it places only what they lack. Fetched once a
// page, when first awaited: a page that never paints (a composition's selection) never fetches them.

import { adoptStampPlacements } from '#lib/paint/painting/models/stamp-deposit-placement.ts';
import { stampPlacementsUnframed } from '#lib/paint/painting/models/stamp-placements-transfer.ts';
import { setStampSheetDiskCache } from '#lib/paint/painting/studio/stamp-sheet-disk.ts';

/** What a page adopted: how many placements, and their bytes. */
export type PaintingRenderPlacementsAdopted = { readonly placements: number; readonly bytes: number };

let source: string | null = null;
let adopting: Promise<PaintingRenderPlacementsAdopted | null> | null = null;

/**
 * What this page's render serves its paintings, set as the bundle loads: its placements (VideoProps' stampPlacements)
 * and its solved-paint cache (paintCache, stamp-sheet-disk.ts), each when given.
 */
export function setPaintingRenderServed({ stampPlacements, paintCache }: { stampPlacements?: string; paintCache?: string }): void {
  if (stampPlacements) source = stampPlacements;
  if (paintCache) setStampSheetDiskCache(paintCache);
}

/** This page's render's placements, adopted: null when it was given none (a still, the studio's preview). */
export function paintingRenderPlacementsAdopted(): Promise<PaintingRenderPlacementsAdopted | null> {
  if (source === null) return Promise.resolve(null);
  const from = source;
  adopting ??= (async () => {
    const response = await fetch(from);
    if (!response.ok) throw new Error(`the render's placements couldn't be read (${response.status}): ${await response.text()}`);
    const buffer = await response.arrayBuffer(), placements = stampPlacementsUnframed(buffer);
    adoptStampPlacements(placements);
    return { placements: placements.length, bytes: buffer.byteLength };
  })();
  return adopting;
}
