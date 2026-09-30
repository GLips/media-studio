// coverage-formulas.ts: how a grain cuts coverage, how a dual combines with its brush, a grain's brightness and
// contrast, and wet edges' pooling, each defined once, as the number the CPU works out and the WGSL the GPU renderer
// runs (stamp-paint-renderer.ts includes COVERAGE_FORMULAS_WGSL). A mode's WGSL case and its index are generated from
// the tables here, so a mode added to a family is added to both, and a mode the GPU is handed always has its case. Each
// table holds exactly its family's modes (StampGrainBlend, StampDualBlend): a mode no importer reads has no formula.
//
// The `texture` formulas are Photoshop's, identified from its captures (vid-97): each fits its probes to the capture's
// noise, the constants included. The `layer` formulas are the ones vid-89 fitted Procreate's previews with.

import type { StampBrushWetEdges, StampDualBlend, StampGrainBlend, StampGrainLook } from './stamp-brush.ts';

/** Each family's modes, from its blend's union. */
type ModeOf<B extends { family: string; mode: string }, F extends B['family']> = Extract<B, { family: F }>['mode'];
type StampPooling = Extract<StampBrushWetEdges, { kind: 'pooling' }>;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const overlay = (base: number, blend: number) => (base < 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend));
const smoothstep = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

/**
 * Colour dodge and burn scale their pattern by depth × 248/255, floored to a 255th: Photoshop's, fitted at depths 100
 * and 50 on the texture probes and full depth on the dual's.
 */
export const stampDodgeScale = (depth: number) => Math.floor((Math.round(depth * 255) * 248) / 255) / 255;

/** A formula as the CPU works it out and as a WGSL expression over the same argument names. */
type Formula<Args extends number[]> = { cpu: (...args: Args) => number; wgsl: string };

/**
 * A grain's texture formulas: coverage a cut by grain paint v at depth d, depth inside the formula. `height` and
 * `linearHeight` read the grain as a relief the paint fills 12·depth·a deep: Krita's Photoshop height forms, weight 12
 * not its 10.
 */
const GRAIN_TEXTURE = {
  multiply: { cpu: (a, v, d) => clamp01(a * (1 - d * (1 - v))), wgsl: 'clamp(a * (1.0 - d * (1.0 - v)), 0.0, 1.0)' },
  subtract: { cpu: (a, v, d) => a + d * (clamp01(a - v) - a), wgsl: 'a + d * (clamp(a - v, 0.0, 1.0) - a)' },
  linearBurn: { cpu: (a, v, d) => clamp01(a - d * (1 - v)), wgsl: 'clamp(a - d * (1.0 - v), 0.0, 1.0)' },
  colorDodge: { cpu: (a, v, d) => clamp01(a / (1 - stampDodgeScale(d) * v)), wgsl: 'clamp(a / (1.0 - dodgeScale(d) * v), 0.0, 1.0)' },
  colorBurn: { cpu: (a, v, d) => clamp01(1 - (1 - a) / (1 - stampDodgeScale(d) * (1 - v))), wgsl: 'clamp(1.0 - (1.0 - a) / (1.0 - dodgeScale(d) * (1.0 - v)), 0.0, 1.0)' },
  darken: { cpu: (a, v, d) => Math.min(a, 1 - d * (1 - v)), wgsl: 'min(a, 1.0 - d * (1.0 - v))' },
  overlay: { cpu: (a, v, d) => clamp01(overlay(a, 0.5 + d * (v - 0.5))), wgsl: 'clamp(overlaid(a, 0.5 + d * (v - 0.5)), 0.0, 1.0)' },
  hardMix: { cpu: (a, v, d) => clamp01(4 * a + 3 * d * v - 3), wgsl: 'clamp(4.0 * a + 3.0 * d * v - 3.0, 0.0, 1.0)' },
  height: { cpu: (a, v, d) => clamp01(12 * d * a - v), wgsl: 'clamp(12.0 * d * a - v, 0.0, 1.0)' },
  linearHeight: { cpu: (a, v, d) => { const m = 12 * d * a; return clamp01(Math.max(m * (1 - v), m - v)); }, wgsl: 'clamp(max(12.0 * d * a * (1.0 - v), 12.0 * d * a - v), 0.0, 1.0)' },
} satisfies Record<ModeOf<StampGrainBlend, 'texture'>, Formula<[a: number, v: number, d: number]>>;

