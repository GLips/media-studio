// stamp-defocus.ts: how far a group's defocus and glow reach, and the sigma a defocus takes in its painted layer. A
// defocus is asked for in stage px, as a lens blurs what it sees; it blurs the group's layer before the lay, so where
// the lay scales the layer up, the layer's own sigma is that much smaller.

import type { StampPixelBox } from './stamp-blur-region.ts';
import type { StampPoint } from './stamp-region.ts';
import type { StampWarpMap } from './stamp-group-warp.ts';
import type { StampGroupLay } from './stamp-paint-frame-state.ts';

/** How many sigmas a gaussian's taps reach each side: past them a weight is under 1.2% of the centre's. */
export const STAMP_GAUSSIAN_SIGMAS = 3;

/** How far a gaussian of `sigma` px reaches each side, whole px: 0 for none. */
export const stampGaussianReach = (sigma: number) => (sigma > 0 ? Math.ceil(STAMP_GAUSSIAN_SIGMAS * sigma) : 0);

/** `box` grown by `by` px each side, held to a `width` × `height` target. */
export function stampGrownBox(box: StampPixelBox, by: number, width: number, height: number): StampPixelBox {
  const x = Math.max(0, box.x - by), y = Math.max(0, box.y - by);
  return { x, y, w: Math.min(width, box.x + box.w + by) - x, h: Math.min(height, box.y + box.h + by) - y };
}

/**
 * The stage px one painted px spans where a group is laid by `lay` after `warp`, near rest point `at`: the placement's
 * scale, times the warp's there (the square root of its area change, a px either side). A warp folding there, or
 * none, scales by 1. Only roughly the warp's: a defocus is one sigma over the whole layer.
 */
export function stampLayScale(lay: StampGroupLay | null, warp: { map: StampWarpMap } | null, at: StampPoint): number {
  const placed = lay?.placement.scale ?? 1;
  if (!warp) return placed;
  const right = warp.map({ x: at.x + 1, y: at.y }), left = warp.map({ x: at.x - 1, y: at.y });
  const down = warp.map({ x: at.x, y: at.y + 1 }), up = warp.map({ x: at.x, y: at.y - 1 });
  const area = Math.abs((right.x - left.x) * (down.y - up.y) - (right.y - left.y) * (down.x - up.x)) / 4;
  return placed * (Number.isFinite(area) && area > 0 ? Math.sqrt(area) : 1);
}
