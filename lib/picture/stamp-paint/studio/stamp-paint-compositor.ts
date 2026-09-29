// stamp-paint-compositor.ts: how paint lands on what's under it. Every colour that reaches a stamp painting passes
// through here, a deposit onto its group's layer, then a finished group onto the painting, so mixing paint as pigment
// (Kubelka–Munk layering and mixing, vid-83) replaces this one module and nothing else.
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
import {
  bindPaintGlTexture, createPaintGlProgram, drawFullFrame, drawPaintGlPingPong, FULL_FRAME_VERTEX,
  type PaintGlBox, type PaintGlPingPong, type PaintGlTarget,
} from './stamp-paint-gl.ts';

export type StampPaintCompositor = {
  /** Lays `material` onto `layer` within `box`, as much of it at each pixel as `coverage`'s red channel says. */
  deposit: (layer: PaintGlPingPong, coverage: PaintGlTarget, material: PaintMaterial, blend: StampBlend, box: PaintGlBox) => void;
  /** Lays a finished group's layer (premultiplied) onto `painting` within `box`. */
  group: (painting: PaintGlPingPong, layer: PaintGlTarget, composite: 'opaque' | 'glaze', opacity: number, box: PaintGlBox) => void;
  dispose: () => void;
};

const BLENDS: readonly StampBlend[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'];

const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D destination;
uniform sampler2D source;
uniform bool sourceIsCoverage;
uniform vec3 color;
uniform float opacity;
uniform int blend;
uniform float cover;
out vec4 result;

vec3 blended(vec3 b, vec3 s) {
  if (blend == 1) return b * s;
  if (blend == 2) return b + s - b * s;
  if (blend == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (blend == 4) return min(b, s);
  if (blend == 5) return max(b, s);
  return s;
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 under = texelFetch(destination, pixel, 0);
  vec4 over = sourceIsCoverage ? vec4(color, 1.0) * clamp(texelFetch(source, pixel, 0).r, 0.0, 1.0) : texelFetch(source, pixel, 0);
  // Raising coverage keeps the paint's own colour: premultiplied, its colour scales with it.
  over *= min(cover, 1.0 / max(over.a, 0.001)) * opacity;
  vec3 s = over.a > 0.0 ? over.rgb / over.a : vec3(0.0);
  vec3 b = under.a > 0.0 ? under.rgb / under.a : vec3(0.0);
  // Where nothing is under it yet, a blend has nothing to act on and the paint lands as itself.
  vec3 mixed = (1.0 - under.a) * s + under.a * blended(b, s);
  result = vec4(over.a * mixed + (1.0 - over.a) * under.rgb, over.a + under.a * (1.0 - over.a));
}`;

/** How much an opaque group's coverage is raised: a wash at half its density or more covers. */
const OPAQUE_COVER = 2;

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

/** The flat-colour compositor: normal and multiply and the other separable blends, in sRGB. */
export function createFlatStampCompositor(gl: WebGL2RenderingContext): StampPaintCompositor {
  const program = createPaintGlProgram(gl, FULL_FRAME_VERTEX, COMPOSITE_FRAGMENT);
  const draw = (target: PaintGlPingPong, source: PaintGlTarget, box: PaintGlBox, settings: { coverage: boolean; color: [number, number, number]; opacity: number; blend: StampBlend; cover: number }) => {
    drawPaintGlPingPong(gl, target, box, () => {
      program.use();
      bindPaintGlTexture(gl, program, 'destination', 0, target.read.texture);
      bindPaintGlTexture(gl, program, 'source', 1, source.texture);
      gl.uniform1i(program.uniform('sourceIsCoverage'), settings.coverage ? 1 : 0);
      gl.uniform3fv(program.uniform('color'), settings.color);
      gl.uniform1f(program.uniform('opacity'), settings.opacity);
      gl.uniform1i(program.uniform('blend'), BLENDS.indexOf(settings.blend));
      gl.uniform1f(program.uniform('cover'), settings.cover);
      gl.disable(gl.BLEND);
      drawFullFrame(gl);
    });
  };
  return {
    deposit: (layer, coverage, material, blend, box) => draw(layer, coverage, box, { coverage: true, color: channels(material.color), opacity: 1, blend, cover: 1 }),
    group: (painting, layer, composite, opacity, box) => draw(painting, layer, box, {
      coverage: false, color: [0, 0, 0], opacity, blend: composite === 'opaque' ? 'normal' : 'multiply', cover: composite === 'opaque' ? OPAQUE_COVER : 1,
    }),
    dispose: () => gl.deleteProgram(program.program),
  };
}
