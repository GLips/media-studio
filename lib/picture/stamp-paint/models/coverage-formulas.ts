// coverage-formulas.ts: one registry of how a grain cuts coverage, how a dual combines with its brush, a grain's
// brightness and contrast, and wet edges' pooling. Each entry is written twice: for the CPU reference (`cpu`) and
// the GPU (`wgsl`, in COVERAGE_FORMULAS_WGSL). Neither derives from the other, so `node harness/stamp-reference.ts
// formulas` runs every WGSL twin on the GPU over an input grid and holds it to its `cpu`. WGSL cases are generated
// from each family's table, which holds exactly its modes: one no importer reads has no formula.
//
// The `texture` formulas are Photoshop's, identified from its captures: each, constants included, fits its probes
// to the capture's noise. The `layer` formulas were fitted to Procreate's previews.

import type { StampBrushWetEdges, StampDualBlend, StampGrainBlend, StampGrainLook } from './stamp-brush.ts';

/** Each family's modes, from its blend's union. */
type ModeOf<B extends { family: string; mode: string }, F extends B['family']> = Extract<B, { family: F }>['mode'];
type StampPooling = Extract<StampBrushWetEdges, { kind: 'pooling' }>;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const overlay = (base: number, blend: number) => (base < 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend));
const smoothstep = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
/** PCG's output hash over a u32, as WGSL's u32 arithmetic wraps it. */
const pcgHash = (v: number) => {
  const s = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
};

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

/** Whether a dual combines before its brush's grain cuts it: a `layer` linear height shapes where the stamps' paint lies. */
export const stampDualBeforeGrain = (blend: StampDualBlend) => blend.family === 'layer' && blend.mode === 'linearHeight';

/** How far `contrast` (-1..1) steepens a grain: flattened by 1 + contrast below 0, steepened by 1 / (1 − contrast) above. */
export const stampGrainSlope = (contrast: number) => (contrast < 0 ? 1 + contrast : 1 / (1 - contrast));

type GrainLookOf<K extends keyof StampGrainLook<unknown>> = Pick<StampGrainLook<unknown>, K>;

/**
 * The formulas built on the mode tables, each a CPU function and the WGSL function of the same name that the renderer
 * calls, over the same arguments, a look's fields passed one by one and a blend as its family's case.
 */
