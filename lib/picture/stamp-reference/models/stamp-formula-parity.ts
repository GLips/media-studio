// stamp-formula-parity.ts: the transfer grids the formulas command runs every paired CPU/WGSL formula over
// (coverage-formulas.ts, stamp-deposit-stages.ts, stamp-region.ts, stamp-paint-field.ts, stamp-fill.ts), and how a GPU run of them is held to the CPU. Each grid is a WGSL
// call over one row of inputs and the CPU's answer for the same row; the GPU side is stamp-formula-parity-page.ts.
//
// Grid steps are 32nds, which f32 and f64 hold exactly, so a threshold like hardMix's a + g ≥ 1 falls the same way
// on both, and a difference is the formula's, not the grid's rounding.

import { PHOTOSHOP_POOLING, STAMP_DUAL_BLENDS, STAMP_GRAIN_BLENDS, stampDualCombine, stampDualModeIndex, stampGrainCut, stampGrainModeIndex, stampGrainPaint, stampPooled, stampPressedTip, stampTipNoise, stampTipNoiseAt } from '#lib/picture/stamp-paint/models/coverage-formulas.ts';
import { STAMP_ACCUMULATION_KINDS, STAMP_ACCUMULATIONS, stampAccumulationIndex } from '#lib/picture/stamp-paint/models/stamp-deposit-stages.ts';
import { STAMP_FILL_FRONT_SHARE } from '#lib/picture/stamp-paint/models/stamp-fill.ts';
import { STAMP_PAINT_FIELD_SHARE } from '#lib/picture/stamp-paint/models/stamp-paint-field.ts';
import { stampEdgeCoverage, stampEdgeNoise, stampFillBody } from '#lib/picture/stamp-paint/models/stamp-region.ts';

/**
 * A formula's grid: `call` a WGSL expression over `x(0)`, `x(1)`, … (a row's inputs), `rows` its inputs, `labels`
 * what each row is, and `expected` the CPU's answer for each.
 */
export type StampFormulaGrid = { formula: string; call: string; width: number; rows: Float32Array; labels: string[]; expected: Float64Array };

/** How far the GPU may sit from the CPU: f32 arithmetic, well inside what a half-float target keeps (about 1e-3). */
export const STAMP_FORMULA_TOLERANCE = 1e-4;

const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);
const UNIT = steps(32), COARSE = steps(4);

function grid(formula: string, call: string, width: number, entries: readonly { label: string; inputs: readonly number[]; expected: number }[]): StampFormulaGrid {
  const rows = new Float32Array(entries.length * width);
  entries.forEach(({ inputs }, i) => rows.set(inputs, i * width));
  return { formula, call, width, rows, labels: entries.map((e) => e.label), expected: Float64Array.from(entries, (e) => e.expected) };
}

const blendName = (b: { family: string; mode: string }) => `${b.family} ${b.mode}`;

