// stamp-card-edge.ts: where a sheet's paper lies, and so how much of it an own sheet's card lays at each texel (its
// cover). A cut card's paper follows its paint, raised so paint at half its density covers: its cut is crisp, as cut
// paper's is. A figure card is meant to sit over footage: its paper covers the figure wholly, whites and all, and past
// it fades ahead of its paint, so a bleed ends as a glaze over what's behind, never as a band of bare paper.

import { stampCanonicalDigest } from './stamp-canonical.ts';
import { STAMP_OPAQUE_COVER } from './stamp-paint-recipe-compile.ts';
import { stampPolygonBox, stampRingsLayout, type StampPoint } from './stamp-region.ts';
import { stampPointBox, type StampPointBox } from './stamp-stage.ts';

/**
 * Where a sheet's paper lies: over the whole `document` (the root's); as far as its paint does (`union`, a cut card's);
 * or a `figure` card's, wholly over its rings and thinning `fadePx` past them where its paint lies.
 */
export type StampSheetEdge = 'document' | 'union' | StampCardFigure;

/** A figure card's outline, the figure's rings (even-odd, painting points), and how far past them its paper thins out, px. */
export type StampCardFigure = { readonly kind: 'figure'; readonly rings: readonly (readonly StampPoint[])[]; readonly fadePx: number };

/** A card's edge: an own sheet's, never the root's. */
export type StampCardEdge = Exclude<StampSheetEdge, 'document'>;

/**
 * How far past its figure a figure card's paper reaches when its sheet names no fade, px. Its paper thins over that
 * span, squared, times its paint's coverage: wider, a pale wash's bleed carries the paper out as a halo; narrower,
 * the cut reads as a matte and a bleed as a dark stain on what's behind.
 */
export const STAMP_FIGURE_CARD_FADE_PX = 10;

/** `program`'s card edge: only an own sheet has a card to lay. */
export function stampCardEdgeOf({ name, edge }: { readonly name: string; readonly edge: StampSheetEdge }): StampCardEdge {
  if (edge === 'document') throw new Error(`stamp sheet: ${name} covers the document, so it has no card to lay`);
  return edge;
}

/** How much a card's cover takes its paint's coverage up: a cut card's, so paint at half its density covers; a figure's not at all, its fade governing. */
export const stampCardPaintRaise = (edge: StampCardEdge) => (edge === 'union' ? STAMP_OPAQUE_COVER : 1);

/** A card edge's identity in cache keys: `union`, or its figure's digest. */
export const stampCardEdgeKey = (edge: StampCardEdge) => (edge === 'union' ? 'union' : `figure ${edge.fadePx} ${stampCanonicalDigest(edge.rings.map((ring) => ring.map(({ x, y }) => [x, y])))}`);

/**
 * The whole painting points of `frame` a figure's rings span, a point round for the antialiased line; null for a cut
 * card or a figure wholly off the frame.
 */
export function stampCardFigureBox(edge: StampCardEdge, frame: { readonly width: number; readonly height: number }): StampPointBox | null {
  if (edge === 'union') return null;
  const box = stampPolygonBox(edge.rings.flat(), 1);
  const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0)), x1 = Math.min(frame.width, Math.ceil(box.x1)), y1 = Math.min(frame.height, Math.ceil(box.y1));
  return x1 > x0 && y1 > y0 ? stampPointBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }) : null;
}

/** A figure's rings as the GPU's ringsDistance reads them (stampRingsLayout), flat x, y pairs. */
export const stampCardFigurePoints = ({ rings }: StampCardFigure) => new Float32Array(stampRingsLayout(rings).flatMap(({ x, y }) => [x, y]));
