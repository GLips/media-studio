// stamp-paint-compositor.ts: how paint lands on what's under it. Every colour that reaches a stamp painting passes
// through here, a deposit onto its group's layer, then a finished group onto the painting, so mixing paint as pigment
// (Kubelka–Munk layering and mixing, vid-83) replaces this one module and nothing else.
//
// It's WGSL the renderer's compute passes include (stamp-paint-renderer.ts): `depositPaint` and `groupPaint` take
// what's under the paint and return the result, each pixel premultiplied, and `writePaintDeposit` fills the
// `PaintDeposit` a deposit's pass reads its paint from.
//
// This compositor mixes paint as flat colour, in sRGB as Procreate does: a deposit by its blend (W3C separable
// blending, over a group layer that may still be clear), a group by its composite: `opaque` covers, its coverage
// raised so a body of paint hides what's under it while its thin edges stay soft; `glaze` multiplies at its opacity,
// so what's under it shows through tinted, as a transparent wash does.
//
// Negative space: a `pigment` material mixes as a `flat` one until vid-83. Colours mix in sRGB, not linear light,
// because that's how the pack's author saw them mix.

import type { StampBlend } from '../models/stamp-brush.ts';
import type { PaintMaterial } from '../models/stamp-paint-recipe.ts';

const BLENDS: readonly StampBlend[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'colorBurn'];

/** A blend's number in the compositor's WGSL, for a pass that states a blend of its own (a burnt rim's). */
export const stampPaintBlendIndex = (blend: StampBlend) => BLENDS.indexOf(blend);

/** How much an opaque group's coverage is raised: a wash at half its density or more covers. */
const OPAQUE_COVER = 2;

export const STAMP_PAINT_COMPOSITOR_WGSL = /* wgsl */ `
struct PaintDeposit { color: vec3f, blend: i32 }

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
}

/** \`paint\` laid onto a group's layer, as much of it as \`coverage\` says. */
fn depositPaint(under: vec4f, paint: PaintDeposit, coverage: f32) -> vec4f {
  return laidOver(under, vec4f(paint.color, 1.0) * clamp(coverage, 0.0, 1.0), paint.blend);
}

/** A finished group's layer laid onto the painting: glazed (multiplied) or opaque. */
fn groupPaint(under: vec4f, layer: vec4f, glaze: bool, opacity: f32) -> vec4f {
  // Raising coverage keeps the paint's own colour: premultiplied, its colour scales with it.
  let cover = select(${OPAQUE_COVER.toFixed(1)}, 1.0, glaze);
  let over = layer * min(cover, 1.0 / max(layer.a, 0.001)) * opacity;
  return laidOver(under, over, select(0, 1, glaze));
}`;

/** Words in a PaintDeposit: its colour and its blend. */
export const PAINT_DEPOSIT_WORDS = 4;

/** Writes the PaintDeposit for `material` laid by `blend` at word `at` of a uniform slot. */
export function writePaintDeposit(floats: Float32Array, ints: Int32Array, at: number, material: PaintMaterial, blend: StampBlend) {
  floats.set([1, 3, 5].map((i) => parseInt(material.color.slice(i, i + 2), 16) / 255), at);
  ints[at + 3] = stampPaintBlendIndex(blend);
}
