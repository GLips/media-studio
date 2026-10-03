// stamp-gate-formulas.ts: the grids the GPU gate runs the renderer's WGSL formulas over. A grid is a WGSL call over
// one row of inputs at a time; the page (stamp-gate-page.ts) runs every row on the GPU in f32.
//
// A rendering formula lives only in WGSL, so its grid is held to an accepted baseline (engine/stamp-gate-store.ts).
// A runtime twin has a CPU side the studio also runs (Kubelka–Munk, a paint field, a region's distance and grid, an
// area's coverage), so
// its grid is held to that; so is each dual mode's needsDual. A law still being tuned (stamp-gate-wet-laws.ts) is held
// to properties.
//
// Grid steps are 16ths or 32nds, exact in f32 and f64, so thresholds fall the same way on both.

import { kubelkaMunkFilm, kubelkaMunkOver } from '#lib/paint/materials/models/paint-kubelka-munk.ts';
import { PHOTOSHOP_POOLING, STAMP_DUAL_BLENDS, STAMP_GRAIN_BLENDS, stampDualModeIndex, stampDualNeedsDual, stampGrainModeIndex } from '#lib/paint/brush/models/coverage-formulas.ts';
import { STAMP_ACCUMULATION_KINDS, stampAccumulationIndex } from '#lib/paint/painting/models/stamp-deposit-stages.ts';
import { STAMP_PAINT_FIELD_SHARE } from '#lib/paint/painting/models/stamp-paint-field.ts';
import { stampAreaCoverageAt } from '#lib/paint/painting/models/stamp-area.ts';
import { stampTipPressedShare, stampTipTouch } from '#lib/paint/painting/models/stamp-wet-contact.ts';
import { stampLandedWetness, stampWetnessAt, stampWorkableAt } from '#lib/paint/painting/models/stamp-wetness.ts';
import { stampBloomSigma } from '#lib/paint/painting/models/stamp-wet-bloom.ts';
import { stampDryingRimBand, stampDryingRimWetShare } from '#lib/paint/painting/models/stamp-wet-rim.ts';
import type { CompiledStampBoundary } from '#lib/paint/painting/models/stamp-area-boundaries.ts';
import { STAMP_RINGED_COUNT, stampDistanceGrid, stampGridAt, stampPolygonBox, stampPolygonDistance, stampRegionPolygon, stampRingsDistance, stampRingsLayout, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampGateWetLawGrids, type StampGatePropertyResult } from './stamp-gate-wet-laws.ts';

/**
 * A formula's grid: `call` a WGSL expression over `x(0)`, `x(1)`, … (a row's inputs), `rows` its inputs, `labels` what
 * each row is. `points` and `grid` fill the storage arrays polygonDistance and gridAt read. A twin's `expected` is its
 * CPU side's answer for each row; a rendering formula's is its baseline; a property grid's `check` reads the GPU's rows.
 */
export type StampGateFormulaGrid = {
  formula: string;
  call: string;
  width: number;
  rows: Float32Array;
  labels: string[];
  points?: Float32Array;
  grid?: Float32Array;
  /** The storage array boundaryShift reads: a vec4f a boundary (its path's first point and count, merge, reach). */
  boundaries?: Float32Array;
  expected: { kind: 'baseline' } | { kind: 'twin'; values: Float64Array } | { kind: 'property'; check: (gpu: ArrayLike<number>) => StampGatePropertyResult };
};

/** How far the GPU may sit from what it's held to: f32 arithmetic, well inside what a half-float target keeps (about 1e-3). */
export const STAMP_GATE_FORMULA_TOLERANCE = 1e-4;

const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);
const UNIT = steps(32), HALF = steps(16), COARSE = steps(4);

type Row = { label: string; inputs: readonly number[] };

