// stamp-gate-wet-laws.ts: the GPU gate's grids over a wash's per-pixel laws (stamp-wet-landing.ts, stamp-wet-lift.ts).
// The laws are still being tuned, so their grids are held to properties a painter would swear to, not to a baseline:
// landing paint lies between the paint there and the stroke, or on workable paper adds to it; a brush's water hardens
// its edge only on paper drier than it; a lift never adds pigment nor leaves less than none, takes at most its cover
// times strength, takes less of a staining pigment, and keeps pigments staining alike in proportion, so a tint keeps
// its hue.
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
 * wetLift over layers whose four amounts are equal and stain more lane by lane, and over uneven amounts, some of them
 * none, staining alike, thicker than the fibres hold and thinner: each lane at every cover, strength and workability,
 * open, half set and set, set paint loosening by none, some and all.
 */
function wetLiftGrid(): StampGateFormulaGrid {
  const layers: readonly { was: Vec4; stain: Vec4; rising: boolean }[] = [
    { was: [0.8, 0.8, 0.8, 0.8], stain: [0, 0.3, 0.6, 0.9], rising: true },
    { was: [0.5, 1.5, 0.125, 0], stain: [0.25, 0.25, 0.25, 0.25], rising: false },
    { was: [0.1, 0.2, 0.05, 0], stain: [0.5, 0.5, 0.5, 0.5], rising: false },
  ];
  const entries = layers.flatMap(({ was, stain, rising }) => COARSE.flatMap((cover) => COARSE.flatMap((strength) => COARSE.flatMap((workable) => [0, 0.5, 1].flatMap((open) => [0, 0.375, 1].flatMap((rewetting) => LANES.map((lane): LawRow => ({
    label: `was ${vec(was)} stain ${vec(stain)} cover ${cover} strength ${strength} workable ${workable} open ${open} rewetting ${rewetting} lane ${lane}`,
    inputs: [...was, was.reduce((a, b) => a + b, 0), cover, strength, workable, open, rewetting, ...stain, lane], lane, was, cover, bound: rising ? 1 : 0,
  }))))))));
  // Rows come four lanes at a time, so a lane's neighbour below is the one staining less in the evenly laid layer,
  // and lane 0 the one every layer lays some of.
  return propertyGrid('wetLift', 'wetLift(vec4f(x(0), x(1), x(2), x(3)), x(4), x(5), x(6), x(7), x(8), x(9), vec4f(x(10), x(11), x(12), x(13)))[u32(x(14))]', 15, entries, (row, out, gpu, i) => {
    const was = row.was[row.lane], strength = row.inputs[6];
    if (out > was + TOL) return `lifting added pigment (was ${was})`;
    if (out < -TOL) return 'lifting left less than none';
    if (was - out > Math.min(1, row.cover * strength) * was + TOL) return `lifting took more than its cover times strength (was ${was})`;
    if ((row.cover === 0 || strength === 0) && Math.abs(out - was) > TOL) return `a lift that reaches nothing moved paint (was ${was})`;
    if (row.bound && row.lane > 0 && out < gpu[i - 1] - TOL) return `a pigment staining more lost more than its neighbour staining less (${gpu[i - 1]})`;
    const first = gpu[i - row.lane] / row.was[0];
    if (!row.bound && was > 0 && !(Math.abs(out / was - first) <= TOL / was)) return `pigments staining alike kept different shares (${out / was} against ${first})`;
    return null;
  });
}

/**
 * wetLand over bare and painted layers, of an even and an uneven stroke, each lane at every cover and workability,
 * under paint covering none, half and all of the pixel that picks up none or half.
 */
function wetLandGrid(): StampGateFormulaGrid {
  const layers: readonly Vec4[] = [[0, 0, 0, 0], [0.5, 0.25, 0, 1]];
  const strokes: readonly Vec4[] = [[0.625, 0, 0.3125, 1], [0.25, 0.25, 0.25, 0.25]];
  const entries = layers.flatMap((was) => strokes.flatMap((incoming) => COARSE.flatMap((cover) => [0, 0.5, 1].flatMap((under) => [0, 0.5].flatMap((pickup) => COARSE.flatMap((workable) => LANES.map((lane): LawRow => ({
    label: `was ${vec(was)} incoming ${vec(incoming)} cover ${cover} under ${under} pickup ${pickup} workable ${workable} lane ${lane}`,
    inputs: [...was, ...incoming, cover, under, pickup, workable, lane], lane, was, cover, bound: incoming[lane],
  }))))))));
  return propertyGrid('wetLand', 'wetLand(vec4f(x(0), x(1), x(2), x(3)), vec4f(x(4), x(5), x(6), x(7)), x(8), x(9), x(10), x(11))[u32(x(12))]', 13, entries, (row, out) => {
    const was = row.was[row.lane], workable = row.inputs[11];
    if (out < Math.min(was, row.bound) - TOL) return `landing left less than the paint there or the stroke (was ${was}, stroke ${row.bound})`;
    if (out > was + row.bound + TOL) return `landing laid more than a full stroke carries (was ${was}, stroke ${row.bound})`;
    if (workable === 1 && out < was - TOL) return `landing on workable paper took pigment away (was ${was})`;
    if (row.cover === 0 && Math.abs(out - was) > TOL) return `paint that doesn't reach here moved it (was ${was})`;
    return null;
  });
}

/** wetLandCover at every cover of a light and a full body, for a brush with no water, some and plenty, on paper dry, damp and wet. */
function wetLandCoverGrid(): StampGateFormulaGrid {
  const covers = Array.from({ length: 21 }, (_, k) => k / 20);
  const entries = [0.4, 1].flatMap((body) => [0, 0.5, 1].flatMap((water) => [0, 0.5, 1].flatMap((wetness) => covers.map((cover): LawRow => ({
    label: `cover ${cover} body ${body} water ${water} wetness ${wetness}`, inputs: [cover, body, water, wetness], lane: 0, was: [0, 0, 0, 0], cover, bound: body,
  })))));
  return propertyGrid('wetLandCover', 'wetLandCover(x(0), x(1), x(2), x(3))', 4, entries, (row, out, gpu, i) => {
    const [cover, , water, wetness] = row.inputs;
    if (out < -TOL || out > Math.max(cover, row.bound) + TOL) return 'coverage past the stroke\'s body';
    if (water <= wetness && Math.abs(out - cover) > TOL) return 'paper as wet as the brush hardened its edge';
    if (cover > 0 && out < gpu[i - 1] - TOL) return 'more of the tip landed less';
    return null;
  });
}

/** The wet laws' property grids. */
export const stampGateWetLawGrids = (): StampGateFormulaGrid[] => [wetLandCoverGrid(), wetLandGrid(), wetLiftGrid()];
