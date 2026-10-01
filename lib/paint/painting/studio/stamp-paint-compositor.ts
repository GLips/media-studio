// stamp-paint-compositor.ts: how paint lands on what's under it, a deposit onto its group's layer, a group onto the
// painting, the paper under all of it and the painting onto the screen. The renderer asks a StampPaintCompositor for
// those four steps and holds the textures it asks for; mixing as pigment is a second compositor
// (stamp-paint-pigment-compositor.ts).
//
// This one mixes flat colour: a deposit by its blend (W3C separable, over a maybe-clear layer), moved by its stamps'
// tints; an `opaque` group covers, coverage raised so a body hides what's under it while thin edges stay soft; a
// `glaze` multiplies at its opacity. Colours mix gamma-encoded, as Photoshop does with RGB blend gamma off: nothing
// decodes to linear light.

import { checkPaintCapability } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampBlend } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampKeySpanAt, type StampKeyList } from '../models/stamp-scene-keys.ts';
import { STAMP_OPAQUE_COVER, type CompiledStampDeposit, type CompiledStampPaint } from '../models/stamp-paint-recipe-compile.ts';
import { stampUniformLayout, stampUniformWriter, type StampUniformField, type StampUniformLayout, type StampUniformViews } from './stamp-uniform-layout.ts';

/** A texture the compositor keeps its paint in: four channels, or an array of `layers` of four. */
export type StampPaintTarget = { kind: 'plain' } | { kind: 'array'; layers: number };

/**
 * sRGB's transfer, both ways, the one copy in WGSL: a compositor's paper, group, outside and output pieces call
 * srgbDecoded and srgbEncoded, and every module assembling them (or adding light, as glow does) declares this once.
 */
export const STAMP_SRGB_WGSL = /* wgsl */ `
fn srgbDecoded(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
fn srgbEncoded(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }`;

/**
 * A way of mixing paint: WGSL for four passes, each defining the functions its pass calls and binding its own
 * resources. The renderer declares `layer` and `painting` from `targets`, and in the deposit pass `paint`, the
 * compositor's PaintDeposit, and `u.paperDepth`; in the group pass `u.group` (its index) and `u.paper`, for
 * `paperColor(image, sampler, u.paper, at)` at `groupPaperAt(pixel)` (its paper) or `groupGroundAt(pixel)`.
 */
