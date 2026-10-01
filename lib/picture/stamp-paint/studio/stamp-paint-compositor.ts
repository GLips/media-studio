// stamp-paint-compositor.ts: how paint lands on what's under it, a deposit onto its group's layer, a group onto the
// painting, the paper under all of it and the painting onto the screen. The renderer asks a StampPaintCompositor for
// those four steps and holds the textures it asks for; mixing as pigment is a second compositor
// (stamp-paint-pigment-compositor.ts).
//
// This one mixes flat colour: a deposit by its blend (W3C separable, over a maybe-clear layer), moved by its stamps'
// tints; an `opaque` group covers, coverage raised so a body hides what's under it while thin edges stay soft; a
// `glaze` multiplies at its opacity. Colours mix gamma-encoded, as Photoshop does with RGB blend gamma off: nothing
// decodes to linear light.

import type { StampBlend } from '../models/stamp-brush.ts';
import { STAMP_OPAQUE_COVER, type CompiledStampDeposit, type CompiledStampPaint } from '../models/stamp-paint-recipe.ts';
import { stampUniformLayout, stampUniformWriter, type StampUniformField, type StampUniformLayout, type StampUniformViews } from './stamp-uniform-layout.ts';

/** A texture the compositor keeps its paint in: four channels, or an array of `layers` of four. */
export type StampPaintTarget = { kind: 'plain' } | { kind: 'array'; layers: number };

/**
 * A way of mixing paint: WGSL for four passes, each defining the functions its pass calls (named per piece below)
 * and binding its own resources. The renderer declares `layer` and `painting` from `targets`, and in the deposit pass
 * `paint`, the compositor's PaintDeposit, and `u.paperDepth`; in the group pass `u.group` (its index) and `u.paper`,
 * for `paperColor(image, sampler, u.paper, pixel, size)`.
 */
export type StampPaintCompositor = {
  targets: { layer: StampPaintTarget; painting: StampPaintTarget };
  /** Whether a stamp's own tint (a brush's colour dynamics) moves its paint: the renderer lays tints only for one that reads them. */
  readsStampTints: boolean;
  deposit: {
    /** Its PaintDeposit, the renderer's `paint`. */
    layout: StampUniformLayout<readonly StampUniformField[]>;
    /**
     * Its bindings from 24; `paperKept(tooth, mean, depth)`, `layerCoverage(pixel)` and `layDeposit(pixel, coverage,
     * rims, tooth, at)`: `rims` the main and dual burnt rims apart, `tooth` the paper's paint here and its mean.
     */
    wgsl: string;
    /**
     * For a compositor that lays washes: `landDeposit(pixel, coverage, rims, tooth, at, wet)`, a wash's deposit laid as
     * its WetLanding says, coverage hardened already. The renderer declares WetLanding (with `settled`), the landing
     * laws (stamp-wet-landing.ts), and WET_PAINT, WET_WATER and WET_LIFT. Absent, a painting with a wash is refused.
     */
    wet?: string;
    /** The writer of `deposit`'s PaintDeposit, made once as the renderer loads it. */
    writerFor: (deposit: CompiledStampDeposit) => (views: StampUniformViews) => void;
    /**
     * What it binds from 24, given the renderer's tint targets (blank where a pass has none), for a dry resolve or a
     * wash's (`wet`): a binding only `wet` reads must be left out of a dry one's, whose layout doesn't hold it.
     */
    resources: (bound: { tints: { a: GPUTextureView; b: GPUTextureView }; wet: boolean }) => GPUBindingResource[];
  };
  group: {
    /** Its bindings from 3; `layGroup(pixel, glaze, opacity)`. */
    wgsl: string;
    /** What it binds from 3, given the paper's photograph (a blank texture if it has none) and a sampler. */
    resources: (paper: { photograph: GPUTextureView; sampler: GPUSampler }) => GPUBindingResource[];
  };
  /** For a compositor that lays washes, how a wash group's layer is kept, for the stages that move its paint. */
  wash?: StampWashLayer;
  /** `layPaper(pixel, color)`, `color` gamma-encoded. */
  paper: string;
  /** `screenColor(pixel)`, gamma-encoded. */
  output: string;
};

/**
 * How a compositor keeps a wash group's layer, for a stage (stamp-wet-stages.ts) that moves paint about within it.
 * A stage moves pigment channels only; what the rest becomes is the compositor's one rule, `washMoved`.
 */
