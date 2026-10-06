// stamp-blur-region.ts: the half-size texels a deposit's edge blur must write so that its resolve reads none left from
// an earlier deposit or frame. The resolve samples the half-size blur bilinearly at each full-size pixel's centre,
// which sits a quarter texel before a half-size texel's centre: a box starting on an even pixel reads the texel before
// its own half, and the last pixel reads the texel after.

import type { StampTexelBoxMark } from './stamp-stage.ts';

/** A box of a target's whole texels. A box of painting points (StampPointBox) reads as one only through its stage. */
export type StampPixelBox = { x: number; y: number; w: number; h: number } & StampTexelBoxMark;

/**
 * The texels of a `halfW` × `halfH` blur (a `width` × `height` painting's, halved and rounded up) that the resolve of
 * `box` samples, with a texel's slack each side for the stretch an odd size gives the half-size grid.
 */
export function stampBlurRegion(box: StampPixelBox, halfW: number, halfH: number): StampPixelBox {
  const x = Math.max(0, Math.floor(box.x / 2) - 1), y = Math.max(0, Math.floor(box.y / 2) - 1);
  const x1 = Math.min(halfW, Math.ceil((box.x + box.w) / 2) + 1), y1 = Math.min(halfH, Math.ceil((box.y + box.h) / 2) + 1);
  return { x, y, w: x1 - x, h: y1 - y };
}