export const STAMP_COVERAGE_FUNCTIONS = {
  /** Coverage `a` cut by grain paint `v` (1 keeps paint) at the grain's depth, by its blend. */
  grainCut: {
    cpu: (a: number, v: number, { depth, blend }: GrainLookOf<'depth' | 'blend'>) =>
      (blend.family === 'texture' ? GRAIN_TEXTURE[blend.mode].cpu(a, v, depth) : a + depth * (clamp01(GRAIN_LAYER[blend.mode].cpu(a, v)) - a)),
    wgsl: /* wgsl */ `fn grainCut(a: f32, v: f32, d: f32, mode: i32, layer: bool) -> f32 {
  if (layer) { return a + d * (clamp(grainLayer(a, v, mode), 0.0, 1.0) - a); }
  return grainTexture(a, v, d, mode);
}`,
  },
  /**
   * The dual's coverage `s` combined with the brush's grained coverage `p` by `blend`. The layer blends would paint
   * where the brush has none, so they're held to where it has paint (fully from p = 1/8).
   */
  dualCombine: {
    cpu: (p: number, s: number, blend: StampDualBlend) =>
      (blend.family === 'texture' ? DUAL_TEXTURE[blend.mode].cpu(p, s) : clamp01(DUAL_LAYER[blend.mode].cpu(p, s)) * clamp01(p * 8)),
    wgsl: /* wgsl */ `fn dualCombine(p: f32, s: f32, mode: i32, layer: bool) -> f32 {
  if (layer) { return clamp(dualLayer(p, s, mode), 0.0, 1.0) * clamp(p * 8.0, 0.0, 1.0); }
  return dualTexture(p, s, mode);
}`,
  },
  /**
   * A grain's paint as its brush adjusts it: `raw` 0..1 as the image holds it (1 paints), `mean` its mean paint. About
   * mid-grey, Photoshop's pattern brightness and contrast; a contrast of 1 (Photoshop's 100) is steep but finite.
   * About the mean, stretched and then brightened.
   */
  grainPaint: {
    cpu: (raw: number, { brightness: b, contrast: c, contrastPivot }: GrainLookOf<'brightness' | 'contrast' | 'contrastPivot'>, mean: number) => {
      if (contrastPivot === 'mean') return clamp01(mean + (raw - mean) * stampGrainSlope(Math.min(c, 0.999)) + b);
      if (c === 0) return clamp01(raw + b);
      if (c < 0) return clamp01((raw - 128 / 255) * (1 + c) + 0.5 + b);
      const [pivot, slope] = c >= 1 ? [126.589 / 255, 231.63] : [127.5 / 255, 1 / (1 - c)];
      return clamp01((raw + b - pivot) * slope + 128 / 255);
    },
    wgsl: /* wgsl */ `fn grainSlope(contrast: f32) -> f32 { return select(1.0 / (1.0 - contrast), 1.0 + contrast, contrast < 0.0); }
fn grainPaint(raw: f32, brightness: f32, contrast: f32, aboutMean: bool, mean: f32) -> f32 {
  if (aboutMean) { return clamp(mean + (raw - mean) * grainSlope(min(contrast, 0.999)) + brightness, 0.0, 1.0); }
  if (contrast == 0.0) { return clamp(raw + brightness, 0.0, 1.0); }
  if (contrast < 0.0) { return clamp((raw - 128.0 / 255.0) * (1.0 + contrast) + 0.5 + brightness, 0.0, 1.0); }
  let pivot = select(127.5 / 255.0, 126.589 / 255.0, contrast >= 1.0);
  let slope = select(1.0 / (1.0 - contrast), 231.63, contrast >= 1.0);
  return clamp((raw + brightness - pivot) * slope + 128.0 / 255.0, 0.0, 1.0);
}`,
  },
  /**
   * A tip's noise at its pixel (x, y) in stamp `seed`, 0..1: uniform, and fresh in every stamp. PCG hashes, in u32
   * arithmetic both sides, so the CPU draws the GPU's numbers.
   */
  tipNoiseAt: {
    cpu: (x: number, y: number, seed: number) => pcgHash((x ^ pcgHash((y ^ pcgHash(seed)) >>> 0)) >>> 0) / 4294967296,
    wgsl: /* wgsl */ `fn pcgHash(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn tipNoiseAt(x: u32, y: u32, seed: u32) -> f32 { return f32(pcgHash(x ^ pcgHash(y ^ pcgHash(seed)))) / 4294967296.0; }`,
  },
  /**
   * Coverage `a` under noise `n` at `depth`: overlaid by 0.5 + depth·(n − 0.5), so the noise is widest at half
   * coverage and none where the tip is empty or full. Photoshop's Noise: depth 2/3, uniform (the `random noise` probe's
   * spread against its soft stamp's mean, kurtosis 1.85).
   */
  tipNoise: {
    cpu: (a: number, n: number, depth: number) => clamp01(overlay(a, 0.5 + depth * (n - 0.5))),
    wgsl: /* wgsl */ `fn tipNoise(a: f32, n: f32, depth: f32) -> f32 { return clamp(overlaid(a, 0.5 + depth * (n - 0.5)), 0.0, 1.0); }`,
  },
  /**
   * A pressed tip's paint `a` where it touches: the texel's contact pressure is its contact image's paint `c` read down
   * from `hi` to `lo`, times `grow`; it touches over a ramp `softness` wide, centred there, as `pressure` passes it.
   */
  pressedTip: {
    cpu: (a: number, c: number, pressure: number, softness: number, lo: number, hi: number, grow: number) => a * clamp01(0.5 + (pressure - (hi - c * (hi - lo)) * grow) / softness),
    wgsl: /* wgsl */ `fn pressedTip(a: f32, c: f32, pressure: f32, softness: f32, lo: f32, hi: f32, grow: f32) -> f32 {
  return a * clamp(0.5 + (pressure - (hi - c * (hi - lo)) * grow) / softness, 0.0, 1.0);
}`,
  },
  /** Wet edges' pooling of built coverage `c`: rising to `peak` at half coverage, easing to `body` at full. */
  pooled: {
    cpu: (c: number, { peak, body }: Pick<StampPooling, 'peak' | 'body'>) => (c <= 0.5 ? 2 * peak * c : peak - 4 * (peak - body) * (c - 0.5) ** 2),
    wgsl: /* wgsl */ `fn pooled(c: f32, peak: f32, body: f32) -> f32 {
  return select(peak - 4.0 * (peak - body) * (c - 0.5) * (c - 0.5), 2.0 * peak * c, c <= 0.5);
}`,
  },
};