/**
 * A grain's layer formulas: grain paint g over coverage a as a layer blend, before depth mixes it back toward a.
 * `height` and `linearHeight` are a relief filled from its deepest point up to a: a crisp waterline, or a soft one.
 */
const GRAIN_LAYER = {
  multiply: { cpu: (a, g) => a * g, wgsl: 'a * g' },
  subtract: { cpu: (a, g) => a - g, wgsl: 'a - g' },
  linearBurn: { cpu: (a, g) => a + g - 1, wgsl: 'a + g - 1.0' },
  colorDodge: { cpu: (a, g) => (g < 1 ? a / (1 - g) : 1), wgsl: 'select(1.0, a / (1.0 - g), g < 1.0)' },
  colorBurn: { cpu: (a, g) => (g > 0 ? 1 - (1 - a) / g : 0), wgsl: 'select(0.0, 1.0 - (1.0 - a) / g, g > 0.0)' },
  darken: { cpu: (a, g) => Math.min(a, g), wgsl: 'min(a, g)' },
  lighten: { cpu: (a, g) => Math.max(a, g), wgsl: 'max(a, g)' },
  divide: { cpu: (a, g) => (g > 0 ? a / g : 1), wgsl: 'select(1.0, a / g, g > 0.0)' },
  hardMix: { cpu: (a, g) => (a + g >= 1 ? 1 : 0), wgsl: 'step(1.0, a + g)' },
  height: { cpu: (a, g) => a * smoothstep(-0.04, 0.04, g - (1 - a)), wgsl: 'a * smoothstep(-0.04, 0.04, g - (1.0 - a))' },
  linearHeight: { cpu: (a, g) => a * clamp01((g - (1 - a)) * 2 + 0.5), wgsl: 'a * clamp((g - (1.0 - a)) * 2.0 + 0.5, 0.0, 1.0)' },
} satisfies Record<ModeOf<StampGrainBlend, 'layer'>, Formula<[a: number, g: number]>>;

/**
 * A dual's texture formulas: its coverage s as the pattern over the brush's grained coverage p, at full depth, each
 * painting nothing where p has none; `linearHeight` an overlay of p by 1 − s.
 */
const DUAL_TEXTURE = {
  multiply: { cpu: (p, s) => p * s, wgsl: 'p * s' },
  overlay: { cpu: (p, s) => clamp01(overlay(p, s)), wgsl: 'clamp(overlaid(p, s), 0.0, 1.0)' },
  darken: { cpu: (p, s) => Math.min(p, s), wgsl: 'min(p, s)' },
  colorBurn: { cpu: (p, s) => clamp01(1 - (1 - p) / (1 - stampDodgeScale(1) * (1 - s))), wgsl: 'clamp(1.0 - (1.0 - p) / (1.0 - dodgeScale(1.0) * (1.0 - s)), 0.0, 1.0)' },
  linearHeight: { cpu: (p, s) => clamp01(overlay(p, 1 - s)), wgsl: 'clamp(overlaid(p, 1.0 - s), 0.0, 1.0)' },
  linearBurn: { cpu: (p, s) => clamp01(p + s - 1), wgsl: 'clamp(p + s - 1.0, 0.0, 1.0)' },
  colorDodge: { cpu: (p, s) => clamp01(p / (1 - stampDodgeScale(1) * s)), wgsl: 'clamp(p / (1.0 - dodgeScale(1.0) * s), 0.0, 1.0)' },
  hardMix: { cpu: (p, s) => clamp01(4 * p + 3 * s - 3), wgsl: 'clamp(4.0 * p + 3.0 * s - 3.0, 0.0, 1.0)' },
} satisfies Record<ModeOf<StampDualBlend, 'texture'>, Formula<[p: number, s: number]>>;

/**
 * A dual's layer formulas: its coverage s over the brush's p as a layer blend, before it's held to where p has paint.
 * `linearHeight` is the dual as a relief the brush's paint fills, as a linear-height grain reads it.
 */
