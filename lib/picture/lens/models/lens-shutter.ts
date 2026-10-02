// lens-shutter.ts: the studio's one shutter convention, for every sampler and every smear sized by hand. A frame at
// time t exposes while the shutter is open around t, centred on it: a smear lies centred on where the frame's own
// pose puts a thing, so a blurred frame and a sharp one register. ThreeStage, ShutterBlur, StampPainting's lens and
// the reel's hand-sized smears all place their moments here.

/**
 * The reference reel's shutter, 180° at its 60 fps: its smears are this long, so ours match it frame for frame. Our
 * 30 fps jumps twice as far between frames; 1/60 (180° at 30 fps) smears twice as long and strobes less.
 */
export const REEL_SHUTTER = 1 / 120;

/**
 * A Gaussian of σ = 0.312 L has the 10–90% edge ramp (2.563σ) of a box blur L long, which is what an open shutter
 * makes of an edge travelling L px.
 */
export const smearSigma = (travel: number) => 0.312 * Math.abs(travel);

/**
 * When a shutter `shutter` long (in `t`'s units), centred on `t`, opens. A move starting at `start` is drawn whole from
 * its first moment, so the shutter opens no earlier: centred on it, half the exposure would see the move not yet begun.
 */
export const shutterOpensAt = (t: number, shutter: number, start = -Infinity) => Math.max(start, t - shutter / 2);

/** How far the position `at` gives moves while the shutter around `t` is open (as `shutterOpensAt`); 0 before `start`. */
export function shutterTravel(at: (t: number) => number, t: number, shutter: number, start = -Infinity) {
  if (t < start) return 0;
  const open = shutterOpensAt(t, shutter, start);
  return Math.abs(at(open + shutter) - at(open));
}

/**
 * Where exposure `share` (0..1 across the open shutter, LensExposure's `shutter`) sits in time: `share` of the way
 * through a shutter `shutter` long opened as shutterOpensAt says.
 */
export const shutterMomentAt = (t: number, shutter: number, share: number, start = -Infinity) => shutterOpensAt(t, shutter, start) + share * shutter;