function baselineGrid(formula: string, call: string, width: number, entries: readonly Row[]): StampGateFormulaGrid {
  const rows = new Float32Array(entries.length * width);
  entries.forEach(({ inputs }, i) => rows.set(inputs, i * width));
  return { formula, call, width, rows, labels: entries.map((e) => e.label), expected: { kind: 'baseline' } };
}

function twinGrid(formula: string, call: string, width: number, entries: readonly (Row & { expected: number })[], storage: Pick<StampGateFormulaGrid, 'points' | 'grid' | 'boundaries'> = {}): StampGateFormulaGrid {
  return { ...baselineGrid(formula, call, width, entries), ...storage, expected: { kind: 'twin', values: Float64Array.from(entries, (e) => e.expected) } };
}

const blendName = (b: { family: string; mode: string }) => `${b.family} ${b.mode}`;

/** The rendering formulas, each over its grid: every mode of each family, the adjustments' cases, each accumulation, the regions', the paper's. */
function renderingGrids(): StampGateFormulaGrid[] {
  const grainCut = STAMP_GRAIN_BLENDS.flatMap((blend) => HALF.flatMap((a) => HALF.flatMap((v) => COARSE.map((d) => ({
    label: `${blendName(blend)} a ${a} v ${v} d ${d}`, inputs: [a, v, d, stampGrainModeIndex(blend), blend.family === 'layer' ? 1 : 0],
  })))));
  const dualCombine = STAMP_DUAL_BLENDS.flatMap((blend) => UNIT.flatMap((p) => UNIT.map((s) => ({
    label: `${blendName(blend)} p ${p} s ${s}`, inputs: [p, s, stampDualModeIndex(blend), blend.family === 'layer' ? 1 : 0],
  }))));
  const grainPaint = (['midGrey', 'mean'] as const).flatMap((pivot) => [0.25, 0.625].flatMap((mean) => [-1, -0.5, -0.125, 0, 0.125, 0.5, 1].flatMap((brightness) =>
    [-1, -0.5, -0.125, 0, 0.125, 0.5, 0.875, 0.999, 1].flatMap((contrast) => HALF.map((raw) => ({
      label: `${pivot} mean ${mean} brightness ${brightness} contrast ${contrast} raw ${raw}`, inputs: [raw, brightness, contrast, pivot === 'mean' ? 1 : 0, mean],
    }))))));
  const pooled = [PHOTOSHOP_POOLING, { peak: 1, body: 0.5 }, { peak: 0.5, body: 0.875 }].flatMap((pooling) => steps(128).map((c) => ({
    label: `peak ${pooling.peak.toFixed(3)} body ${pooling.body.toFixed(3)} c ${c}`, inputs: [c, pooling.peak, pooling.body],
  })));
  const resolve = STAMP_ACCUMULATION_KINDS.flatMap((kind) => COARSE.flatMap((built) => COARSE.flatMap((densest) => COARSE.flatMap((cap) => [0, 0.5, 1].map((build) => ({
    label: `${kind} built ${built} densest ${densest} cap ${cap} build ${build}`, inputs: [built, densest, cap, build, stampAccumulationIndex(kind)],
  }))))));
  const lay = STAMP_ACCUMULATION_KINDS.flatMap((kind) => HALF.flatMap((built) => COARSE.flatMap((laid) => HALF.map((opacity) => ({
    label: `${kind} built ${built} laid ${laid} opacity ${opacity}`, inputs: [built, laid, opacity, stampAccumulationIndex(kind)],
  })))));
  const tipNoise = HALF.flatMap((a) => HALF.flatMap((n) => COARSE.map((depth) => ({ label: `a ${a} n ${n} depth ${depth}`, inputs: [a, n, depth] }))));
  // Pixels and seeds as small whole numbers, which the grid's f32 rows hold exactly.
  const tipNoiseAt = [0, 1, 7, 255, 4095].flatMap((x) => [0, 3, 1000, 65535].flatMap((y) => [0, 1, 12345, 1 << 23].map((seed) => ({ label: `x ${x} y ${y} seed ${seed}`, inputs: [x, y, seed] }))));
  const pressedTip = [0.3, 1].flatMap((a) => HALF.flatMap((c) => HALF.flatMap((pressure) => [0.16, 0.5].flatMap((softness) => [1, 2.5].map((grow) => ({
    label: `a ${a} c ${c} p ${pressure} softness ${softness} grow ${grow}`, inputs: [a, c, pressure, softness, -0.2, 1.4, grow],
  }))))));
  // Regions, in painting pixels: distances and widths in eighths, points and geometry whole or in quarters.
  const edgeCoverage = steps(64).map((u) => u * 12 - 6).flatMap((sd) => [1, 4, 12.5].map((width) => ({ label: `sd ${sd} width ${width}`, inputs: [sd, width] })));
  const edgeNoise = [-3.5, 0, 0.25, 1.5, 7.75, 100.125].flatMap((x) => [-40.5, 0, 0.75, 3.25, 250.5].flatMap((y) => [0, 12345, 4000000].map((seed) => ({ label: `x ${x} y ${y} seed ${seed}`, inputs: [x, y, seed] }))));
  const settle = UNIT.flatMap((h) => [0.25, 0.5].flatMap((mean) => COARSE.flatMap((depth) => [0, 0.5].flatMap((granulation) => [0.25, 1].map((load) => ({
    label: `h ${h} mean ${mean} depth ${depth} granulation ${granulation} load ${load}`, inputs: [h, mean, depth, granulation, load],
  }))))));
  const contact = UNIT.flatMap((h) => [0.25, 0.5].flatMap((mean) => [0.5, 0.875].flatMap((tooth) => COARSE.flatMap((depth) => [0, 0.5, 1, 1.5, 2].flatMap((press) => [0, 0.5].map((filled) => ({
    label: `h ${h} mean ${mean} tooth ${tooth} depth ${depth} press ${press} filled ${filled}`, inputs: [h, mean, tooth, depth, press, filled],
  })))))));
  // Pixel centres and 24-bit seeds, which f32 holds exactly.
  const clumps = [0, 0.5, 1].flatMap((flocculation) => [0.5, 3.5, 17.5, 1023.5].flatMap((x) => [0.5, 9.5, 700.5].flatMap((y) => [0, 12345, 0xabcdef].map((seed) => ({
    label: `flocculation ${flocculation} x ${x} y ${y} seed ${seed}`, inputs: [flocculation, x, y, seed],
  })))));
  return [
    baselineGrid('edgeCoverage', 'edgeCoverage(x(0), x(1))', 2, edgeCoverage),
    baselineGrid('edgeNoise', 'edgeNoise(x(0), x(1), u32(x(2)))', 3, edgeNoise),
    baselineGrid('paintWetSettle', 'paintWetSettle(paintValley(x(0), x(1)), x(2), x(3), x(4))', 5, settle),
    baselineGrid('paintDryContact', 'paintDryContact(x(0), x(1), x(2), x(3), x(4), x(5))', 6, contact),
    baselineGrid('paintClumps', 'paintClumps(x(0), x(1), x(2), u32(x(3)))', 4, clumps),
    baselineGrid('pressedTip', 'pressedTip(x(0), x(1), x(2), x(3), x(4), x(5), x(6))', 7, pressedTip),
    baselineGrid('tipNoise', 'tipNoise(x(0), x(1), x(2))', 3, tipNoise),
    baselineGrid('tipNoiseAt', 'tipNoiseAt(u32(x(0)), u32(x(1)), u32(x(2)))', 3, tipNoiseAt),
    baselineGrid('accumulationLay', 'accumulationLay(x(0), x(1), x(2), i32(x(3)))', 4, lay),
    baselineGrid('grainCut', 'grainCut(x(0), x(1), x(2), i32(x(3)), x(4) > 0.5)', 5, grainCut),
    baselineGrid('dualCombine', 'dualCombine(x(0), x(1), i32(x(2)), x(3) > 0.5)', 4, dualCombine),
    baselineGrid('grainPaint', 'grainPaint(x(0), x(1), x(2), x(3) > 0.5, x(4))', 5, grainPaint),
    baselineGrid('pooled', 'pooled(x(0), x(1), x(2))', 3, pooled),
    baselineGrid('accumulationResolve', 'accumulationResolve(x(0), x(1), x(2), x(3), i32(x(4)))', 5, resolve),
  ];
}