const DUAL_LAYER = {
  normal: { cpu: (_p, s) => s, wgsl: 's' },
  multiply: { cpu: (p, s) => p * s, wgsl: 'p * s' },
  screen: { cpu: (p, s) => p + s - p * s, wgsl: 'p + s - p * s' },
  overlay: { cpu: (p, s) => overlay(p, s), wgsl: 'overlaid(p, s)' },
  darken: { cpu: (p, s) => Math.min(p, s), wgsl: 'min(p, s)' },
  lighten: { cpu: (p, s) => Math.max(p, s), wgsl: 'max(p, s)' },
  colorBurn: { cpu: (p, s) => (s > 0 ? 1 - Math.min(1, (1 - p) / s) : 0), wgsl: 'select(1.0 - min(1.0, (1.0 - p) / s), 0.0, s <= 0.0)' },
  difference: { cpu: (p, s) => Math.abs(p - s), wgsl: 'abs(p - s)' },
  linearHeight: { cpu: (p, s) => p * clamp01((s - (1 - p)) * 2 + 0.5), wgsl: 'p * clamp((s - (1.0 - p)) * 2.0 + 0.5, 0.0, 1.0)' },
} satisfies Record<ModeOf<StampDualBlend, 'layer'>, Formula<[p: number, s: number]>>;

/** Each mode's number in its family's generated WGSL switch: its place in the table. */
const indexOf = <K extends string>(table: Record<K, unknown>) => Object.fromEntries(Object.keys(table).map((mode, i) => [mode, i])) as Record<K, number>;
const GRAIN_MODE_INDEX = { texture: indexOf(GRAIN_TEXTURE), layer: indexOf(GRAIN_LAYER) };
const DUAL_MODE_INDEX = { texture: indexOf(DUAL_TEXTURE), layer: indexOf(DUAL_LAYER) };

/** A grain blend's case in its family's WGSL switch. */
export const stampGrainModeIndex = (blend: StampGrainBlend) =>
  (blend.family === 'texture' ? GRAIN_MODE_INDEX.texture[blend.mode] : GRAIN_MODE_INDEX.layer[blend.mode]);
/** A dual blend's case in its family's WGSL switch. */
export const stampDualModeIndex = (blend: StampDualBlend) =>
  (blend.family === 'texture' ? DUAL_MODE_INDEX.texture[blend.mode] : DUAL_MODE_INDEX.layer[blend.mode]);

/** Coverage `a` cut by grain paint `v` (1 keeps paint) at the grain's depth, by its blend. */
export function stampGrainCut(a: number, v: number, { depth, blend }: Pick<StampGrainLook<unknown>, 'depth' | 'blend'>): number {
  return blend.family === 'texture' ? GRAIN_TEXTURE[blend.mode].cpu(a, v, depth) : a + depth * (clamp01(GRAIN_LAYER[blend.mode].cpu(a, v)) - a);
}

/**
 * The dual's coverage `s` combined with the brush's grained coverage `p` by `blend`. The layer blends would paint where
 * the brush has none, so they're held to where it has paint (fully from p = 1/8).
 */
export function stampDualCombine(p: number, s: number, blend: StampDualBlend): number {
  return blend.family === 'texture' ? DUAL_TEXTURE[blend.mode].cpu(p, s) : clamp01(DUAL_LAYER[blend.mode].cpu(p, s)) * clamp01(p * 8);
}

/** Whether a dual combines before its brush's grain cuts it: a `layer` linear height shapes where the stamps' paint lies. */
export const stampDualBeforeGrain = (blend: StampDualBlend) => blend.family === 'layer' && blend.mode === 'linearHeight';

/** How far `contrast` (-1..1) steepens a grain: flattened by 1 + contrast below 0, steepened by 1 / (1 − contrast) above. */
export const stampGrainSlope = (contrast: number) => (contrast < 0 ? 1 + contrast : 1 / (1 - contrast));

/**
 * A grain's paint as its brush adjusts it: `raw` 0..1 as the image holds it (1 paints), `mean` its mean paint. About
 * mid-grey, Photoshop's pattern brightness and contrast; a contrast of 1 (Photoshop's 100) is steep but finite. About
 * the mean, stretched and then brightened.
 */
