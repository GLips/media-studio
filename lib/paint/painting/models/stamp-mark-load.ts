// stamp-mark-load.ts: what loading a painting onto the GPU works out from a deposit's placed marks (floats, reach,
// plan, bins), once a set of marks: a recompiled painting shares its unchanged deposits' (stamp-deposit-placement.ts).
//
// Remembered weakly against the marks, so given up with them: right as FrozenStampMarks never change, and each key
// holds all else its value reads. What's returned is shared by every renderer: copy it, never write it.

import { stampAccumulationPlan, type StampAccumulationPlan } from './stamp-deposit-stages.ts';
import type { StampAccumulation } from '#lib/paint/brush/models/stamp-brush.ts';
import type { FrozenStampMarks } from '#lib/paint/brush/models/stamp-placement.ts';
import { stampGrainDepthBy, type StampGrainDepthSource } from './stamp-pigment-paint.ts';

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
/** Stamps whose bounds are kept together: a box is found from the chunks before it and the stamps within its own. */
const REACH_CHUNK = 256;

/** `make()` for `marks`, worked out the first time it's asked for. */
function rememberedOnce<V>(cache: WeakMap<StampMarks, V>, marks: StampMarks, make: () => V): V {
  let value = cache.get(marks);
  if (value === undefined) cache.set(marks, (value = make()));
  return value;
}

/** `make()` for `marks` under `key`, worked out the first time it's asked for. */
function rememberedFor<K, V>(cache: WeakMap<StampMarks, Map<K, V>>, marks: StampMarks, key: K, make: () => V): V {
  let byKey = cache.get(marks);
  if (!byKey) cache.set(marks, (byKey = new Map<K, V>()));
  let value = byKey.get(key);
  if (value === undefined) byKey.set(key, (value = make()));
  return value;
}

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

/** What picks the coarsest tip level `marks` read: their smallest diameter, most blur and least roundness. */
export type StampMarksExtremes = { smallest: number; blurred: number; roundest: number };
const extremes = new WeakMap<StampMarks, StampMarksExtremes>();
/** `marks`' extremes; with none, Infinity, 0 and 1. */
export const stampMarksExtremes = (marks: StampMarks): StampMarksExtremes => rememberedOnce(extremes, marks, () => ({
  smallest: marks.reduce((least, s) => Math.min(least, s.diameter), Infinity),
  blurred: marks.reduce((most, s) => Math.max(most, s.blur), 0),
  roundest: marks.reduce((least, s) => Math.min(least, s.roundness), 1),
}));

const reaches = new WeakMap<StampMarks, Map<number, Float64Array>>();
/**
 * How far `marks` reach, for each whole chunk of them from the first: x0, y0, x1, y1 of stamps 0 to the chunk's end.
 * A stamp's corners reach 0.75 of its tip image's longer side (`span` diameters) from its centre, however it's turned.
 */
const reachChunks = (marks: StampMarks, span: number) => rememberedFor(reaches, marks, span, () => {
  const chunks = new Float64Array(Math.floor(marks.length / REACH_CHUNK) * 4);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < chunks.length / 4 * REACH_CHUNK; i++) {
    const s = marks[i], r = s.diameter * span * 0.75;
    x0 = Math.min(x0, s.x - r); y0 = Math.min(y0, s.y - r); x1 = Math.max(x1, s.x + r); y1 = Math.max(y1, s.y + r);
    if ((i + 1) % REACH_CHUNK === 0) chunks.set([x0, y0, x1, y1], ((i + 1) / REACH_CHUNK - 1) * 4);
  }
  return chunks;
});

/** Grows `into` (x0, y0, x1, y1) by where the first `count` of `marks` reach at `span`, from their chunks and the rest. */
export function stampMarksReachOfFirst(marks: StampMarks, span: number, count: number, into: number[]) {
  const whole = Math.floor(count / REACH_CHUNK), chunks = reachChunks(marks, span);
  if (whole) {
    const at = (whole - 1) * 4;
    into[0] = Math.min(into[0], chunks[at]); into[1] = Math.min(into[1], chunks[at + 1]);
    into[2] = Math.max(into[2], chunks[at + 2]); into[3] = Math.max(into[3], chunks[at + 3]);
  }
  for (let i = whole * REACH_CHUNK; i < count; i++) {
    const s = marks[i], r = s.diameter * span * 0.75;
    into[0] = Math.min(into[0], s.x - r); into[1] = Math.min(into[1], s.y - r); into[2] = Math.max(into[2], s.x + r); into[3] = Math.max(into[3], s.y + r);
  }
}

const orderedBins = new WeakMap<StampMarks, Map<string, Uint32Array>>();
/**
 * An `ordered` layer's bins, as if at the bin buffer's start: per tile (STAMP_ORDERED_TILE pixels, row by row) the
 * entry its stamps start at, one past the last tile's, then each tile's stamps reaching into it, by index in order.
 * Laid further in, the table moves with it (stampBinsAppended).
 */
export const stampMarksOrderedBins = (marks: StampMarks, span: number, tilesX: number, tilesY: number) => rememberedFor(orderedBins, marks, `${span} ${tilesX} ${tilesY}`, () => {
  const tiles = Array.from({ length: tilesX * tilesY }, (): number[] => []);
  const tileOf = (v: number, count: number) => Math.min(count - 1, Math.max(0, Math.floor(v / STAMP_ORDERED_TILE)));
  marks.forEach((s, i) => {
    const r = s.diameter * span * 0.75;
    for (let ty = tileOf(s.y - r, tilesY); ty <= tileOf(s.y + r, tilesY); ty++) {
      for (let tx = tileOf(s.x - r, tilesX); tx <= tileOf(s.x + r, tilesX); tx++) tiles[ty * tilesX + tx].push(i);
    }
  });
  const table: number[] = [];
  let entry = tiles.length + 1;
  for (const tile of tiles) {
    table.push(entry);
    entry += tile.length;
  }
  table.push(entry);
  return Uint32Array.from([...table, ...tiles.flat()]);
});

/** Appends `bins` (stampMarksOrderedBins) to `into`, its table moved to where it lands; returns where. */
export function stampBinsAppended(bins: Uint32Array, into: number[]): number {
  // The table's first entry is its own length, the tiles and one past the last, as its stamps start after it.
  const at = into.length, table = bins[0];
  bins.forEach((value, i) => into.push(i < table ? value + at : value));
  return at;
}
