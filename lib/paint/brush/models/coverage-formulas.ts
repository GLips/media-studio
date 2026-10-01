// coverage-formulas.ts: one registry of how a grain cuts coverage, how a dual combines with its brush, a grain's
// brightness and contrast, and wet edges' pooling, in WGSL (COVERAGE_FORMULAS_WGSL): only the GPU renders, so no CPU
// side is kept, and the GPU gate (lib/paint/gate) holds each to its accepted output over an input grid.
// WGSL cases are generated from each family's table, which holds exactly its modes: one no importer reads has no
// formula.
//
// The `texture` formulas are Photoshop's, identified from its captures: each, constants included, fits its probes
// to the capture's noise. The `layer` formulas were fitted to Procreate's previews.

import type { StampBrushWetEdges, StampDualBlend, StampGrainBlend } from './stamp-brush.ts';

/** Each family's modes, from its blend's union. */
type ModeOf<B extends { family: string; mode: string }, F extends B['family']> = Extract<B, { family: F }>['mode'];
type StampPooling = Extract<StampBrushWetEdges, { kind: 'pooling' }>;

/** A formula: a WGSL expression over its family's argument names. */
type Formula = string;

/**
 * A grain's texture formulas: coverage a cut by grain paint v at depth d, depth inside the formula. `height` and
 * `linearHeight` read the grain as a relief the paint fills 12·depth·a deep: Krita's Photoshop height forms, weight 12
 * not its 10.
 */
const GRAIN_TEXTURE = {
  multiply: 'clamp(a * (1.0 - d * (1.0 - v)), 0.0, 1.0)',
  subtract: 'a + d * (clamp(a - v, 0.0, 1.0) - a)',
  linearBurn: 'clamp(a - d * (1.0 - v), 0.0, 1.0)',
  colorDodge: 'clamp(a / (1.0 - dodgeScale(d) * v), 0.0, 1.0)',
  colorBurn: 'clamp(1.0 - (1.0 - a) / (1.0 - dodgeScale(d) * (1.0 - v)), 0.0, 1.0)',
  darken: 'min(a, 1.0 - d * (1.0 - v))',
  overlay: 'clamp(overlaid(a, 0.5 + d * (v - 0.5)), 0.0, 1.0)',
  hardMix: 'clamp(4.0 * a + 3.0 * d * v - 3.0, 0.0, 1.0)',
  height: 'clamp(12.0 * d * a - v, 0.0, 1.0)',
  linearHeight: 'clamp(max(12.0 * d * a * (1.0 - v), 12.0 * d * a - v), 0.0, 1.0)',
} satisfies Record<ModeOf<StampGrainBlend, 'texture'>, Formula>;

/**
 * A grain's layer formulas: grain paint g over coverage a as a layer blend, before depth mixes it back toward a.
 * `height` and `linearHeight` are a relief filled from its deepest point up to a: a crisp waterline, or a soft one.
 */
const GRAIN_LAYER = {
  multiply: 'a * g',
  subtract: 'a - g',
  linearBurn: 'a + g - 1.0',
  colorDodge: 'select(1.0, a / (1.0 - g), g < 1.0)',
  colorBurn: 'select(0.0, 1.0 - (1.0 - a) / g, g > 0.0)',
  darken: 'min(a, g)',
  lighten: 'max(a, g)',
  divide: 'select(1.0, a / g, g > 0.0)',
  hardMix: 'step(1.0, a + g)',
  height: 'a * smoothstep(-0.04, 0.04, g - (1.0 - a))',
  linearHeight: 'a * clamp((g - (1.0 - a)) * 2.0 + 0.5, 0.0, 1.0)',
} satisfies Record<ModeOf<StampGrainBlend, 'layer'>, Formula>;

/**
 * A dual's formula, and whether it `needsDual`: paints nothing where the dual has none (at p = 1, s = 0), so a brush's
 * paint lands only where both layers' do. The GPU gate holds the flag to the WGSL.
 */
type DualFormula = { wgsl: Formula; needsDual: boolean };

