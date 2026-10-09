// painting-render-placements.ts: the placements a render made once in Node (lib/output/render/engine/render-
// placements.ts), adopted by this page before it compiles a painting, so it places only what they lack. Fetched once a
// page, when first awaited: a page that never paints (a composition's selection) never fetches them.

import { adoptStampPlacements } from '#lib/paint/painting/models/stamp-deposit-placement.ts';
import { stampPlacementsUnframed } from '#lib/paint/painting/models/stamp-placements-transfer.ts';

/** What a page adopted: how many placements, and their bytes. */
export type PaintingRenderPlacementsAdopted = { readonly placements: number; readonly bytes: number };

let source: string | null = null;
let adopting: Promise<PaintingRenderPlacementsAdopted | null> | null = null;

/** Where this page's render serves its placements (VideoProps' stampPlacements), set as the bundle loads. */
export function setPaintingRenderPlacementsSource(url: string): void {
  source = url;
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
