// paint-similarity.ts: maps p ↦ m·p + k, m a complex number (a scale and a turn), as placements and the camera's
// projection compose. Two compose into one, so a group's rigid placements and the camera's step fold into a single
// lay; a warp never does, which is why only what follows a group's outermost bend becomes its lay.

import type { StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import { stampPolygonBox, type StampBox, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';

/** p ↦ (ma + i·mb)·p + (kx + i·ky), in the painting's y-down px. */
export type PaintSimilarity = { readonly ma: number; readonly mb: number; readonly kx: number; readonly ky: number };

export const PAINT_SIMILARITY_IDENTITY: PaintSimilarity = { ma: 1, mb: 0, kx: 0, ky: 0 };

/** `placement` about `pivot` as a similarity. */
export function paintSimilarityOf({ x, y, rotation, scale }: StampGroupPlacement, pivot: StampPoint): PaintSimilarity {
  const ma = scale * Math.cos(rotation), mb = scale * Math.sin(rotation);
  return { ma, mb, kx: pivot.x + x - (ma * pivot.x - mb * pivot.y), ky: pivot.y + y - (mb * pivot.x + ma * pivot.y) };
}

/** `outer` after `inner`. */
export const paintSimilarityAfter = (outer: PaintSimilarity, inner: PaintSimilarity): PaintSimilarity => ({
  ma: outer.ma * inner.ma - outer.mb * inner.mb, mb: outer.mb * inner.ma + outer.ma * inner.mb,
  kx: outer.ma * inner.kx - outer.mb * inner.ky + outer.kx, ky: outer.mb * inner.kx + outer.ma * inner.ky + outer.ky,
});

export const paintSimilarityApply = ({ ma, mb, kx, ky }: PaintSimilarity, p: StampPoint): StampPoint => ({ x: ma * p.x - mb * p.y + kx, y: mb * p.x + ma * p.y + ky });

/** The box round `box` (x0..x1, y0..y1) as `s` lays it: its four corners mapped. */
export const paintSimilarityBox = (s: PaintSimilarity, { x0, y0, x1, y1 }: StampBox): StampBox =>
  stampPolygonBox([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }].map((corner) => paintSimilarityApply(s, corner)));

/** The map undoing `s`; its scale must not be 0. */
export function paintSimilarityInverse({ ma, mb, kx, ky }: PaintSimilarity): PaintSimilarity {
  const n = ma * ma + mb * mb, ia = ma / n, ib = -mb / n;
  return { ma: ia, mb: ib, kx: -(ia * kx - ib * ky), ky: -(ib * kx + ia * ky) };
}

/** How much `s` scales lengths. */
export const paintSimilarityScale = ({ ma, mb }: PaintSimilarity) => Math.hypot(ma, mb);

/** `s` written as a placement about `pivot`, the shape a lay takes. */
export function paintPlacementOfSimilarity(s: PaintSimilarity, pivot: StampPoint): StampGroupPlacement {
  const at = paintSimilarityApply(s, pivot);
  return { x: at.x - pivot.x, y: at.y - pivot.y, rotation: Math.atan2(s.mb, s.ma), scale: paintSimilarityScale(s) };
}

/** The similarity taking `from`'s two points onto `to`'s, a move, uniform scale and turn; `from`'s must differ. */
export function paintSimilarityThrough([from0, from1]: readonly [StampPoint, StampPoint], [to0, to1]: readonly [StampPoint, StampPoint]): PaintSimilarity {
  // m = (to1 − to0) / (from1 − from0), as complex numbers: the scale and turn taking one span onto the other.
  const fx = from1.x - from0.x, fy = from1.y - from0.y, tx = to1.x - to0.x, ty = to1.y - to0.y, n = fx * fx + fy * fy;
  const ma = (tx * fx + ty * fy) / n, mb = (ty * fx - tx * fy) / n;
  return { ma, mb, kx: to0.x - (ma * from0.x - mb * from0.y), ky: to0.y - (mb * from0.x + ma * from0.y) };
}
