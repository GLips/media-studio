// stamp-defocus.ts: how far a plane's defocus and the frame's bloom reach, and the sigma a defocus takes in a plane's
// picture. A defocus is asked for in frame px, as a lens blurs what it sees; it blurs the picture before the camera
// lays it, so where the camera magnifies the plane, the picture's own sigma is that much smaller.

import type { StampPixelBox } from './stamp-blur-region.ts';

/** How many sigmas a gaussian's taps reach each side: past them a weight is under 1.2% of the centre's. */
export const STAMP_GAUSSIAN_SIGMAS = 3;

/** How far a gaussian of `sigma` px reaches each side, whole px: 0 for none. */
export const stampGaussianReach = (sigma: number) => (sigma > 0 ? Math.ceil(STAMP_GAUSSIAN_SIGMAS * sigma) : 0);

/**
 * A picture's defocus sigma held to steps 2% apart, finer than an eye tells a blur's width by. A camera moving in
 * rescales a plane every frame, so its exact sigma is new each frame; held to a step, frames share one blurred picture.
 */
export const STAMP_DEFOCUS_SIGMA_STEP = 1.02;
export const stampDefocusSigmaStepped = (sigma: number) => (sigma > 0 ? STAMP_DEFOCUS_SIGMA_STEP ** Math.round(Math.log(sigma) / Math.log(STAMP_DEFOCUS_SIGMA_STEP)) : 0);

/** `box` grown by `by` px each side, held to a `width` × `height` target. */
export function stampGrownBox(box: StampPixelBox, by: number, width: number, height: number): StampPixelBox {
  const x = Math.max(0, box.x - by), y = Math.max(0, box.y - by);
  return { x, y, w: Math.min(width, box.x + box.w + by) - x, h: Math.min(height, box.y + box.h + by) - y };
}