export const stampGrainCut = STAMP_COVERAGE_FUNCTIONS.grainCut.cpu;
export const stampDualCombine = STAMP_COVERAGE_FUNCTIONS.dualCombine.cpu;
export const stampGrainPaint = STAMP_COVERAGE_FUNCTIONS.grainPaint.cpu;
export const stampPooled = STAMP_COVERAGE_FUNCTIONS.pooled.cpu;
export const stampTipNoiseAt = STAMP_COVERAGE_FUNCTIONS.tipNoiseAt.cpu;
export const stampTipNoise = STAMP_COVERAGE_FUNCTIONS.tipNoise.cpu;
export const stampPressedTip = STAMP_COVERAGE_FUNCTIONS.pressedTip.cpu;

/** A stamp's noise seed: its place's f32 bits hashed, as the GPU reads them off the stamp it's given. */
export function stampNoiseSeed(x: number, y: number): number {
  const bits = new Uint32Array(Float32Array.of(x, y).buffer);
  return (bits[0] ^ Math.imul(bits[1], 0x9e3779b9)) >>> 0;
}
const STAMP_NOISE_SEED_WGSL = 'fn stampNoiseSeed(p: vec2f) -> u32 { let bits = bitcast<vec2u>(p); return bits.x ^ (bits.y * 0x9e3779b9u); }';

/** Photoshop's wet edges (fitted at rms 0.00009): half coverage pools to 192/255, full coverage to 150/255. */
export const PHOTOSHOP_POOLING: StampPooling = { kind: 'pooling', peak: 192 / 255, body: 150 / 255 };

/** Cases of a WGSL function `name` switching on `select` (an i32), one for each of `bodies`; the last is also the default. */
export function stampWgslSwitch(name: string, params: string, returns: string, select: string, bodies: readonly string[]): string {
  const cases = bodies.map((body, i) => `    case ${i}${i === bodies.length - 1 ? ', default' : ''}: { ${body} }`);
  return `fn ${name}(${params}) -> ${returns} {\n  switch (${select}) {\n${cases.join('\n')}\n  }\n}`;
}

/** A family's formulas as a WGSL function switching on its mode's index. */
const wgslModes = (name: string, params: string, table: Record<string, { wgsl: string }>) =>
  stampWgslSwitch(name, `${params}, mode: i32`, 'f32', 'mode', Object.values(table).map(({ wgsl }) => `return ${wgsl};`));

/** The registry in WGSL: each family's mode switch, then STAMP_COVERAGE_FUNCTIONS' twins, which call them. */
export const COVERAGE_FORMULAS_WGSL = /* wgsl */ `
fn dodgeScale(depth: f32) -> f32 { return floor(round(depth * 255.0) * 248.0 / 255.0) / 255.0; }
fn overlaid(base: f32, blend: f32) -> f32 { return select(1.0 - 2.0 * (1.0 - base) * (1.0 - blend), 2.0 * base * blend, base < 0.5); }
${wgslModes('grainTexture', 'a: f32, v: f32, d: f32', GRAIN_TEXTURE)}
${wgslModes('grainLayer', 'a: f32, g: f32', GRAIN_LAYER)}
${wgslModes('dualTexture', 'p: f32, s: f32', DUAL_TEXTURE)}
${wgslModes('dualLayer', 'p: f32, s: f32', DUAL_LAYER)}
${Object.values(STAMP_COVERAGE_FUNCTIONS).map(({ wgsl }) => wgsl).join('\n')}
${STAMP_NOISE_SEED_WGSL}`;
