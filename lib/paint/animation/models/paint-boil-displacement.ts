import type { StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
import { paintIdHash } from './paint-motion-clips.ts';

/** How far the wobble moves paint at most, px, and how far apart its bumps are, px: spike 1.0's values. */
export const PAINT_BOIL_WOBBLE: PaintBoilWobble = { amount: 2.2, scale: 45 };

/** A lattice point's value in [−1, 1] for `seed`: an integer mix, so neighbours are unrelated. */
function latticeValue(seed: number, i: number, j: number): number {
  let h = Math.imul(seed ^ Math.imul(i, 0x27d4eb2d), 0x165667b1) ^ Math.imul(j, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (((h ^ (h >>> 16)) >>> 0) / 0xffffffff) * 2 - 1;
}

const fade = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);

/** Value noise at (x, y) in lattice units: smooth, in [−1, 1]. */
function valueNoise(seed: number, x: number, y: number): number {
  const i = Math.floor(x), j = Math.floor(y), u = fade(x - i), v = fade(y - j);
  const a = latticeValue(seed, i, j), b = latticeValue(seed, i + 1, j), c = latticeValue(seed, i, j + 1), d = latticeValue(seed, i + 1, j + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/** A wobble's size: at most `amount` px, its bumps `scale` px apart. */
export type PaintBoilWobble = { readonly amount: number; readonly scale: number };

/**
 * Why `wobble` can fold paint, or null. Its steepest slope along either axis is 3.75·amount/scale; below 1/2 its map's
 * determinant stays above 0, so it folds nothing alone, wherever its bumps fall.
 */
export function paintBoilWobbleProblem({ amount, scale }: PaintBoilWobble): string | null {
  if (!(amount >= 0 && Number.isFinite(amount) && scale > 0 && Number.isFinite(scale))) return `its wobble needs an amount from 0 and a positive scale, not ${amount} px at ${scale} px`;
  return 7.5 * amount < scale ? null : `its wobble of ${amount} px at ${scale} px can fold paint; keep the amount under ${(scale / 7.5).toFixed(2)} px at that scale`;
}

/** A continuous displacement between neighbouring noise fields. Integer presentation frames land on a single field. */
export function paintBoilDisplacementMap(id: string, frame: number, { amount, scale }: PaintBoilWobble = PAINT_BOIL_WOBBLE): StampWarpMap {
  if (frame <= 0) return (rest) => rest;
  const field = (index: number) => {
    const xSeed = paintIdHash(`${id}|wobble${index}|x`), ySeed = paintIdHash(`${id}|wobble${index}|y`);
    return (x: number, y: number) => index === 0 ? { x: 0, y: 0 } : { x: valueNoise(xSeed, x, y), y: valueNoise(ySeed, x, y) };
  };
  const index = Math.floor(frame), share = fade(frame - index), from = field(index), to = field(index + 1);
  return (rest) => {
    const x = rest.x / scale, y = rest.y / scale, a = from(x, y), b = share ? to(x, y) : a;
    return { x: rest.x + amount * (a.x + (b.x - a.x) * share), y: rest.y + amount * (a.y + (b.y - a.y) * share) };
  };
}
