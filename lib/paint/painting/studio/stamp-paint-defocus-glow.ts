// stamp-paint-defocus-glow.ts: the renderer's passes for what a lens and light do to a laid group or outside layer.
// Defocus: a separable gaussian over the group's painted layer (its film) before the lay, or over an outside layer's
// light before its own. Glow: the laid paint brighter than a threshold, in linear light, weighted by how much of the
// pixel the group covers, blurred on the stage and added to the frame's light, which the output adds before encoding.
//
// A gaussian pass reads only its read box and counts what lies past it as clear, so whatever a target held outside a
// group's paint (another group's, or a frame before) never reaches the result.

import type { StampStage } from '../models/stamp-stage.ts';
import { stampStageWgsl } from '../models/stamp-stage.ts';
import type { StampPaintCompositor } from './stamp-paint-compositor.ts';
import { stampUniformLayout } from './stamp-uniform-layout.ts';

/**
 * One direction of a gaussian: `axis` 0 across, 1 down; read within `readOrigin` `readExtent`, written over `origin`
 * `extent`, scaled by `gain`.
 */
export const STAMP_GAUSSIAN_PASS = stampUniformLayout('GaussianPass', [
  ['sigma', 'f32'], ['reach', 'u32'], ['axis', 'u32'], ['gain', 'f32'], ['readOrigin', 'vec2u'], ['readExtent', 'vec2u'], ['origin', 'vec2u'], ['extent', 'vec2u'],
]);

/**
 * WGSL for one direction of a gaussian over `layers` array layers of rgba16float (a plain texture viewed as an array
 * of one). `accumulate`: adds the result to what the target holds, else replaces it. Weights are normalised over every
 * tap, read or not: a group's paint fades into clear past its box, as a lens spreads it.
 */
export function stampGaussianPassWgsl(layers: number, accumulate: boolean, workgroup: number) {
  return /* wgsl */ `
${STAMP_GAUSSIAN_PASS.wgsl}
@group(0) @binding(0) var<uniform> u: GaussianPass;
@group(0) @binding(1) var source: texture_2d_array<f32>;
@group(0) @binding(2) var blurred: texture_storage_2d_array<rgba16float, ${accumulate ? 'read_write' : 'write'}>;
@compute @workgroup_size(${workgroup}, ${workgroup}) fn gaussianPass(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = vec2i(u.origin + id.xy);
  let step = select(vec2i(1, 0), vec2i(0, 1), u.axis == 1u);
  let low = vec2i(u.readOrigin);
  let high = low + vec2i(u.readExtent);
  let reach = i32(u.reach);
  var sum: array<vec4f, ${layers}>;
  var total = 0.0;
  for (var i = -reach; i <= reach; i++) {
    let w = exp(-0.5 * f32(i * i) / (u.sigma * u.sigma));
    total += w;
    let at = pixel + step * i;
    if (any(at < low) || any(at >= high)) { continue; }
    for (var l = 0u; l < ${layers}u; l++) { sum[l] += w * textureLoad(source, at, l, 0); }
  }
  for (var l = 0u; l < ${layers}u; l++) {
    let value = sum[l] * (u.gain / total);
    ${accumulate ? 'textureStore(blurred, pixel, l, textureLoad(blurred, pixel, l) + value);' : 'textureStore(blurred, pixel, l, value);'}
  }
}`;
}

/**
 * A glow's source over `origin` `extent`: the painting's linear light past `threshold` (by luminance, its hue kept),
 * times the cover there and `strength` (the group's opacity and visibility, or the outside layer's visibility).
 */
export const STAMP_GLOW_SOURCE = stampUniformLayout('GlowSource', [['threshold', 'f32'], ['strength', 'f32'], ['glaze', 'u32'], ['origin', 'vec2u'], ['extent', 'vec2u']]);

/** Where a glow's cover comes from: a group's layer as laid still, or through its lattice's rest map, or an outside layer. */
export type StampGlowCover = 'group' | 'moved group' | 'outside';

/** A rest map's value where no lattice covers a pixel: the renderer's STAMP_NO_REST, halved as its group pass tests it. */
const restMissing = (noRest: number) => `${noRest / 2}.0`;

/** sRGB's transfer, both ways: screenColor is gamma-encoded, and light adds linearly. */
export const STAMP_SRGB_WGSL = /* wgsl */ `
fn srgbDecoded(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
fn srgbEncoded(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }`;

/**
 * The glow source pass's WGSL for `compositor` on `stage`: binds its uniform (0), the painting sampled (1), the glow
 * source written (2), its cover (3: the layer, or the outside layer's texture) and, for a moved group, its rest map (4).
 */
export function stampGlowSourceWgsl(compositor: StampPaintCompositor, cover: StampGlowCover, stage: StampStage, noRest: number, workgroup: number) {
  const { layer, painting } = compositor.targets;
  const paintingType = painting.kind === 'array' ? 'texture_2d_array<f32>' : 'texture_2d<f32>';
  const layerType = cover !== 'outside' && layer.kind === 'array' ? 'texture_2d_array<f32>' : 'texture_2d<f32>';
  const firstLayer = (texel: string) => (cover !== 'outside' && layer.kind === 'array' ? `textureLoad(source, ${texel}, 0u, 0)` : `textureLoad(source, ${texel}, 0)`);
  const coverAt = {
    group: `fn coverAt(pixel: vec2u) -> f32 { return groupCover(${firstLayer('pixel')}, u.glaze == 1u); }`,
    'moved group': /* wgsl */ `
@group(0) @binding(4) var rest: texture_2d<f32>;
fn coverAt(pixel: vec2u) -> f32 {
  let q = textureLoad(rest, pixel, 0).xy - 0.5;
  if (q.x < ${restMissing(noRest)}) { return 0.0; }
  let base = floor(q);
  let f = q - base;
  var covered = 0.0;
  for (var k = 0u; k < 4u; k++) {
    let corner = vec2u(k & 1u, k >> 1u);
    let w = select(1.0 - f.x, f.x, corner.x == 1u) * select(1.0 - f.y, f.y, corner.y == 1u);
    let tap = vec2i(base) + STAGE_MARGIN + vec2i(corner);
    if (w == 0.0 || any(tap < vec2i(0)) || any(tap >= vec2i(textureDimensions(source)))) { continue; }
    covered += w * groupCover(${firstLayer('vec2u(tap)')}, u.glaze == 1u);
  }
  return covered;
}`,
    outside: `fn coverAt(pixel: vec2u) -> f32 { return clamp(${firstLayer('pixel')}.a, 0.0, 1.0); }`,
  }[cover];
  return /* wgsl */ `
${stampStageWgsl(stage)}
${STAMP_SRGB_WGSL}
${STAMP_GLOW_SOURCE.wgsl}
@group(0) @binding(0) var<uniform> u: GlowSource;
@group(0) @binding(1) var painting: ${paintingType};
@group(0) @binding(2) var glow: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var source: ${layerType};
${compositor.output}
${compositor.group.cover}
${coverAt}
@compute @workgroup_size(${workgroup}, ${workgroup}) fn glowSource(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let covered = clamp(coverAt(pixel), 0.0, 1.0) * u.strength;
  var light = vec3f(0.0);
  if (covered > 0.0) {
    let c = srgbDecoded(clamp(screenColor(pixel), vec3f(0.0), vec3f(1.0)));
    let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    light = c * (max(0.0, luma - u.threshold) / max(luma, 1e-4)) * covered;
  }
  textureStore(glow, pixel, vec4f(light, 0.0));
}`;
}
