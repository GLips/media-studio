// stamp-gate-frames.ts: how the GPU gate holds a painted frame to its accepted one, and the measures its checks read
// of frames.

import { srgbToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';

/** How two frames of RGB bytes differ: the largest channel difference in levels, the mean, and the share of channels off by more than 2. */
export type StampGateFrameDifference = { max: number; mean: number; overTwo: number };

/**
 * How far a frame may sit from its baseline: a level of rounding at a few pixels, which docs/private-styles.md ("Same
 * pixels") allows a draw. Ten cold runs of every painting repeated byte for byte (vid-116), so anything past this is a
 * change, and a change is updated and accepted, never let through by widening this.
 */
export const STAMP_GATE_FRAME_TOLERANCE = { max: 2, mean: 0.01 };

/** How far a traced resolve's coverage may sit from the frame drawn with it, in levels: the output's dither, a level either way (ten runs: 1.07–1.09). */
export const STAMP_GATE_TRACE_TOLERANCE = 1.5;

export function stampGateFrameDifference(a: ArrayLike<number>, b: ArrayLike<number>): StampGateFrameDifference {
  if (a.length !== b.length) throw new Error(`stamp gate: frames of ${a.length} and ${b.length} bytes can't be compared`);
  let max = 0, sum = 0, over = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    max = Math.max(max, d);
    sum += d;
    if (d > 2) over++;
  }
  return { max, mean: sum / a.length, overTwo: over / a.length };
}

export const stampGateFramePasses = (d: StampGateFrameDifference) => d.max <= STAMP_GATE_FRAME_TOLERANCE.max && d.mean <= STAMP_GATE_FRAME_TOLERANCE.mean;

/** A difference as a check's detail reads it: its largest channel's levels and its mean. */
export const stampGateFrameDifferenceText = ({ max, mean }: StampGateFrameDifference) => `max ${max}, mean ${mean.toFixed(4)}`;
/** Whether texel `texel` of two frames, `channels` bytes a texel, differs by over 2 levels in a channel. */
export function stampGateTexelDiffers(a: ArrayLike<number>, b: ArrayLike<number>, texel: number, channels: number): boolean {
  for (let c = texel * channels; c < (texel + 1) * channels; c++) if (Math.abs(a[c] - b[c]) > 2) return true;
  return false;
}

/**
 * How much frame `cut` lays where `within` holds (texel centres), as a share of what `uncut` lays there, both over
 * `bare`, in linear light over their colour channels; frames `width` px wide, `channels` bytes a texel (RGB, or
 * premultiplied RGBA). 1 where it lays all, 0 where none: monotone in coverage, through the paint's own response.
 */
export function stampGateLaidShare(
  cut: ArrayLike<number>, uncut: ArrayLike<number>, bare: ArrayLike<number>, { width, channels }: { readonly width: number; readonly channels: number }, within: (p: StampPoint) => boolean,
): number {
  let laid = 0, whole = 0;
  for (let texel = 0; texel < cut.length / channels; texel++) {
    if (!within({ x: (texel % width) + 0.5, y: Math.floor(texel / width) + 0.5 })) continue;
    for (let c = channels * texel; c < channels * texel + 3; c++) {
      const under = srgbToLinear(bare[c] / 255);
      laid += Math.abs(srgbToLinear(cut[c] / 255) - under);
      whole += Math.abs(srgbToLinear(uncut[c] / 255) - under);
    }
  }
  return whole > 0 ? laid / whole : 0;
}

/** Two frames' difference as RGB bytes, 8 times over on white, so a level's difference shows. */
export function stampGateFrameDiffImage(a: ArrayLike<number>, b: ArrayLike<number>): Uint8Array {
  return Uint8Array.from({ length: a.length }, (_, i) => Math.max(0, 255 - 8 * Math.abs(a[i] - b[i])));
}