export type StampPaintCompositor = {
  targets: { layer: StampPaintTarget; painting: StampPaintTarget };
  /** Whether a stamp's own tint (a brush's colour dynamics) moves its paint: the renderer lays tints only for one that reads them. */
  readsStampTints: boolean;
  /**
   * What its lay reads besides the stamps' mask, the renderer laying each only for a compositor that reads it. `press`:
   * how hard the stamps pressed at a pixel, a dry medium's contact. `before`: the layer as the deposit found it, read
   * as far as `reach` texels of the paper's grain round a pixel (`u.beforeReach`, in pixels), a stacking medium's fill.
   */
  reads: { press: boolean; before: { reach: number } | null };
  deposit: {
    /** Its PaintDeposit, the renderer's `paint`. */
    layout: StampUniformLayout<readonly StampUniformField[]>;
    /**
     * Its bindings from 24; `paperKept(tooth, mean, depth)`, `layerCoverage(pixel)` and `layDeposit(pixel, coverage,
     * rims, tooth, at, press)`: `rims` the main and dual burnt rims apart, `tooth` the paper's paint here and its mean,
     * `press` 0..1 drawn, PAINT_DRY_BURNISHED_PRESS burnished, 1 unread.
     */
    wgsl: string;
    /**
     * For a compositor that lays washes: `landDeposit(pixel, coverage, rims, tooth, at, reserved, wet)`, a wash's deposit laid as
     * its WetLanding says, coverage hardened already; `reserved`, what masking fluid held off it (a knockout's reserve). The renderer declares WetLanding (with `settled`), the landing
     * laws (stamp-wet-landing.ts), and WET_PAINT, WET_WATER and WET_LIFT. Absent, a painting with a wash is refused.
     */
    wet?: string;
    /** The writer of `deposit`'s PaintDeposit at scene time `t` (its paint may be keyed), made once as the renderer loads it. */
    writerFor: (deposit: CompiledStampDeposit) => (views: StampUniformViews, t: number) => void;
    /**
     * What it binds from 24, given the renderer's tint targets (blank where a pass has none), for a dry resolve or a
     * wash's (`wet`): a binding only `wet` reads must be left out of a dry one's, whose layout doesn't hold it.
     */
    resources: (bound: { tints: { a: GPUTextureView; b: GPUTextureView }; wet: boolean }) => GPUBindingResource[];
  };
  group: {
    /**
     * Its bindings from 3; `layGroup(pixel, glaze, opacity)`, reading the group's layer by `groupLayerAt(pixel, l)` and
     * the painting under it by `groupUnderAt(pixel, i)`, writing by `groupLaid(pixel, i, value)`, never `layer` or
     * `painting` themselves: a moved group is laid once per bilinear tap of its layer, the laid paint then blended.
     */
    wgsl: string;
    /** What it binds from 3, given the paper's photograph (a blank texture if it has none) and a sampler. */
    resources: (paper: { photograph: GPUTextureView; sampler: GPUSampler }) => GPUBindingResource[];
    /**
     * `groupCover(layer0, glaze)`: how much of a pixel a group's layer covers as laid, 0..1 before its opacity, from its
     * first layer's texel alone. A glow weighs the light it takes by it. Binds nothing.
     */
    cover: string;
  };
  /** For a compositor that lays washes, how a wash group's layer is kept, for the stages that move its paint. */
  wash?: StampWashLayer;
  /** `layPaper(pixel, color)`, `color` gamma-encoded. */
  paper: string;
  /**
   * `layOutside(pixel, over)`: an outside layer's pixel (stamp-outside-layer.ts) laid over the painting, `over` linear
   * light, premultiplied, its colour within its alpha. Reads and writes `painting` alone.
   */
  outside: string;
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
   * WGSL for `deposit`'s group, of layersOf(deposit) layers in its medium: `washPigmentMask(l)`, 1 on layer `l`'s
   * pigment channels; `washPigmentTotal(v)` and `washOpen(v)`, a pixel's pigment and open share; and
   * `washMoved(now, wasPigment)`, the pixel once a stage has moved its pigment total from `wasPigment` to `now`'s, its
   * other channels as before the move.
   */
  movedWgsl: (deposit: CompiledStampDeposit) => string;
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

/** Keyed colour at `t`, eased between its keys' `colors` gamma-encoded, as flat colour mixes. */
function easedGammaColor(keys: StampKeyList<{ at: number }>, colors: readonly (readonly [number, number, number])[], t: number): [number, number, number] {
  const { from, to, share } = stampKeySpanAt(keys, t);
  const eased = (i: 0 | 1 | 2) => colors[from][i] + (colors[to][i] - colors[from][i]) * share;
  return [eased(0), eased(1), eased(2)];
}

/**
 * The flat compositor for `painting`: each deposit's colour and blends worked out once. Throws on a mixture of
 * pigments, a graded material or a wash: flat colour has no pigment to grade or water to carry it; and on a group on
 * its own paper: flat colour lays no paper under a group, so it has none to carry.
 */
export function flatStampPaintCompositor(painting: CompiledStampPaint): StampPaintCompositor {
  const writers = new Map<CompiledStampDeposit, (views: StampUniformViews, t: number) => void>();
  const cutOut = painting.groups.find((group) => group.paper === 'own');
  if (cutOut) throw new Error(`stamp paint: ${cutOut.id} lies on its own paper, and a group carries paper only in a style that paints in pigment`);
  const passes = painting.groups.flatMap((group) => group.passes);
  const deposits = passes.flatMap((pass) => {
    if (pass.kind === 'wash') throw new Error(`stamp paint: ${pass.id} is a wash, and wet paint needs a style that paints in pigment`);
    return pass.deposits;
  });
  for (const deposit of deposits) {
    const { action, brush } = deposit;
    if (action.material.kind !== 'constant') throw new Error(`stamp paint: ${deposit.id} grades its material, which only a style that paints in pigment can lay`);
    if (action.burnish) checkPaintCapability(null, 'burnish', `${deposit.id}'s burnish`);
    const material = action.material.value;
    const keys = material.kind === 'keys' ? material.keys : [{ at: 0, material }] as const;
    const colors = keys.map(({ material: m }) => {
      if (m.kind === 'mixture') throw new Error(`stamp paint: ${deposit.id} lays a mixture of pigments, which only a style that paints in pigment can lay`);
      return hexRgb(m.color);
    });
    // Flat paint is colour throughout, and a colour material always has a secondary (CompiledStampPaintAction).
    const { secondaryColor } = action;
    if (!secondaryColor) throw new Error(`stamp paint: ${deposit.id} lays colour with no secondary colour`);
    const secondaries = typeof secondaryColor === 'object' ? secondaryColor.keys : [{ at: 0, material: secondaryColor }] as const;
    const secondaryColors = secondaries.map(({ material: c }) => hexRgb(c));
    const burntBlend = (brush.burntEdge ?? brush.dual?.burntEdge)?.blend ?? 'colorBurn';
    const dualBurntBlend = brush.dual?.burntEdge?.blend ?? burntBlend;
    writers.set(deposit, (views, t) => {
      const put = stampUniformWriter(FLAT_PAINT_DEPOSIT, views);
      put('color', easedGammaColor(keys, colors, t));
      put('blend', blendIndex(deposit.blend));
      put('secondary', easedGammaColor(secondaries, secondaryColors, t));
      put('tinted', brush.color ? 1 : 0);
      put('burntBlend', blendIndex(burntBlend));
      put('dualBurntBlend', blendIndex(dualBurntBlend));
    });
  }
  return {
    targets: { layer: { kind: 'plain' }, painting: { kind: 'plain' } },
    readsStampTints: true,
    reads: { press: false, before: null },
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
fn layDeposit(pixel: vec2u, coverage: f32, rims: vec2f, tooth: vec2f, at: vec2f, press: f32) {
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
      cover: `fn groupCover(layer0: vec4f, glaze: bool) -> f32 { return min(1.0, layer0.a * select(${STAMP_OPAQUE_COVER.toFixed(1)}, 1.0, glaze)); }`,
      wgsl: /* wgsl */ `
${FLAT_WGSL}
/** A finished group's layer laid onto the painting: glazed (multiplied) or opaque. */
fn layGroup(pixel: vec2u, glaze: bool, opacity: f32) {
  let layer = groupLayerAt(pixel, 0u);
  // Raising coverage keeps the paint's own colour: premultiplied, its colour scales with it.
  let cover = select(${STAMP_OPAQUE_COVER.toFixed(1)}, 1.0, glaze);
  let over = layer * min(cover, 1.0 / max(layer.a, 0.001)) * opacity;
  groupLaid(pixel, 0u, laidOver(groupUnderAt(pixel, 0u), over, select(0, 1, glaze)));
}`,
      resources: () => [],
    },
    paper: /* wgsl */ `fn layPaper(pixel: vec2u, color: vec3f) { textureStore(painting, pixel, vec4f(color, 1.0)); }`,
    // Laid in linear light, as three composites it, though flat paint mixes gamma-encoded: an outside layer's
    // antialiased edge is coverage of light, and an opaque pixel comes out the colour rendered either way.
    outside: /* wgsl */ `
fn layOutside(pixel: vec2u, over: vec4f) {
  let under = textureLoad(painting, pixel);
  let light = over.rgb + srgbDecoded(under.rgb) * (1.0 - over.a);
  textureStore(painting, pixel, vec4f(srgbEncoded(clamp(light, vec3f(0.0), vec3f(1.0))), over.a + under.a * (1.0 - over.a)));
}`,
    output: /* wgsl */ `fn screenColor(pixel: vec2u) -> vec3f { return textureLoad(painting, pixel, 0).rgb; }`,
  };
}
