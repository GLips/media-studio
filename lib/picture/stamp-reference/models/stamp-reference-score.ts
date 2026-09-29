// stamp-reference-score.ts: how far a reference render's coverage is from a capture's, and which stage owns the
// difference (vid-97's error attribution). A stage owns the pixels it changes: each pixel's error goes to the last
// stage that moved its coverage by more than STAGE_FOOTPRINT, or to the build when none did. So "off" becomes a list
// of the stages to look at, not one number.

import type { StampReferenceStage } from './stamp-reference-deposit.ts';

/** A stage moving a pixel's coverage by less than this leaves it to the stage before. */
const STAGE_FOOTPRINT = 1 / 255;

/** The stages a pixel's error can go to. Opacity scales every pixel alike, so it owns none: its error shows everywhere. */
export type StampReferenceOwner = 'build' | StampReferenceStage;

export type StampReferenceScore = {
  /** Over every pixel either side paints. */
  rms: number;
  max: number;
  pixels: number;
  /** Each owner's pixels and rms over them; owners with no pixels are left out. */
  owners: { owner: StampReferenceOwner; pixels: number; rms: number }[];
};

/**
 * `reference` against `capture`, both coverage 0..1 over the same pixels. `buffers` are the reference's coverage after
 * the build and after each stage in order, each with its owner.
 */
export function scoreStampReference(reference: Float32Array, capture: Float32Array, buffers: readonly { owner: StampReferenceOwner; coverage: Float32Array }[]): StampReferenceScore {
  const sums = new Map<StampReferenceOwner, { pixels: number; squares: number }>();
  let pixels = 0, squares = 0, max = 0;
  for (let i = 0; i < reference.length; i++) {
    if (reference[i] <= 0 && capture[i] <= 0) continue;
    const error = reference[i] - capture[i];
    pixels++;
    squares += error * error;
    max = Math.max(max, Math.abs(error));
    let owner = buffers[0].owner;
    for (let b = 1; b < buffers.length; b++) if (Math.abs(buffers[b].coverage[i] - buffers[b - 1].coverage[i]) > STAGE_FOOTPRINT) owner = buffers[b].owner;
    const sum = sums.get(owner) ?? { pixels: 0, squares: 0 };
    sum.pixels++;
    sum.squares += error * error;
    sums.set(owner, sum);
  }
  return {
    rms: pixels ? Math.sqrt(squares / pixels) : 0,
    max,
    pixels,
    owners: buffers.map((b) => b.owner).filter((owner) => sums.has(owner)).map((owner) => ({ owner, pixels: sums.get(owner)!.pixels, rms: Math.sqrt(sums.get(owner)!.squares / sums.get(owner)!.pixels) })),
  };
}