export function stampGrainPaint(raw: number, { brightness: b, contrast: c, contrastPivot }: Pick<StampGrainLook<unknown>, 'brightness' | 'contrast' | 'contrastPivot'>, mean: number): number {
  if (contrastPivot === 'mean') return clamp01(mean + (raw - mean) * stampGrainSlope(Math.min(c, 0.999)) + b);
  if (c === 0) return clamp01(raw + b);
  if (c < 0) return clamp01((raw - 128 / 255) * (1 + c) + 0.5 + b);
  const [pivot, slope] = c >= 1 ? [126.589 / 255, 231.63] : [127.5 / 255, 1 / (1 - c)];
  return clamp01((raw + b - pivot) * slope + 128 / 255);
}

/** Wet edges' pooling of built coverage `c`: rising to `peak` at half coverage, easing to `body` at full. */
export function stampPooled(c: number, { peak, body }: Pick<StampPooling, 'peak' | 'body'>): number {
  return c <= 0.5 ? 2 * peak * c : peak - 4 * (peak - body) * (c - 0.5) ** 2;
}

/** Photoshop's wet edges (fitted at rms 0.00009): half coverage pools to 192/255, full coverage to 150/255. */
export const PHOTOSHOP_POOLING: StampPooling = { kind: 'pooling', peak: 192 / 255, body: 150 / 255 };

/** A family's formulas as a WGSL function switching on its mode's index; the last case is also the default. */
function wgslSwitch(name: string, params: string, table: Record<string, { wgsl: string }>): string {
  const cases = Object.values(table).map(({ wgsl }, i, all) => `    case ${i}${i === all.length - 1 ? ', default' : ''}: { return ${wgsl}; }`);
  return `fn ${name}(${params}, mode: i32) -> f32 {\n  switch (mode) {\n${cases.join('\n')}\n  }\n}`;
}

/**
 * The formulas above in WGSL: `grainCut` (a grain's, texture or layer by `layer`), `dualCombine` (a dual's), `grainPaint`
 * and `pooled`, each its namesake's twin.
 */
export const COVERAGE_FORMULAS_WGSL = /* wgsl */ `
fn dodgeScale(depth: f32) -> f32 { return floor(round(depth * 255.0) * 248.0 / 255.0) / 255.0; }
fn overlaid(base: f32, blend: f32) -> f32 { return select(1.0 - 2.0 * (1.0 - base) * (1.0 - blend), 2.0 * base * blend, base < 0.5); }
fn grainSlope(contrast: f32) -> f32 { return select(1.0 / (1.0 - contrast), 1.0 + contrast, contrast < 0.0); }
fn grainPaint(raw: f32, brightness: f32, contrast: f32, aboutMean: bool, mean: f32) -> f32 {
  if (aboutMean) { return clamp(mean + (raw - mean) * grainSlope(min(contrast, 0.999)) + brightness, 0.0, 1.0); }
  if (contrast == 0.0) { return clamp(raw + brightness, 0.0, 1.0); }
  if (contrast < 0.0) { return clamp((raw - 128.0 / 255.0) * (1.0 + contrast) + 0.5 + brightness, 0.0, 1.0); }
  let pivot = select(127.5 / 255.0, 126.589 / 255.0, contrast >= 1.0);
  let slope = select(1.0 / (1.0 - contrast), 231.63, contrast >= 1.0);
  return clamp((raw + brightness - pivot) * slope + 128.0 / 255.0, 0.0, 1.0);
}
${wgslSwitch('grainTexture', 'a: f32, v: f32, d: f32', GRAIN_TEXTURE)}
${wgslSwitch('grainLayer', 'a: f32, g: f32', GRAIN_LAYER)}
fn grainCut(a: f32, v: f32, d: f32, mode: i32, layer: bool) -> f32 {
  if (layer) { return a + d * (clamp(grainLayer(a, v, mode), 0.0, 1.0) - a); }
  return grainTexture(a, v, d, mode);
}
${wgslSwitch('dualTexture', 'p: f32, s: f32', DUAL_TEXTURE)}
${wgslSwitch('dualLayer', 'p: f32, s: f32', DUAL_LAYER)}
fn dualCombine(p: f32, s: f32, mode: i32, layer: bool) -> f32 {
  if (layer) { return clamp(dualLayer(p, s, mode), 0.0, 1.0) * clamp(p * 8.0, 0.0, 1.0); }
  return dualTexture(p, s, mode);
}
fn pooled(c: f32, peak: f32, body: f32) -> f32 {
  return select(peak - 4.0 * (peak - body) * (c - 0.5) * (c - 0.5), 2.0 * peak * c, c <= 0.5);
}`;
