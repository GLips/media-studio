// stamp-mark-load.ts: what loading a painting onto the GPU works out from a deposit's placed marks (floats, plan,
// bins): the plan and bins once a set of marks, as a recompiled painting shares its unchanged deposits'
// (stamp-deposit-placement.ts); the floats as they load, a copy of the rows.
//
// Remembered weakly against the marks, so given up with them: right as FrozenStampMarks never change, and each key
// holds all else its value reads. What's returned is shared by every renderer: copy it, never write it.

import { stampAccumulationPlan, type StampAccumulationPlan } from './stamp-deposit-stages.ts';
import type { StampAccumulation } from '#lib/paint/brush/models/stamp-brush.ts';
import { STAMP_MARK, STAMP_MARK_FIELDS, type FrozenStampMarks } from '#lib/paint/brush/models/stamp-mark-rows.ts';
import { stampGrainDepthIn, type StampGrainDepthSource } from './stamp-paper-contact.ts';
import { stampMarksTipHull, stampPlacedSupportInto, type StampTipFootprint } from './stamp-tip-support.ts';
import { rememberedFor, rememberedOnce } from './stamp-remembered.ts';

/** A deposit's marks, or its dual's, as compiled: the key everything here is remembered by. */
type StampMarks = FrozenStampMarks;

/**
 * Floats per stamp in the instance buffer: x, y, diameter, rotation, then alpha, blur, grain turn and flips (x 1, y 2),
 * then opacity, roundness, grain depth and pressure, then where it was placed (its x and y, unless a pose moved it).
 */
export const STAMP_FLOATS = 14;
/** Floats per stamp in the tint buffer, for a brush with colour dynamics: hue, saturation, lightness, secondary. */
export const TINT_FLOATS = 4;
/** Pixels a side of the tiles an `ordered` layer's stamps are binned by (stampMarksOrderedBins). */
export const STAMP_ORDERED_TILE = 32;

/**
 * Writes `marks` as instance floats (STAMP_FLOATS each) into `into` from stamp `at`, their grain depth by pressure from
 * `source` (STAMP_PRESSURE_GRAIN_OWNER): their rows in the GPU's order, the two grain depths put together.
 */
export function stampInstanceFloatsInto(marks: StampMarks, source: StampGrainDepthSource, into: Float32Array, at: number): void {
  const r = marks.rows, M = STAMP_MARK;
  for (let i = 0, o = 0, f = at * STAMP_FLOATS; i < marks.length; i++, o += STAMP_MARK_FIELDS, f += STAMP_FLOATS) {
    into[f] = r[o + M.x]; into[f + 1] = r[o + M.y]; into[f + 2] = r[o + M.diameter]; into[f + 3] = r[o + M.rotation];
    into[f + 4] = r[o + M.alpha]; into[f + 5] = r[o + M.blur]; into[f + 6] = r[o + M.grainTurn]; into[f + 7] = r[o + M.flips];
    into[f + 8] = r[o + M.opacity]; into[f + 9] = r[o + M.roundness];
    into[f + 10] = stampGrainDepthIn(r[o + M.grainDepth], r[o + M.grainDepthByPressure], source);
    into[f + 11] = r[o + M.pressure]; into[f + 12] = r[o + M.restX]; into[f + 13] = r[o + M.restY];
  }
}

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
  const hull = stampMarksTipHull(shape, marks), box = [0, 0, 0, 0];
  for (let i = 0; i < marks.length; i++) {
    box[0] = Infinity; box[1] = Infinity; box[2] = -Infinity; box[3] = -Infinity;
    stampPlacedSupportInto(shape, hull, marks, i, box);
    for (let ty = tileOf(box[1], tilesY); ty <= tileOf(box[3], tilesY); ty++) {
      for (let tx = tileOf(box[0], tilesX); tx <= tileOf(box[2], tilesX); tx++) visit(i, ty * tilesX + tx);
    }
  }
}

/**
 * `marks`' bins as stampMarksOrderedBins lays them, each stamp in every tile its support reaches: each (stamp, tile)
 * met is gathered in order, then counted into its tile's place, so a tile's stamps keep their order.
 */
function binsOf(marks: StampMarks, shape: StampTipFootprint, tilesX: number, tilesY: number, margin: number): Uint32Array {
  const tiles = tilesX * tilesY, counts = new Uint32Array(tiles);
  let met = new Uint32Array(Math.max(16, 4 * marks.length)), n = 0;
  eachStampTile(marks, shape, tilesX, tilesY, margin, (i, t) => {
    if (n + 2 > met.length) {
      const grown = new Uint32Array(2 * met.length);
      grown.set(met);
      met = grown;
    }
    met[n++] = i;
    met[n++] = t;
    counts[t]++;
  });
  const bins = new Uint32Array(tiles + 1 + n / 2);
  let entry = tiles + 1;
  for (let t = 0; t < tiles; t++) {
    bins[t] = entry;
    entry += counts[t];
  }
  bins[tiles] = entry;
  const next = bins.slice(0, tiles);
  for (let k = 0; k < n; k += 2) bins[next[met[k + 1]]++] = met[k];
  return bins;
}

/** How long `marks`' bins are (stampMarksOrderedBins), counted without laying them: what a painting's load is weighed by. */
export function stampMarksOrderedBinsLength(marks: StampMarks, shape: StampTipFootprint, tilesX: number, tilesY: number, margin: number): number {
  let entries = tilesX * tilesY + 1;
  eachStampTile(marks, shape, tilesX, tilesY, margin, () => entries++);
  return entries;
}

/**
 * A bin buffer's contents, gathered: `append` lays an ordered layer's bins (stampMarksOrderedBins) after the last and
 * says where they start; `data` is them all, each table moved to where its bins landed.
 */
export function createStampBinBuffer() {
  const parts: Uint32Array[] = [];
  let length = 0;
  return {
    append(bins: Uint32Array): number {
      const at = length;
      parts.push(bins);
      length += bins.length;
      return at;
    },
    data(): Uint32Array {
      const out = new Uint32Array(Math.max(1, length));
      let at = 0;
      for (const bins of parts) {
        out.set(bins, at);
        // The table's first entry is its own length, the tiles and one past the last, as its stamps start after it.
        for (let i = 0; i < bins[0]; i++) out[at + i] += at;
        at += bins.length;
      }
      return out;
    },
  };
}