/** Every paired formula over its grid: tip noise and its hash, each accumulation's lay, each mode of each family, the adjustments' cases, pooling, each resolve. */
export function stampFormulaGrids(): StampFormulaGrid[] {
  const grainCut = STAMP_GRAIN_BLENDS.flatMap((blend) => UNIT.flatMap((a) => UNIT.flatMap((v) => COARSE.map((d) => ({
    label: `${blendName(blend)} a ${a} v ${v} d ${d}`,
    inputs: [a, v, d, stampGrainModeIndex(blend), blend.family === 'layer' ? 1 : 0],
    expected: stampGrainCut(a, v, { depth: d, blend }),
  })))));
  const dualCombine = STAMP_DUAL_BLENDS.flatMap((blend) => UNIT.flatMap((p) => UNIT.map((s) => ({
    label: `${blendName(blend)} p ${p} s ${s}`,
    inputs: [p, s, stampDualModeIndex(blend), blend.family === 'layer' ? 1 : 0],
    expected: stampDualCombine(p, s, blend),
  }))));
  const grainPaint = (['midGrey', 'mean'] as const).flatMap((contrastPivot) => [0.25, 0.625].flatMap((mean) => [-1, -0.5, -0.125, 0, 0.125, 0.5, 1].flatMap((brightness) =>
    [-1, -0.5, -0.125, 0, 0.125, 0.5, 0.875, 0.999, 1].flatMap((contrast) => UNIT.map((raw) => ({
      label: `${contrastPivot} mean ${mean} brightness ${brightness} contrast ${contrast} raw ${raw}`,
      inputs: [raw, brightness, contrast, contrastPivot === 'mean' ? 1 : 0, mean],
      expected: stampGrainPaint(Math.fround(raw), { brightness: Math.fround(brightness), contrast: Math.fround(contrast), contrastPivot }, Math.fround(mean)),
    }))))));
  const pooled = [PHOTOSHOP_POOLING, { peak: 1, body: 0.5 }, { peak: 0.5, body: 0.875 }].flatMap((pooling) => steps(128).map((c) => ({
    label: `peak ${pooling.peak.toFixed(3)} body ${pooling.body.toFixed(3)} c ${c}`,
    inputs: [c, pooling.peak, pooling.body],
    expected: stampPooled(c, { peak: Math.fround(pooling.peak), body: Math.fround(pooling.body) }),
  })));
  const resolve = STAMP_ACCUMULATION_KINDS.flatMap((kind) => COARSE.flatMap((built) => COARSE.flatMap((densest) => COARSE.flatMap((cap) => [0, 0.5, 1].map((build) => ({
    label: `${kind} built ${built} densest ${densest} cap ${cap} build ${build}`,
    inputs: [built, densest, cap, build, stampAccumulationIndex(kind)],
    expected: STAMP_ACCUMULATIONS[kind].resolve.cpu({ built, densest, cap }, build),
  }))))));
  const lay = STAMP_ACCUMULATION_KINDS.flatMap((kind) => UNIT.flatMap((built) => COARSE.flatMap((laid) => UNIT.map((opacity) => ({
    label: `${kind} built ${built} laid ${laid} opacity ${opacity}`,
    inputs: [built, laid, opacity, stampAccumulationIndex(kind)],
    expected: STAMP_ACCUMULATIONS[kind].lay.cpu(built, laid, opacity),
  })))));
  const tipNoise = UNIT.flatMap((a) => UNIT.flatMap((n) => COARSE.map((depth) => ({ label: `a ${a} n ${n} depth ${depth}`, inputs: [a, n, depth], expected: stampTipNoise(a, n, depth) }))));
  // Pixels and seeds as small whole numbers, which the grid's f32 rows hold exactly.
  const tipNoiseAt = [0, 1, 7, 255, 4095].flatMap((x) => [0, 3, 1000, 65535].flatMap((y) => [0, 1, 12345, 1 << 23].map((seed) => ({
    label: `x ${x} y ${y} seed ${seed}`, inputs: [x, y, seed], expected: stampTipNoiseAt(x, y, seed),
  }))));
  const pressedTip = [0.3, 1].flatMap((a) => UNIT.flatMap((c) => UNIT.flatMap((pressure) => [0.16, 0.5].flatMap((softness) => [1, 2.5].map((grow) => ({
    label: `a ${a} c ${c} p ${pressure} softness ${softness} grow ${grow}`, inputs: [a, c, pressure, softness, -0.2, 1.4, grow], expected: stampPressedTip(a, c, pressure, softness, -0.2, 1.4, grow),
  }))))));
  // Regions, in painting pixels: distances and widths in eighths, points and geometry whole or in quarters.
  const edgeCoverage = steps(64).map((u) => u * 12 - 6).flatMap((sd) => [1, 4, 12.5].map((width) => ({ label: `sd ${sd} width ${width}`, inputs: [sd, width], expected: stampEdgeCoverage(sd, width) })));
  const edgeNoise = [-3.5, 0, 0.25, 1.5, 7.75, 100.125].flatMap((x) => [-40.5, 0, 0.75, 3.25, 250.5].flatMap((y) => [0, 12345, 4000000].map((seed) => ({
    label: `x ${x} y ${y} seed ${seed}`, inputs: [x, y, seed], expected: stampEdgeNoise(x, y, seed),
  }))));
  const fillBody = steps(64).map((u) => u * 64 - 8).flatMap((sd) => [2, 10, 20, 37.5, 60].map((thickness) => ({
    label: `sd ${sd} thickness ${thickness} c 25`, inputs: [sd, thickness, 25], expected: stampFillBody(sd, thickness, 25),
  })));
  const fieldGeometry: [number, readonly [number, number, number, number]][] = [[0, [0, 0, 0, 0]], [1, [100, 50, 300, 250]], [1, [0, 0, 0, 400]], [2, [200, 150, 120, 0]]];
  const paintFieldShare = fieldGeometry.flatMap(([kind, geometry]) => [0, 50, 125.5, 200, 400].flatMap((x) => [0, 100, 150.25, 500].map((y) => ({
    label: `kind ${kind} [${geometry.join(',')}] at ${x},${y}`, inputs: [x, y, kind, ...geometry], expected: STAMP_PAINT_FIELD_SHARE.cpu(x, y, kind, geometry),
  }))));
  const fillFrontShare = ([[0, 1], [1, 0], [-0.6, 0.8]] as const).flatMap((normal) => [0, 0.25, 0.5, 1].flatMap((progress) => [0, 120.5, 300].flatMap((x) => [0, 80, 260.25].map((y) => ({
    label: `normal ${normal.join(',')} progress ${progress} at ${x},${y}`, inputs: [x, y, normal[0], normal[1], -20, 280, 50, progress],
    expected: STAMP_FILL_FRONT_SHARE.cpu({ normal, from: -20, to: 280, soft: 50 }, progress, x, y),
  })))));
  return [
    grid('edgeCoverage', 'edgeCoverage(x(0), x(1))', 2, edgeCoverage),
    grid('edgeNoise', 'edgeNoise(x(0), x(1), u32(x(2)))', 3, edgeNoise),
    grid('fillBody', 'fillBody(x(0), x(1), x(2))', 3, fillBody),
    grid('paintFieldShare', 'paintFieldShare(vec2f(x(0), x(1)), i32(x(2)), vec4f(x(3), x(4), x(5), x(6)))', 7, paintFieldShare),
    grid('fillFrontShare', 'fillFrontShare(vec2f(x(0), x(1)), vec2f(x(2), x(3)), x(4), x(5), x(6), x(7))', 8, fillFrontShare),
    grid('pressedTip', 'pressedTip(x(0), x(1), x(2), x(3), x(4), x(5), x(6))', 7, pressedTip),
    grid('tipNoise', 'tipNoise(x(0), x(1), x(2))', 3, tipNoise),
    grid('tipNoiseAt', 'tipNoiseAt(u32(x(0)), u32(x(1)), u32(x(2)))', 3, tipNoiseAt),
    grid('accumulationLay', 'accumulationLay(x(0), x(1), x(2), i32(x(3)))', 4, lay),
    grid('grainCut', 'grainCut(x(0), x(1), x(2), i32(x(3)), x(4) > 0.5)', 5, grainCut),
    grid('dualCombine', 'dualCombine(x(0), x(1), i32(x(2)), x(3) > 0.5)', 4, dualCombine),
    grid('grainPaint', 'grainPaint(x(0), x(1), x(2), x(3) > 0.5, x(4))', 5, grainPaint),
    grid('pooled', 'pooled(x(0), x(1), x(2))', 3, pooled),
    grid('accumulationResolve', 'accumulationResolve(x(0), x(1), x(2), x(3), i32(x(4)))', 5, resolve),
  ];
}

/** A formula's result on the GPU against the CPU: how many rows, the largest difference and where, and how many pass `tolerance`. */
export function compareStampFormulaGrid(formulaGrid: StampFormulaGrid, gpu: ArrayLike<number>, tolerance = STAMP_FORMULA_TOLERANCE) {
  let worst = 0, at = 0, over = 0;
  for (let i = 0; i < formulaGrid.expected.length; i++) {
    const difference = Math.abs(gpu[i] - formulaGrid.expected[i]);
    // NaN never passes: a WGSL twin that divides by zero where the CPU doesn't is a finding.
    if (!(difference <= tolerance)) over++;
    if (!(difference <= worst)) {
      worst = difference;
      at = i;
    }
  }
  return { formula: formulaGrid.formula, rows: formulaGrid.expected.length, worst, worstAt: formulaGrid.labels[at], gpu: gpu[at], cpu: formulaGrid.expected[at], over };
}
