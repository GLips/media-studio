// stamp-formula-parity.ts: the transfer grids the formulas command runs every paired CPU/WGSL formula over
// (coverage-formulas.ts, stamp-deposit-stages.ts), and how a GPU run of them is held to the CPU. Each grid is a WGSL
// call over one row of inputs and the CPU's answer for the same row; the GPU side is stamp-formula-parity-page.ts.
//
// Grid steps are 32nds, which f32 and f64 hold exactly, so a threshold like hardMix's a + g ≥ 1 falls the same way
// on both, and a difference is the formula's, not the grid's rounding.

import { PHOTOSHOP_POOLING, STAMP_DUAL_BLENDS, STAMP_GRAIN_BLENDS, stampDualCombine, stampDualModeIndex, stampGrainCut, stampGrainModeIndex, stampGrainPaint, stampPooled } from '#lib/picture/stamp-paint/models/coverage-formulas.ts';
import { STAMP_ACCUMULATION_KINDS, STAMP_ACCUMULATIONS, stampAccumulationIndex } from '#lib/picture/stamp-paint/models/stamp-deposit-stages.ts';

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

/** Every paired formula over its grid: each mode of each family, the adjustments' cases, pooling, each accumulation's resolve. */
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
  return [
    grid('grainCut', 'grainCut(x(0), x(1), x(2), i32(x(3)), x(4) > 0.5)', 5, grainCut),
    grid('dualCombine', 'dualCombine(x(0), x(1), i32(x(2)), x(3) > 0.5)', 4, dualCombine),
    grid('grainPaint', 'grainPaint(x(0), x(1), x(2), x(3) > 0.5, x(4))', 5, grainPaint),
    grid('pooled', 'pooled(x(0), x(1), x(2))', 3, pooled),
    grid('accumulationResolve', 'accumulationResolve(x(0), x(1), x(2), x(3), i32(x(4)))', 5, resolve),
  ];
}

/** A formula's result on the GPU against the CPU: how many rows, the largest difference and where, and how many pass `tolerance`. */
export function compareStampFormulaGrid(grid: StampFormulaGrid, gpu: ArrayLike<number>, tolerance = STAMP_FORMULA_TOLERANCE) {
  let worst = 0, at = 0, over = 0;
  for (let i = 0; i < grid.expected.length; i++) {
    const difference = Math.abs(gpu[i] - grid.expected[i]);
    // NaN never passes: a WGSL twin that divides by zero where the CPU doesn't is a finding.
    if (!(difference <= tolerance)) over++;
    if (!(difference <= worst)) worst = difference, at = i;
  }
  return { formula: grid.formula, rows: grid.expected.length, worst, worstAt: grid.labels[at], gpu: gpu[at], cpu: grid.expected[at], over };
}