export type StampWashLayer = {
  /** Layers of four channels `deposit`'s group keeps, from the first: a stage reads and writes no more. */
  layersOf: (deposit: CompiledStampDeposit) => number;
  /**
   * WGSL for a group of `layers` layers: `washPigmentMask(l)`, 1 on layer `l`'s pigment channels; `washPigmentTotal(v)`
   * and `washOpen(v)`, a pixel's pigment and open share; and `washMoved(now, wasPigment)`, the pixel once a stage has
   * moved its pigment total from `wasPigment` to `now`'s, its other channels as before the move.
   */
  movedWgsl: (layers: number) => string;
  /**
   * WGSL for `deposit`'s group: `washHold(l, at, tooth, depth, held)`, how much of each of layer `l`'s channels the
   * paper holds at `at` against its mean (1), as the compositor lays paint there; `tooth` the paper's paint here and
   * its mean, `depth` the paper's, `held` the layer's amounts. Moved paint evens out per unit of it.
   */
  holdWgsl: (deposit: CompiledStampDeposit) => string;
};

const BLENDS: readonly StampBlend[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'colorBurn'];

const blendIndex = (blend: StampBlend) => BLENDS.indexOf(blend);

const FLAT_PAINT_DEPOSIT = stampUniformLayout('PaintDeposit', [
  ['color', 'vec3f'], ['blend', 'i32'], ['secondary', 'vec3f'], ['tinted', 'u32'], ['burntBlend', 'i32'], ['dualBurntBlend', 'i32'],
]);

const FLAT_WGSL = /* wgsl */ `
fn blendedPaint(b: vec3f, s: vec3f, blend: i32) -> vec3f {
  switch (blend) {
    case 1: { return b * s; }
    case 2: { return b + s - b * s; }
    case 3: { return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(vec3f(0.5), b)); }
    case 4: { return min(b, s); }
    case 5: { return max(b, s); }
    case 6: { return select(1.0 - min(vec3f(1.0), (1.0 - b) / max(s, vec3f(1e-4))), vec3f(1.0), b >= vec3f(1.0)); }
    default: { return s; }
  }
}

fn laidOver(under: vec4f, over: vec4f, blend: i32) -> vec4f {
  let s = select(vec3f(0.0), over.rgb / over.a, over.a > 0.0);
  let b = select(vec3f(0.0), under.rgb / under.a, under.a > 0.0);
  // Where nothing is under it yet, a blend has nothing to act on and the paint lands as itself.
  let mixed = (1.0 - under.a) * s + under.a * blendedPaint(b, s, blend);
  return vec4f(over.a * mixed + (1.0 - over.a) * under.rgb, over.a + under.a * (1.0 - over.a));
}`;

const FLAT_TINT_WGSL = /* wgsl */ `
@group(0) @binding(24) var tintA: texture_2d<f32>;
@group(0) @binding(25) var tintB: texture_2d<f32>;
fn hsl(c: vec3f) -> vec3f {
  let hi = max(c.r, max(c.g, c.b));
  let lo = min(c.r, min(c.g, c.b));
  let l = (hi + lo) / 2.0;
  let d = hi - lo;
  if (d <= 0.0) { return vec3f(0.0, 0.0, l); }
  var h = (c.r - c.g) / d + 4.0;
  if (hi == c.r) { h = (c.g - c.b) / d + 6.0; } else if (hi == c.g) { h = (c.b - c.r) / d + 2.0; }
  return vec3f(fract(h / 6.0), d / (1.0 - abs(2.0 * l - 1.0)), l);
}
fn rgbOf(v: vec3f) -> vec3f {
  let c = (1.0 - abs(2.0 * v.z - 1.0)) * v.y;
  let k = (vec3f(0.0, 8.0, 4.0) + v.x * 12.0) % 12.0;
  return v.z - c / 2.0 * max(vec3f(-1.0), min(min(k - 3.0, 9.0 - k), vec3f(1.0)));
}
// The deposit's colour moved by its stamps' mean tint here, as shiftStampPaintColor (stamp-paint-color.ts) moves one.
fn tinted(color: vec3f, pixel: vec2u) -> vec3f {
  let a = textureLoad(tintA, pixel, 0);
  if (a.w <= 0.0) { return color; }
  let t = a.xyz / a.w;
  let v = hsl(color);
  let moved = rgbOf(vec3f(fract(v.x + t.x), clamp(v.y + t.y, 0.0, 1.0), clamp(v.z + t.z, 0.0, 1.0)));
  return mix(moved, paint.secondary, clamp(textureLoad(tintB, pixel, 0).x / a.w, 0.0, 1.0));
}`;

const byteAt = (color: string, i: number) => parseInt(color.slice(i, i + 2), 16) / 255;
const hexRgb = (color: string): [number, number, number] => [byteAt(color, 1), byteAt(color, 3), byteAt(color, 5)];

/**
 * The flat compositor for `painting`: each deposit's colour and blends worked out once. Throws on a mixture of
 * pigments, a graded material or a wash: flat colour has no pigment to grade or water to carry it.
 */