/** Regions whose distances the polygon twins are read at: convex, concave, a spike thinner than a pixel's reach, a traced ellipse. */
const TWIN_POLYGONS: readonly (readonly StampPoint[])[] = [
  [{ x: 20, y: 20 }, { x: 180, y: 20 }, { x: 180, y: 140 }, { x: 20, y: 140 }],
  [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }],
  [{ x: 0, y: 300 }, { x: 195, y: 300 }, { x: 200, y: 100 }, { x: 205, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 400 }, { x: 0, y: 400 }],
  stampRegionPolygon({ kind: 'ellipse', x: 150, y: 120, radiusX: 90, radiusY: 40 }),
];

/** A paint field's share at (x, y), held to its CPU side. */
const fieldRow = ([kind, geometry]: readonly [number, readonly [number, number, number, number]], x: number, y: number) => ({
  label: `kind ${kind} [${geometry.join(',')}] at ${x},${y}`, inputs: [x, y, kind, ...geometry], expected: STAMP_PAINT_FIELD_SHARE.cpu(x, y, kind, geometry),
});

/** areaCoverage over a row: a point, its polygon's first and count, inset, ragged amount and scale, width, seed, boundaries' first and count. */
const AREA_COVERAGE_CALL = 'areaCoverage(vec2f(x(0), x(1)), u32(x(2)), u32(x(3)), x(4), vec2f(x(5), x(6)), x(7), u32(x(8)), u32(x(9)), u32(x(10)))';