/**
 * A dual's texture formulas: its coverage s as the pattern over the brush's grained coverage p, at full depth, each
 * painting nothing where p has none; `linearHeight` an overlay of p by 1 − s.
 */
const DUAL_TEXTURE = {
  multiply: { wgsl: 'p * s', needsDual: true },
  overlay: { wgsl: 'clamp(overlaid(p, s), 0.0, 1.0)', needsDual: false },
  darken: { wgsl: 'min(p, s)', needsDual: true },
  colorBurn: { wgsl: 'clamp(1.0 - (1.0 - p) / (1.0 - dodgeScale(1.0) * (1.0 - s)), 0.0, 1.0)', needsDual: false },
  linearHeight: { wgsl: 'clamp(overlaid(p, 1.0 - s), 0.0, 1.0)', needsDual: false },
  linearBurn: { wgsl: 'clamp(p + s - 1.0, 0.0, 1.0)', needsDual: true },
  colorDodge: { wgsl: 'clamp(p / (1.0 - dodgeScale(1.0) * s), 0.0, 1.0)', needsDual: false },
  hardMix: { wgsl: 'clamp(4.0 * p + 3.0 * s - 3.0, 0.0, 1.0)', needsDual: false },
} satisfies Record<ModeOf<StampDualBlend, 'texture'>, DualFormula>;

/**
 * A dual's layer formulas: its coverage s over the brush's p as a layer blend, before it's held to where p has paint.
 * `linearHeight` is the dual as a relief the brush's paint fills, as a linear-height grain reads it.
 */
const DUAL_LAYER = {
  normal: { wgsl: 's', needsDual: true },
  multiply: { wgsl: 'p * s', needsDual: true },
  screen: { wgsl: 'p + s - p * s', needsDual: false },
  overlay: { wgsl: 'overlaid(p, s)', needsDual: false },
  darken: { wgsl: 'min(p, s)', needsDual: true },
  lighten: { wgsl: 'max(p, s)', needsDual: false },
  colorBurn: { wgsl: 'select(1.0 - min(1.0, (1.0 - p) / s), 0.0, s <= 0.0)', needsDual: true },
  difference: { wgsl: 'abs(p - s)', needsDual: false },
  linearHeight: { wgsl: 'p * clamp((s - (1.0 - p)) * 2.0 + 0.5, 0.0, 1.0)', needsDual: false },
} satisfies Record<ModeOf<StampDualBlend, 'layer'>, DualFormula>;

/** Each mode's number in its family's generated WGSL switch: its place in the table. */
// SAFETY: built from the table's own keys, so it has an entry for each K.
const indexOf = <K extends string>(table: Record<K, unknown>) => Object.fromEntries(Object.keys(table).map((mode, i) => [mode, i])) as Record<K, number>;
const GRAIN_MODE_INDEX = { texture: indexOf(GRAIN_TEXTURE), layer: indexOf(GRAIN_LAYER) };
const DUAL_MODE_INDEX = { texture: indexOf(DUAL_TEXTURE), layer: indexOf(DUAL_LAYER) };

/** A grain blend's case in its family's WGSL switch. */
export const stampGrainModeIndex = (blend: StampGrainBlend) =>
  (blend.family === 'texture' ? GRAIN_MODE_INDEX.texture[blend.mode] : GRAIN_MODE_INDEX.layer[blend.mode]);
/** A dual blend's case in its family's WGSL switch. */
export const stampDualModeIndex = (blend: StampDualBlend) =>
  (blend.family === 'texture' ? DUAL_MODE_INDEX.texture[blend.mode] : DUAL_MODE_INDEX.layer[blend.mode]);

// SAFETY: a table's keys are exactly its K, its family's modes (each table `satisfies` its family's record).
const modesOf = <K extends string>(table: Record<K, unknown>) => Object.keys(table) as K[];
/** Every grain blend and every dual blend there is a formula for, in table order. */
export const STAMP_GRAIN_BLENDS: readonly StampGrainBlend[] = [
  ...modesOf(GRAIN_TEXTURE).map((mode) => ({ family: 'texture' as const, mode })),
  ...modesOf(GRAIN_LAYER).map((mode) => ({ family: 'layer' as const, mode })),
];
export const STAMP_DUAL_BLENDS: readonly StampDualBlend[] = [
  ...modesOf(DUAL_TEXTURE).map((mode) => ({ family: 'texture' as const, mode })),
  ...modesOf(DUAL_LAYER).map((mode) => ({ family: 'layer' as const, mode })),
];

