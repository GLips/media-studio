// stamp-gate-wet-laws.ts: the GPU gate's grids over a wash's per-pixel laws, wetLand (stamp-wet-landing.ts) and
// wetLift (stamp-wet-lift.ts). The laws are still being tuned, so their grids are held to properties a painter would
// swear to, not to a baseline: paint landing never takes paint away nor lays more than the brush carries; a lift
// never adds pigment, never leaves less than none, takes at most its cover times strength of any, and takes less of a
// staining pigment than of one that isn't.
//
// A row is one lane of a law's four amounts, so a property can compare lanes the law worked out together.

import type { StampGateFormulaGrid } from './stamp-gate-formulas.ts';

/** How far past a bound an f32 law may land: a few ulps of the amounts gridded here, none of which pass 2. */
export const STAMP_GATE_WET_LAW_TOLERANCE = 1e-5;

const COARSE = [0, 0.25, 0.5, 0.75, 1];
const LANES = [0, 1, 2, 3];
type Vec4 = readonly [number, number, number, number];

/** A property's row, its inputs and what the check reads of them. */
type LawRow = { label: string; inputs: readonly number[]; lane: number; was: Vec4; cover: number; bound: number };

/** A property grid's check: how many rows break it and the first that does, with what the GPU gave there. */
export type StampGatePropertyResult = { over: number; first: string | null };

function propertyGrid(formula: string, call: string, width: number, entries: readonly LawRow[], broken: (row: LawRow, out: number, gpu: ArrayLike<number>, i: number) => string | null): StampGateFormulaGrid {
  const rows = new Float32Array(entries.length * width);
  entries.forEach(({ inputs }, i) => rows.set(inputs, i * width));
  return {
    formula, call, width, rows, labels: entries.map((e) => e.label),
    expected: { kind: 'property', check: (gpu) => {
      let over = 0, first: string | null = null;
      entries.forEach((row, i) => {
        const out = gpu[i], problem = Number.isFinite(out) ? broken(row, out, gpu, i) : 'not finite';
        if (!problem) return;
        over++;
        first ??= `${row.label}: ${problem} (gpu ${out})`;
      });
      return { over, first };
    } },
  };
}

const TOL = STAMP_GATE_WET_LAW_TOLERANCE;
const vec = (v: Vec4) => `(${v.join(', ')})`;

/**
 * wetLift over layers whose four amounts are equal and stain more lane by lane, and over uneven amounts some of them
 * none: each lane at every cover, strength and workability, set paint loosening as none, watercolour, crayon and all.
 */
function wetLiftGrid(): StampGateFormulaGrid {
  const layers: readonly { was: Vec4; stain: Vec4 }[] = [
    { was: [0.8, 0.8, 0.8, 0.8], stain: [0, 0.3, 0.6, 0.9] },
    { was: [0.5, 1.5, 0.125, 0], stain: [0.25, 0.25, 0.25, 0.25] },
  ];
  const entries = layers.flatMap(({ was, stain }, k) => COARSE.flatMap((cover) => COARSE.flatMap((strength) => COARSE.flatMap((workable) => [0, 0.375, 0.875, 1].flatMap((rewetting) => LANES.map((lane): LawRow => ({
    label: `was ${vec(was)} stain ${vec(stain)} cover ${cover} strength ${strength} workable ${workable} rewetting ${rewetting} lane ${lane}`,
    inputs: [...was, cover, strength, workable, rewetting, ...stain, lane], lane, was, cover, bound: k === 0 ? 1 : 0,
  })))))));
  // Rows come four lanes at a time, so a lane's neighbour below is the one staining less, in the evenly laid layer.
  return propertyGrid('wetLift', 'wetLift(vec4f(x(0), x(1), x(2), x(3)), x(4), x(5), x(6), x(7), vec4f(x(8), x(9), x(10), x(11)))[u32(x(12))]', 13, entries, (row, out, gpu, i) => {
    const was = row.was[row.lane], strength = row.inputs[5];
    if (out > was + TOL) return `lifting added pigment (was ${was})`;
    if (out < -TOL) return 'lifting left less than none';
    if (was - out > Math.min(1, row.cover * strength) * was + TOL) return `lifting took more than its cover times strength (was ${was})`;
    if ((row.cover === 0 || strength === 0) && Math.abs(out - was) > TOL) return `a lift that reaches nothing moved paint (was ${was})`;
    if (row.bound && row.lane > 0 && out < gpu[i - 1] - TOL) return `a pigment staining more lost more than its neighbour staining less (${gpu[i - 1]})`;
    return null;
  });
}

/** wetLand over bare and painted layers, of an even and an uneven stroke, each lane at every cover, wetness and workability. */
function wetLandGrid(): StampGateFormulaGrid {
  const layers: readonly Vec4[] = [[0, 0, 0, 0], [0.5, 0.25, 0, 1]];
  const strokes: readonly Vec4[] = [[0.625, 0, 0.3125, 1], [0.25, 0.25, 0.25, 0.25]];
  const entries = layers.flatMap((was) => strokes.flatMap((incoming) => COARSE.flatMap((cover) => COARSE.flatMap((wetness) => COARSE.flatMap((workable) => LANES.map((lane): LawRow => ({
    label: `was ${vec(was)} incoming ${vec(incoming)} cover ${cover} wetness ${wetness} workable ${workable} lane ${lane}`,
    inputs: [...was, ...incoming, cover, wetness, workable, lane], lane, was, cover, bound: incoming[lane],
  })))))));
  return propertyGrid('wetLand', 'wetLand(vec4f(x(0), x(1), x(2), x(3)), vec4f(x(4), x(5), x(6), x(7)), x(8), x(9), x(10))[u32(x(11))]', 12, entries, (row, out) => {
    const was = row.was[row.lane];
    if (out < was - TOL) return `landing paint took pigment away (was ${was})`;
    if (out > was + row.bound + TOL) return `landing laid more than a full stroke carries (was ${was}, stroke ${row.bound})`;
    if (row.cover === 0 && Math.abs(out - was) > TOL) return `paint that doesn't reach here moved it (was ${was})`;
    return null;
  });
}

/** The wet laws' property grids. */
export const stampGateWetLawGrids = (): StampGateFormulaGrid[] => [wetLandGrid(), wetLiftGrid()];
