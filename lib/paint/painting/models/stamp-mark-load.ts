// stamp-mark-load.ts: what loading a painting onto the GPU works out from a deposit's placed marks (floats, plan,
// bins), once a set of marks: a recompiled painting shares its unchanged deposits' (stamp-deposit-placement.ts).
//
// Remembered weakly against the marks, so given up with them: right as FrozenStampMarks never change, and each key
// holds all else its value reads. What's returned is shared by every renderer: copy it, never write it.

import { stampAccumulationPlan, type StampAccumulationPlan } from './stamp-deposit-stages.ts';
import type { StampAccumulation } from '#lib/paint/brush/models/stamp-brush.ts';
import type { FrozenStampMarks } from '#lib/paint/brush/models/stamp-placement.ts';
import { stampGrainDepthBy, type StampGrainDepthSource } from './stamp-pigment-paint.ts';
import { stampMarksTipHull, stampPlacedSupportInto, type StampTipFootprint } from './stamp-tip-support.ts';
import { rememberedFor, rememberedOnce } from './stamp-remembered.ts';

/** A deposit's marks, or its dual's, as compiled: the key everything here is remembered by. */
type StampMarks = FrozenStampMarks;

/**
 * Floats per stamp in the instance buffer: x, y, diameter, rotation, then alpha, blur, grain turn and flips (x 1, y 2),
 * then opacity, roundness, grain depth and pressure.
 */
export const STAMP_FLOATS = 12;
/** Floats per stamp in the tint buffer, for a brush with colour dynamics: hue, saturation, lightness, secondary. */
export const TINT_FLOATS = 4;
/** Pixels a side of the tiles an `ordered` layer's stamps are binned by (stampMarksOrderedBins). */
export const STAMP_ORDERED_TILE = 32;

const instanceFloats = new WeakMap<StampMarks, Map<StampGrainDepthSource, Float32Array>>();
/** `marks` as instance floats (STAMP_FLOATS each), their grain depth by pressure from `source` (stampGrainDepthSourceIn). */
export const stampInstanceFloats = (marks: StampMarks, source: StampGrainDepthSource) => rememberedFor(instanceFloats, marks, source, () => {
  const floats = new Float32Array(marks.length * STAMP_FLOATS);
  marks.forEach((s, i) => floats.set(
    [s.x, s.y, s.diameter, s.rotation, s.alpha, s.blur, s.grainTurn, (s.flipX ? 1 : 0) + (s.flipY ? 2 : 0), s.opacity, s.roundness, stampGrainDepthBy(s, source), s.pressure], i * STAMP_FLOATS,
  ));
  return floats;
});

const tintFloats = new WeakMap<StampMarks, Float32Array>();
/** `marks`' tints as floats (TINT_FLOATS each). */
export const stampTintFloats = (marks: StampMarks) => rememberedOnce(tintFloats, marks, () => {
  const floats = new Float32Array(marks.length * TINT_FLOATS);
  marks.forEach(({ tint: t }, i) => floats.set([t.hue, t.saturation, t.lightness, t.secondary], i * TINT_FLOATS));
  return floats;
});

const plans = new WeakMap<StampMarks, Map<StampAccumulation['kind'], StampAccumulationPlan>>();
/** How the GPU lays `marks` under `accumulation` (stampAccumulationPlan), which reads only its kind. */
export const stampMarksPlan = (marks: StampMarks, accumulation: StampAccumulation) => rememberedFor(plans, marks, accumulation.kind, () => stampAccumulationPlan(accumulation, marks));

const orderedBins = new WeakMap<StampMarks, Map<StampTipFootprint, Map<string, Uint32Array>>>();
/**
 * An `ordered` layer's bins, as if at the bin buffer's start: per tile (STAMP_ORDERED_TILE texels, row by row, a
 * stamp's texel being its point plus the stage's `margin`) the entry its stamps start at, one past the last tile's,
 * then each tile's stamps reaching into it, by index in order. Laid further in, the table moves with it
 * (stampBinsAppended).
 */
export function stampMarksOrderedBins(marks: StampMarks, shape: StampTipFootprint, tilesX: number, tilesY: number, margin: number): Uint32Array {
  const byTiles = rememberedFor(orderedBins, marks, shape, () => new Map<string, Uint32Array>());
  return rememberedOnce(byTiles, `${tilesX} ${tilesY} ${margin}`, () => binsOf(marks, shape, tilesX, tilesY, margin));
}

/** Calls `visit` with each of `marks`' tiles its support reaches (stamp `i` in tile `t`), stamp by stamp, in order. */
function eachStampTile(marks: StampMarks, shape: StampTipFootprint, tilesX: number, tilesY: number, margin: number, visit: (i: number, t: number) => void) {
  const tileOf = (v: number, count: number) => Math.min(count - 1, Math.max(0, Math.floor((v + margin) / STAMP_ORDERED_TILE)));
  const hull = stampMarksTipHull(shape, marks);
  marks.forEach((s, i) => {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    stampPlacedSupportInto(shape, hull, s, box);
    for (let ty = tileOf(box[1], tilesY); ty <= tileOf(box[3], tilesY); ty++) {
      for (let tx = tileOf(box[0], tilesX); tx <= tileOf(box[2], tilesX); tx++) visit(i, ty * tilesX + tx);
    }
  });
}

/** `marks`' bins as stampMarksOrderedBins lays them, each stamp in every tile its support reaches. */
function binsOf(marks: StampMarks, shape: StampTipFootprint, tilesX: number, tilesY: number, margin: number): Uint32Array {
  const tiles = Array.from({ length: tilesX * tilesY }, (): number[] => []);
  eachStampTile(marks, shape, tilesX, tilesY, margin, (i, t) => tiles[t].push(i));
  const table: number[] = [];
  let entry = tiles.length + 1;
  for (const tile of tiles) {
    table.push(entry);
    entry += tile.length;
  }
  table.push(entry);
  return Uint32Array.from([...table, ...tiles.flat()]);
}

/** How long `marks`' bins are (stampMarksOrderedBins), counted without laying them: what a painting's load is weighed by. */
export function stampMarksOrderedBinsLength(marks: StampMarks, shape: StampTipFootprint, tilesX: number, tilesY: number, margin: number): number {
  let entries = tilesX * tilesY + 1;
  eachStampTile(marks, shape, tilesX, tilesY, margin, () => entries++);
  return entries;
}

/** Appends `bins` (stampMarksOrderedBins) to `into`, its table moved to where it lands; returns where. */
export function stampBinsAppended(bins: Uint32Array, into: number[]): number {
  // The table's first entry is its own length, the tiles and one past the last, as its stamps start after it.
  const at = into.length, table = bins[0];
  bins.forEach((value, i) => into.push(i < table ? value + at : value));
  return at;
}