/** Whether `blend` paints nothing where the dual has none (DualFormula's needsDual). */
export const stampDualNeedsDual = (blend: StampDualBlend) => (blend.family === 'texture' ? DUAL_TEXTURE[blend.mode].needsDual : DUAL_LAYER[blend.mode].needsDual);

/** Whether a dual combines before its brush's grain cuts it: a `layer` linear height shapes where the stamps' paint lies. */
export const stampDualBeforeGrain = (blend: StampDualBlend) => blend.family === 'layer' && blend.mode === 'linearHeight';

/**
 * The formulas built on the mode tables, each the WGSL function of its name that the renderer calls, a look's fields
 * passed one by one and a blend as its family's case.
 */
const STAMP_COVERAGE_FUNCTIONS = {
  /** Coverage `a` cut by grain paint `v` (1 keeps paint) at the grain's depth, by its blend. */
  grainCut: /* wgsl */ `fn grainCut(a: f32, v: f32, d: f32, mode: i32, layer: bool) -> f32 {
  if (layer) { return a + d * (clamp(grainLayer(a, v, mode), 0.0, 1.0) - a); }
  return grainTexture(a, v, d, mode);
}`,
  /**
   * The dual's coverage `s` combined with the brush's grained coverage `p` by `blend`. The layer blends would paint
   * where the brush has none, so they're held to where it has paint (fully from p = 1/8).
   */
  dualCombine: /* wgsl */ `fn dualCombine(p: f32, s: f32, mode: i32, layer: bool) -> f32 {
  if (layer) { return clamp(dualLayer(p, s, mode), 0.0, 1.0) * clamp(p * 8.0, 0.0, 1.0); }
  return dualTexture(p, s, mode);
}`,
  /**
   * A grain's paint as its brush adjusts it: `raw` 0..1 as the image holds it (1 paints), `mean` its mean paint. About
   * mid-grey, Photoshop's pattern brightness and contrast; a contrast of 1 (Photoshop's 100) is steep but finite.
   * About the mean, stretched and then brightened.
   */
  grainPaint: /* wgsl */ `fn grainSlope(contrast: f32) -> f32 { return select(1.0 / (1.0 - contrast), 1.0 + contrast, contrast < 0.0); }
fn grainPaint(raw: f32, brightness: f32, contrast: f32, aboutMean: bool, mean: f32) -> f32 {
  if (aboutMean) { return clamp(mean + (raw - mean) * grainSlope(min(contrast, 0.999)) + brightness, 0.0, 1.0); }
  if (contrast == 0.0) { return clamp(raw + brightness, 0.0, 1.0); }
  if (contrast < 0.0) { return clamp((raw - 128.0 / 255.0) * (1.0 + contrast) + 0.5 + brightness, 0.0, 1.0); }
  let pivot = select(127.5 / 255.0, 126.589 / 255.0, contrast >= 1.0);
  let slope = select(1.0 / (1.0 - contrast), 231.63, contrast >= 1.0);
  return clamp((raw + brightness - pivot) * slope + 128.0 / 255.0, 0.0, 1.0);
}`,
  /**
   * A tip's noise at its pixel (x, y) in stamp `seed`, 0..1: uniform, and fresh in every stamp, by PCG hashes.
   */
  tipNoiseAt: /* wgsl */ `fn pcgHash(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn tipNoiseAt(x: u32, y: u32, seed: u32) -> f32 { return f32(pcgHash(x ^ pcgHash(y ^ pcgHash(seed)))) / 4294967296.0; }`,
  /**
   * Coverage `a` under noise `n` at `depth`: overlaid by 0.5 + depth·(n − 0.5), so the noise is widest at half
   * coverage and none where the tip is empty or full. Photoshop's Noise: depth 2/3, uniform (the `random noise` probe's
   * spread against its soft stamp's mean, kurtosis 1.85).
   */
  tipNoise: /* wgsl */ `fn tipNoise(a: f32, n: f32, depth: f32) -> f32 { return clamp(overlaid(a, 0.5 + depth * (n - 0.5)), 0.0, 1.0); }`,
  /**
   * A pressed tip's paint `a` where it touches: the texel's contact pressure is its contact image's paint `c` read down
   * from `hi` to `lo`, times `grow`; it touches over a ramp `softness` wide, centred there, as `pressure` passes it.
   */
  pressedTip: /* wgsl */ `fn pressedTip(a: f32, c: f32, pressure: f32, softness: f32, lo: f32, hi: f32, grow: f32) -> f32 {
  return a * clamp(0.5 + (pressure - (hi - c * (hi - lo)) * grow) / softness, 0.0, 1.0);
}`,
  /** Wet edges' pooling of built coverage `c`: rising to `peak` at half coverage, easing to `body` at full. */
  pooled: /* wgsl */ `fn pooled(c: f32, peak: f32, body: f32) -> f32 {
  return select(peak - 4.0 * (peak - body) * (c - 0.5) * (c - 0.5), 2.0 * peak * c, c <= 0.5);
}`,
};