export function flatStampPaintCompositor(painting: CompiledStampPaint): StampPaintCompositor {
  const writers = new Map<CompiledStampDeposit, (views: StampUniformViews) => void>();
  const passes = painting.groups.flatMap((group) => group.passes);
  const deposits = passes.flatMap((pass) => {
    if (pass.kind === 'wash') throw new Error(`stamp paint: ${pass.id} is a wash, and wet paint needs a style that paints in pigment`);
    return pass.deposits;
  });
  for (const deposit of deposits) {
    const { action, brush } = deposit;
    if (action.material.kind !== 'constant') throw new Error(`stamp paint: ${deposit.id} grades its material, which only a style that paints in pigment can lay`);
    const material = action.material.value;
    if (material.kind === 'mixture') throw new Error(`stamp paint: ${deposit.id} lays a mixture of pigments, which only a style that paints in pigment can lay`);
    const color = hexRgb(material.color), secondary = hexRgb(action.secondaryColor ?? '#000000');
    const burntBlend = (brush.burntEdge ?? brush.dual?.burntEdge)?.blend ?? 'colorBurn';
    const dualBurntBlend = brush.dual?.burntEdge?.blend ?? burntBlend;
    writers.set(deposit, (views) => {
      const put = stampUniformWriter(FLAT_PAINT_DEPOSIT, views);
      put('color', color);
      put('blend', blendIndex(deposit.blend));
      put('secondary', secondary);
      put('tinted', brush.color ? 1 : 0);
      put('burntBlend', blendIndex(burntBlend));
      put('dualBurntBlend', blendIndex(dualBurntBlend));
    });
  }
  return {
    targets: { layer: { kind: 'plain' }, painting: { kind: 'plain' } },
    readsStampTints: true,
    deposit: {
      layout: FLAT_PAINT_DEPOSIT,
      wgsl: /* wgsl */ `
${FLAT_WGSL}
${FLAT_TINT_WGSL}
// A paper's tooth was photographed, not drawn as a brush grain is: it cuts in proportion to its own mean paint.
fn paperKept(tooth: f32, mean: f32, depth: f32) -> f32 { return mix(1.0, clamp(tooth / max(mean, 0.01), 0.0, 1.0), depth); }
fn layerCoverage(pixel: vec2u) -> f32 { return textureLoad(layer, pixel).a; }
fn depositPaint(under: vec4f, color: vec3f, blend: i32, coverage: f32) -> vec4f {
  return laidOver(under, vec4f(color, 1.0) * clamp(coverage, 0.0, 1.0), blend);
}
fn layDeposit(pixel: vec2u, coverage: f32, rims: vec2f, tooth: vec2f, at: vec2f) {
  var color = paint.color;
  if (paint.tinted == 1u) { color = tinted(color, pixel); }
  var over = depositPaint(textureLoad(layer, pixel), color, paint.blend, coverage);
  // A burnt rim burns into paint already there, the group's or the deposit's own (its stamps laid over one another).
  // Rims burning by one blend are one rim, joined by max; each burns by its own blend when they differ.
  var burns = rims;
  if (paint.dualBurntBlend == paint.burntBlend) { burns = vec2f(max(rims.x, rims.y), 0.0); }
  if (burns.x > 0.0) { over = depositPaint(over, color, paint.burntBlend, burns.x); }
  if (burns.y > 0.0) { over = depositPaint(over, color, paint.dualBurntBlend, burns.y); }
  textureStore(layer, pixel, over);
}`,
      writerFor: (deposit) => {
        const writer = writers.get(deposit);
        if (!writer) throw new Error(`stamp paint: ${deposit.id} isn't in the painting its flat compositor was made for`);
        return writer;
      },
      resources: ({ tints: { a, b } }) => [a, b],
    },
    group: {
      wgsl: /* wgsl */ `
${FLAT_WGSL}
/** A finished group's layer laid onto the painting: glazed (multiplied) or opaque. */
fn layGroup(pixel: vec2u, glaze: bool, opacity: f32) {
  let layer = textureLoad(layer, pixel, 0);
  // Raising coverage keeps the paint's own colour: premultiplied, its colour scales with it.
  let cover = select(${STAMP_OPAQUE_COVER.toFixed(1)}, 1.0, glaze);
  let over = layer * min(cover, 1.0 / max(layer.a, 0.001)) * opacity;
  textureStore(painting, pixel, laidOver(textureLoad(painting, pixel), over, select(0, 1, glaze)));
}`,
      resources: () => [],
    },
    paper: /* wgsl */ `fn layPaper(pixel: vec2u, color: vec3f) { textureStore(painting, pixel, vec4f(color, 1.0)); }`,
    output: /* wgsl */ `fn screenColor(pixel: vec2u) -> vec3f { return textureLoad(painting, pixel, 0).rgb; }`,
  };
}
