// lens.ts: the frame post's chromatic aberration as numbers: how far the colour channels sit apart at `t`, at rest,
// on a cut's kick and on a glitch's split. LensFringe (studio/reel/lens.tsx) draws it.

import type { FrameSize } from '#models/frame/frame.ts';
import { motionCurves } from '#models/motion/motion.ts';
import { hashRandom } from '#models/motion/random.ts';

export type LensFringeTiming = {
  /** Px each of red and blue sits off green at the frame's corners, at rest. Ref ≈0.6; 0.55 keeps it sub-pixel. */
  radial?: number;
  /** Cut times, s: the fringe jumps to `kick` px and eases back to `radial` over `kickDecay` s. Ref 2.5 over 1/6 s. */
  kicks?: readonly number[];
  kick?: number;
  kickDecay?: number;
  /** Glitch times, s: red shifts right and blue left by about `split` px for `splitFor` s. Ref 7 px for 0.05 s. */
  splits?: readonly number[];
  split?: number;
  splitFor?: number;
  /** Seeds each split frame's jitter (the reference's split wanders 4–9 px frame to frame). */
  seed?: string | number;
};

export type LensFringeState = { radial: number; red: number; blue: number };

/**
 * The fringe at `t` in a video at `fps`: `radial` px at the corners, and the split's red and blue shifts in whole px
 * (red +, blue −).
 */
export function lensFringeAt(t: number, fps: number, timing: LensFringeTiming = {}): LensFringeState {
  const { radial = 0.55, kicks = [], kick = 2.5, kickDecay = 1 / 6, splits = [], split = 7, splitFor = 0.05, seed = 'lens' } = timing;
  let px = radial;
  for (const at of kicks) {
    const since = t - at;
    // The kick holds a couple of frames and then falls away; the reference's decay fits 1 − smoothstep within 0.2 px.
    if (since > -1e-6 && since < kickDecay) px = Math.max(px, radial + (kick - radial) * (1 - motionCurves.dissolve(since / kickDecay)));
  }
  const glitch = splits.find((at) => t - at > -1e-6 && t - at < splitFor);
  if (glitch === undefined || split === 0) return { radial: px, red: 0, blue: 0 };
  const frame = Math.floor(t * fps + 1e-6);
  const wander = (channel: string) => 0.7 + 0.6 * hashRandom(seed, glitch, frame, channel);
  return { radial: px, red: Math.round(split * wander('red')), blue: -Math.round(split * wander('blue')) };
}

/**
 * The widest `radial` drawn sub-pixel on a frame this size, with bilinear weights like a lens. Wider fringes (a kick's
 * first frames) and a split's frames, which drop the radial fringe under the split, move each channel in whole px.
 */
export const lensFringeSubpixelMax = ({ width, height }: FrameSize) => Math.hypot(width / 2, height / 2) / width;