/** A stamp's noise seed: its place's f32 bits hashed. */
const STAMP_NOISE_SEED_WGSL = 'fn stampNoiseSeed(p: vec2f) -> u32 { let bits = bitcast<vec2u>(p); return bits.x ^ (bits.y * 0x9e3779b9u); }';

/** Photoshop's wet edges (fitted at rms 0.00009): half coverage pools to 192/255, full coverage to 150/255. */
export const PHOTOSHOP_POOLING: StampPooling = { kind: 'pooling', peak: 192 / 255, body: 150 / 255 };

/** Cases of a WGSL function `name` switching on `select` (an i32), one for each of `bodies`; the last is also the default. */
export function stampWgslSwitch(name: string, params: string, returns: string, select: string, bodies: readonly string[]): string {
  const cases = bodies.map((body, i) => `    case ${i}${i === bodies.length - 1 ? ', default' : ''}: { ${body} }`);
  return `fn ${name}(${params}) -> ${returns} {\n  switch (${select}) {\n${cases.join('\n')}\n  }\n}`;
}

/** A family's formulas as a WGSL function switching on its mode's index. */
const wgslModes = (name: string, params: string, formulas: readonly Formula[]) =>
  stampWgslSwitch(name, `${params}, mode: i32`, 'f32', 'mode', formulas.map((wgsl) => `return ${wgsl};`));

/** The registry in WGSL: each family's mode switch, then STAMP_COVERAGE_FUNCTIONS, which call them. */
// Colour dodge and burn scale their pattern by depth × 248/255, floored to a 255th: Photoshop's, fitted at depths 100
// and 50 on the texture probes and full depth on the dual's.
export const COVERAGE_FORMULAS_WGSL = /* wgsl */ `
fn dodgeScale(depth: f32) -> f32 { return floor(round(depth * 255.0) * 248.0 / 255.0) / 255.0; }
fn overlaid(base: f32, blend: f32) -> f32 { return select(1.0 - 2.0 * (1.0 - base) * (1.0 - blend), 2.0 * base * blend, base < 0.5); }
${wgslModes('grainTexture', 'a: f32, v: f32, d: f32', Object.values(GRAIN_TEXTURE))}
${wgslModes('grainLayer', 'a: f32, g: f32', Object.values(GRAIN_LAYER))}
${wgslModes('dualTexture', 'p: f32, s: f32', Object.values(DUAL_TEXTURE).map(({ wgsl }) => wgsl))}
${wgslModes('dualLayer', 'p: f32, s: f32', Object.values(DUAL_LAYER).map(({ wgsl }) => wgsl))}
${Object.values(STAMP_COVERAGE_FUNCTIONS).join('\n')}
${STAMP_NOISE_SEED_WGSL}`;