/** The runtime twins, each over its grid, held to their CPU sides; and each dual mode's needsDual, held to its WGSL. */
function twinGrids(): StampGateFormulaGrid[] {
  const fieldGeometry: [number, readonly [number, number, number, number]][] = [[0, [0, 0, 0, 0]], [1, [100, 50, 300, 250]], [1, [0, 0, 0, 400]], [2, [200, 150, 120, 0]]];
  // Noise at feature sizes from a few pixels to a sky's, 24-bit seeds, read on and between its lattice and across a 1080p frame.
  const noiseGeometry: [number, readonly [number, number, number, number]][] = [[3, [7.5, 0, 0, 0]], [3, [20, 12345, 0, 0]], [3, [160, 0xabcdef, 0, 0]]];
  const paintFieldShare = [
    ...[...fieldGeometry, ...noiseGeometry].flatMap((field) => [0, 50, 125.5, 200, 400].flatMap((x) => [0, 100, 150.25, 500].map((y) => fieldRow(field, x, y)))),
    ...noiseGeometry.flatMap((field) => [-30.25, 3.5, 77.75, 1023.5, 1919.25].flatMap((x) => [-12.5, 9.25, 540.75, 1079.5].map((y) => fieldRow(field, x, y)))),
  ];
  // Films from clear to thick, pure scatterers and pure absorbers among them, over black to near white.
  const FILM = [0, 1e-3, 0.03125, 0.25, 1, 4, 32];
  const film = FILM.flatMap((absorb) => FILM.flatMap((scatter) => [0, 0.25, 0.96875].map((under) => ({
    label: `absorb ${absorb} scatter ${scatter} under ${under}`, inputs: [absorb, scatter, under],
    expected: kubelkaMunkOver(kubelkaMunkFilm({ absorb: Math.fround(absorb), scatter: Math.fround(scatter) }), under),
  }))));
  const filmT = FILM.flatMap((absorb) => FILM.map((scatter) => ({
    label: `absorb ${absorb} scatter ${scatter}`, inputs: [absorb, scatter], expected: kubelkaMunkFilm({ absorb: Math.fround(absorb), scatter: Math.fround(scatter) }).T,
  })));
  // Every polygon's points in one array, each read from its first; points at quarter pixels, so none lies on an edge.
  const points: number[] = [], firsts: number[] = [];
  for (const polygon of TWIN_POLYGONS) {
    firsts.push(points.length / 2);
    for (const { x, y } of polygon) points.push(x, y);
  }
  // Treated stretches: the square's left side merged above (20, 80) and feathered below it, meeting there; a merge
  // along the ellipse's left end. Each path's points follow the polygons'.
  const ellipse = TWIN_POLYGONS[3], leftmost = ellipse.findIndex(({ x }) => x === Math.min(...ellipse.map((p) => p.x)));
  const treated: { polygon: number; boundaries: CompiledStampBoundary[] }[] = [
    { polygon: 0, boundaries: [
      { name: 'top', path: [{ x: 20, y: 20 }, { x: 20, y: 80 }], treatment: 'merge', reach: 10 },
      { name: 'foot', path: [{ x: 20, y: 80 }, { x: 20, y: 140 }], treatment: 'feather', reach: 12 },
    ] },
    { polygon: 3, boundaries: [{ name: 'end', path: [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((k) => ellipse[(leftmost + k + ellipse.length) % ellipse.length]), treatment: 'merge', reach: 7.5 }] },
  ];
  const boundaryFloats: number[] = [];
  const boundaryFirsts = treated.map(({ boundaries }) => {
    const first = boundaryFloats.length / 4;
    for (const { path, treatment, reach } of boundaries) {
      boundaryFloats.push(points.length / 2, path.length, treatment === 'merge' ? 1 : 0, reach);
      for (const { x, y } of path) points.push(x, y);
    }
    return first;
  });
  // A region of rings read even-odd: the square, a hole in it, an island in the hole, and a ring beside the square.
  const rings: StampPoint[][] = [
    [...TWIN_POLYGONS[0]], [{ x: 60, y: 50 }, { x: 60, y: 110 }, { x: 140, y: 110 }, { x: 140, y: 50 }],
    [{ x: 90, y: 70 }, { x: 110, y: 70 }, { x: 110, y: 90 }, { x: 90, y: 90 }], [{ x: 200, y: 20 }, { x: 260, y: 20 }, { x: 260, y: 80 }, { x: 200, y: 80 }],
  ];
  const ringsFirst = points.length / 2, laidRings = stampRingsLayout(rings);
  for (const { x, y } of laidRings) points.push(x, y);
  const ringsDistance = [10.25, 40.5, 75.75, 100.25, 125.5, 190.5, 230.75].flatMap((x) => [30.25, 60.5, 80.25, 100.75, 130.5].map((y) => ({
    label: `rings at ${x},${y}`, inputs: [x, y, ringsFirst, laidRings.length], expected: stampRingsDistance(rings, x, y),
  })));
  const ringedArea = { polygon: rings[0], rings, edge: { soft: 4 }, inset: 1.5, seed: 99 };
  const ringedCoverage = [55.25, 58.5, 61.75, 64.5, 88.25, 91.5, 95.75].flatMap((x) => [60.5, 80.25].map((y) => ({
    label: `ringed area at ${x},${y}`, inputs: [x, y, ringsFirst, laidRings.length, 1.5, 0, 0, 4, 99, 0, 0], expected: stampAreaCoverageAt(ringedArea, x, y),
  })));
  const at = [-10.25, 0.25, 60.75, 150.25, 199.75, 250.25, 410.75];
  const polygonDistance = TWIN_POLYGONS.flatMap((polygon, k) => at.flatMap((x) => at.map((y) => ({
    label: `polygon ${k} at ${x},${y}`, inputs: [x, y, firsts[k], polygon.length], expected: stampPolygonDistance(polygon, x, y),
  }))));
  // A fill's distance grid over the concave region, read between its corners and past its border.
  const distance = stampDistanceGrid(TWIN_POLYGONS[1], stampPolygonBox(TWIN_POLYGONS[1], 20), 12.5);
  const gridAt = [-40.25, -3.5, 0.25, 97.75, 200.5, 333.25, 450.75].flatMap((x) => [-30.5, 0, 12.75, 199.25, 320.5].map((y) => ({
    label: `grid at ${x},${y}`, inputs: [x, y], expected: stampGridAt(distance, x, y),
  })));
  // An area's coverage across the square's left side and the ellipse's, plain, inset, soft and ragged.
  const edges = [{ inset: 0, ragged: [0, 0], width: 1 }, { inset: 3.5, ragged: [0, 0], width: 6 }, { inset: 12, ragged: [4, 6], width: 1 }, { inset: 2, ragged: [7.5, 14], width: 4 }];
  const areaCoverage = [0, 3].flatMap((k) => edges.flatMap(({ inset, ragged: [amount, scale], width }) => [12345, 4000000].flatMap((seed) => {
    const area = { polygon: TWIN_POLYGONS[k], edge: { soft: width, ...(scale > 0 && { ragged: { amount, scale } }) }, inset, seed };
    const left = k === 0 ? 20 : 60;
    return [-8.25, -0.25, 0.75, 2.25, 4.5, 9.75, 14.25, 30.5].flatMap((dx) => [80.25, 101.5, 121.75].map((y) => ({
      label: `polygon ${k} inset ${inset} ragged ${amount}/${scale} width ${width} seed ${seed} at ${left + dx},${y}`,
      inputs: [left + dx, y, firsts[k], TWIN_POLYGONS[k].length, inset, amount, scale, width, seed, 0, 0], expected: stampAreaCoverageAt(area, left + dx, y),
    })));
  })));
  // Across each treated stretch, its ends and where two meet, from outside its reach to well inside.
  const boundaryCoverage = treated.flatMap(({ polygon: k, boundaries }, b) => [0, 3.5].flatMap((inset) => {
    const area = { polygon: TWIN_POLYGONS[k], inset, seed: 777, boundaries };
    const x0 = Math.min(...TWIN_POLYGONS[k].map((p) => p.x));
    const ys = k === 0 ? [10.25, 24.5, 61.75, 79.5, 86.25, 101.5, 139.75, 150.25] : [96.5, 108.25, 119.75, 131.5, 143.25];
    return [-14.25, -8.5, -3.75, -0.25, 0.75, 4.5, 9.25, 15.75, 30.5].flatMap((dx) => ys.map((y) => ({
      label: `polygon ${k} boundaries ${boundaries.map(({ name }) => name).join('+')} inset ${inset} at ${x0 + dx},${y}`,
      inputs: [x0 + dx, y, firsts[k], TWIN_POLYGONS[k].length, inset, 0, 0, 1, 777, boundaryFirsts[b], boundaries.length], expected: stampAreaCoverageAt(area, x0 + dx, y),
    })));
  }));
  // A mode that needs the dual paints nothing where the dual has none, whatever the tip; one that doesn't paints a full tip.
  const needsDual = STAMP_DUAL_BLENDS.flatMap((blend) => (stampDualNeedsDual(blend) ? UNIT : [1]).map((tip) => ({
    label: `${blendName(blend)} tip ${tip}`, inputs: [stampDualModeIndex(blend), blend.family === 'layer' ? 1 : 0, tip], expected: stampDualNeedsDual(blend) ? 1 : 0,
  })));
  // A stamp's touch as the renderer's touch works it out: paint under, at and past where it
  // touches fully, pressed and not, and a bare tip's.
  const tipTouch = HALF.flatMap((paint) => [0, 0.5, 1].flatMap((pressed) => [0, 0.25, 0.5].map((full) => ({
    label: `paint ${paint} pressed ${pressed} full ${full}`, inputs: [paint, pressed, full], expected: stampTipTouch(paint, pressed, full),
  }))));
  const tipPressedShare = HALF.flatMap((contact) => HALF.flatMap((pressure) => [0.16, 0.5].flatMap((softness) => [1, 2.5].map((grow) => ({
    label: `contact ${contact} pressure ${pressure} softness ${softness} grow ${grow}`, inputs: [contact, pressure, softness, -0.2, 1.4, grow],
    expected: stampTipPressedShare(contact, pressure, softness, -0.2, 1.4, grow),
  })))));
  // Where water lands, as the wet field and the flow work it out: paper drier and wetter than the water, touched not at
  // all, partly and wholly, by paint and by lifts (the WGSL's negative lift is none).
  const landedWetness = HALF.flatMap((now) => HALF.flatMap((contact) => COARSE.flatMap((water) => [null, 0.5, 1].map((lift) => ({
    label: `now ${now} contact ${contact} water ${water} lift ${lift ?? 'none'}`, inputs: [now, contact, water, lift ?? -1], expected: stampLandedWetness(now, contact, water, lift),
  })))));
  // The paper a wet field's texel stands for, as the CPU's waits work it out in closed form: before, at and past its
  // paint's open time and its water's drying out.
  const drying = { rate: 0.25, openTime: 2, shiny: 0.75, damp: 0.375 };
  const paperRows = HALF.flatMap((level) => [0, 1.5].flatMap((since) => [0, 1, 2.5, 4, 8, 16].map((tau) => ({ level, since, tau })))).filter(({ since, tau }) => tau >= since);
  const wetPaper = (read: 'wetness' | 'workable') => paperRows.map(({ level, since, tau }) => ({
    label: `level ${level} at ${since} tau ${tau}`, inputs: [level, since, tau, drying.rate, drying.openTime, drying.damp],
    expected: read === 'wetness' ? stampWetnessAt(level, since, tau, drying) : stampWorkableAt(level, since, tau, drying),
  }));
  // The GPU's sizes for a bloom and a drying rim, which must stay within the CPU's bounds that size their kernels:
  // spreads none to free, tools a pixel to wider than the most, shares past both ends.
  const shares = [-0.25, ...HALF, 1.25];
  const bloomSigma = [0, 0.25, 0.5, 1, 2].flatMap((spread) => [1, 8, 24.5, 64].flatMap((diameter) => shares.map((surplus) => ({
    label: `spread ${spread} diameter ${diameter} surplus ${surplus}`, inputs: [spread, diameter, surplus], expected: stampBloomSigma(spread, diameter, surplus),
  }))));
  const dryingRimBand = [0, 0.25, 0.625, 1].flatMap((spread) => [1, 8, 40, 120].flatMap((diameter) => shares.map((wetShare) => ({
    label: `spread ${spread} diameter ${diameter} wetShare ${wetShare}`, inputs: [spread, diameter, wetShare], expected: stampDryingRimBand(spread, diameter, wetShare),
  }))));
  const dryingRimWetShare = HALF.flatMap((wettest) => [0, 0.375, 0.75, 1].map((damp) => ({
    label: `wettest ${wettest} damp ${damp}`, inputs: [wettest, damp], expected: stampDryingRimWetShare(wettest, damp),
  })));
  return [
    twinGrid('bloomSigma', 'bloomSigma(x(0), x(1), x(2))', 3, bloomSigma),
    twinGrid('dryingRimBand', 'dryingRimBand(x(0), x(1), x(2))', 3, dryingRimBand),
    twinGrid('dryingRimWetShare', 'dryingRimWetShare(x(0), x(1))', 2, dryingRimWetShare),
    twinGrid('tipTouch', 'tipTouch(x(0), x(1), x(2))', 3, tipTouch),
    twinGrid('landedWetness', 'landedWetness(x(0), x(1), x(2), x(3))', 4, landedWetness),
    twinGrid('wetPaper wetness', 'wetPaperAt(vec4f(x(0), x(1), 0.0, 0.0), x(2), vec3f(x(3), x(4), x(5))).wetness', 6, wetPaper('wetness')),
    twinGrid('wetPaper workable', 'wetPaperAt(vec4f(x(0), x(1), 0.0, 0.0), x(2), vec3f(x(3), x(4), x(5))).workable', 6, wetPaper('workable')),
    twinGrid('pressedTip share', 'pressedTip(1.0, x(0), x(1), x(2), x(3), x(4), x(5))', 6, tipPressedShare),
    twinGrid('paintFieldShare', 'paintFieldShare(vec2f(x(0), x(1)), i32(x(2)), vec4f(x(3), x(4), x(5), x(6)))', 7, paintFieldShare),
    twinGrid('kubelkaMunkOver', 'kubelkaMunkOver(kubelkaMunkFilm(vec4f(x(0)), vec4f(x(1))), vec4f(x(2))).x', 3, film),
    twinGrid('kubelkaMunkFilm T', 'kubelkaMunkFilm(vec4f(x(0)), vec4f(x(1))).T.x', 2, filmT),
    twinGrid('polygonDistance', 'polygonDistance(vec2f(x(0), x(1)), u32(x(2)), u32(x(3)))', 4, polygonDistance, { points: new Float32Array(points) }),
    twinGrid('ringsDistance', 'ringsDistance(vec2f(x(0), x(1)), u32(x(2)), u32(x(3)))', 4, ringsDistance, { points: new Float32Array(points) }),
    twinGrid('areaCoverage rings', AREA_COVERAGE_CALL.replace('u32(x(3))', `u32(x(3)) | ${STAMP_RINGED_COUNT}u`), 11, ringedCoverage, { points: new Float32Array(points), boundaries: new Float32Array(boundaryFloats) }),
    twinGrid('areaCoverage', AREA_COVERAGE_CALL, 11, areaCoverage, { points: new Float32Array(points), boundaries: new Float32Array(boundaryFloats) }),
    twinGrid('areaCoverage boundaries', AREA_COVERAGE_CALL, 11, boundaryCoverage, { points: new Float32Array(points), boundaries: new Float32Array(boundaryFloats) }),
    twinGrid('gridAt', `gridAt(vec2f(x(0), x(1)), vec3f(${distance.x0}, ${distance.y0}, ${distance.cell}), vec2u(${distance.columns}u, ${distance.rows}u), 0u)`, 2, gridAt, { grid: distance.values }),
    twinGrid('dualNeedsDual', 'select(0.0, 1.0, dualCombine(x(2), 0.0, i32(x(0)), x(1) > 0.5) == 0.0)', 3, needsDual),
  ];
}

/** Every formula grid the gate runs, its rendering formulas' first. */
export const stampGateFormulaGrids = (): StampGateFormulaGrid[] => [...renderingGrids(), ...twinGrids(), ...stampGateWetLawGrids()];

/** A formula's GPU output against what it's held to: how many rows, the largest difference and where, and how many pass `tolerance`. */
export function compareStampGateFormula(grid: StampGateFormulaGrid, expected: ArrayLike<number>, gpu: ArrayLike<number>, tolerance = STAMP_GATE_FORMULA_TOLERANCE) {
  let worst = 0, at = 0, over = 0;
  for (let i = 0; i < expected.length; i++) {
    const difference = Math.abs(gpu[i] - expected[i]);
    // NaN never passes: a formula that starts dividing by zero is a finding.
    if (!(difference <= tolerance)) over++;
    if (!(difference <= worst)) {
      worst = difference;
      at = i;
    }
  }
  return { rows: expected.length, worst, worstAt: grid.labels[at], gpu: gpu[at], expected: expected[at], over };
}
