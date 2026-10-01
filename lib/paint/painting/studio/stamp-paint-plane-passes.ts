// stamp-paint-plane-passes.ts: the renderer's passes from a plane's paint to the frame (stamp-plane.ts). Each painted
// plane's picture (its colour, premultiplied; a clear plane's glaze; emission) is defocused and laid over the planes
// behind where the camera puts it. The output blooms the emission once, adds it, and encodes.
//
// A nearer plane is clear film, laid on its paper and on black. Over any backing its light is what it adds plus what
// it lets through of the backing, per channel, so the two lays and papers give both, whatever paint, glaze or lift
// made it. Laying a picture filters what's behind, then adds its colour. Textures between passes are rgba16float.

import type { StampStage } from '../models/stamp-stage.ts';
import { stampStageWgsl } from '../models/stamp-stage.ts';
import { STAMP_SRGB_WGSL, type StampPaintCompositor, type StampPaintTarget } from './stamp-paint-compositor.ts';
import { FULL_FRAME_WGSL } from './stamp-paint-gpu.ts';
import { stampUniformLayout } from './stamp-uniform-layout.ts';

/**
 * One direction of a gaussian: `axis` 0 across, 1 down; read within `read` (x, y, w, h), written over `box`, scaled by
 * `gain`. Boxes are in one space for both textures, whose first texels sit at `sourceAt` and `intoAt` in it. Past
 * `read` counts as clear, so whatever a target held outside a picture never reaches the result.
 */
export const STAMP_GAUSSIAN_PASS = stampUniformLayout('GaussianPass', [
  ['sigma', 'f32'], ['reach', 'u32'], ['axis', 'u32'], ['gain', 'f32'], ['read', 'vec4f'], ['box', 'vec4f'], ['sourceAt', 'vec2f'], ['intoAt', 'vec2f'],
]);

/**
 * WGSL for one direction of a gaussian over `layers` array layers of rgba16float (a plain texture viewed as an array
 * of one). Weights are normalised over every tap, read or not: paint fades into clear past its box, as a lens spreads
 * it.
 */
export function stampGaussianPassWgsl(layers: number, workgroup: number) {
  return /* wgsl */ `
${STAMP_GAUSSIAN_PASS.wgsl}
@group(0) @binding(0) var<uniform> u: GaussianPass;
@group(0) @binding(1) var source: texture_2d_array<f32>;
@group(0) @binding(2) var blurred: texture_storage_2d_array<rgba16float, write>;
@compute @workgroup_size(${workgroup}, ${workgroup}) fn gaussianPass(@builtin(global_invocation_id) id: vec3u) {
  if (any(vec2f(id.xy) >= u.box.zw)) { return; }
  let pixel = vec2i(u.box.xy) + vec2i(id.xy);
  let step = select(vec2i(1, 0), vec2i(0, 1), u.axis == 1u);
  let low = vec2i(u.read.xy);
  let high = low + vec2i(u.read.zw);
  let reach = i32(u.reach);
  var sum: array<vec4f, ${layers}>;
  var total = 0.0;
  for (var i = -reach; i <= reach; i++) {
    let w = exp(-0.5 * f32(i * i) / (u.sigma * u.sigma));
    total += w;
    let at = pixel + step * i;
    if (any(at < low) || any(at >= high)) { continue; }
    for (var l = 0u; l < ${layers}u; l++) { sum[l] += w * textureLoad(source, at - vec2i(u.sourceAt), l, 0); }
  }
  let into = pixel - vec2i(u.intoAt);
  for (var l = 0u; l < ${layers}u; l++) { textureStore(blurred, into, l, sum[l] * (u.gain / total)); }
}`;
}

/**
 * A glow's source over `origin` `extent`: the painting's linear light past `threshold` (by luminance, its hue kept),
 * times the cover there and `strength` (the glow's amount, the group's opacity and its visibility).
 */
export const STAMP_GLOW_SOURCE = stampUniformLayout('GlowSource', [['threshold', 'f32'], ['strength', 'f32'], ['glaze', 'u32'], ['origin', 'vec2u'], ['extent', 'vec2u']]);

/** Where a laid group's cover is read: its layer as laid still, or through its lattice's rest map. */
export type StampLaidGroupCover = 'group' | 'moved group';

const targetType = (target: StampPaintTarget) => (target.kind === 'array' ? 'texture_2d_array<f32>' : 'texture_2d<f32>');

/**
 * The glow source pass's WGSL for `compositor` on `stage`: binds its uniform (0), the painting (1), the plane's
 * emission, added to (2), the group's layer (3) and, for a moved group, its rest map (4), its cover then read
 * bilinearly at the rest point its lattice shows.
 */
export function stampGlowSourceWgsl(compositor: StampPaintCompositor, cover: StampLaidGroupCover, stage: StampStage, noRest: number, workgroup: number) {
  const { layer, painting } = compositor.targets;
  const firstLayer = (texel: string) => (layer.kind === 'array' ? `textureLoad(source, ${texel}, 0u, 0)` : `textureLoad(source, ${texel}, 0)`);
  // A rest map's value where no lattice covers a pixel: STAMP_NO_REST, halved as the group pass tests it.
  const coverAt = cover === 'group' ? `fn coverAt(pixel: vec2u) -> f32 { return groupCover(${firstLayer('pixel')}, u.glaze == 1u); }` : /* wgsl */ `
@group(0) @binding(4) var rest: texture_2d<f32>;
fn coverAt(pixel: vec2u) -> f32 {
  let q = textureLoad(rest, pixel, 0).xy - 0.5;
  if (q.x < ${noRest / 2}.0) { return 0.0; }
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
}`;
  return /* wgsl */ `
${stampStageWgsl(stage)}
${STAMP_SRGB_WGSL}
${STAMP_GLOW_SOURCE.wgsl}
@group(0) @binding(0) var<uniform> u: GlowSource;
@group(0) @binding(1) var painting: ${targetType(painting)};
@group(0) @binding(2) var emission: texture_storage_2d<rgba16float, read_write>;
@group(0) @binding(3) var source: ${targetType(layer)};
${compositor.output}
${compositor.group.cover}
${coverAt}
@compute @workgroup_size(${workgroup}, ${workgroup}) fn glowSource(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let covered = clamp(coverAt(pixel), 0.0, 1.0) * u.strength;
  if (covered <= 0.0) { return; }
  let c = linearLight(pixel);
  let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let light = c * (max(0.0, luma - u.threshold) / max(luma, 1e-4)) * covered;
  textureStore(emission, pixel, textureLoad(emission, pixel) + vec4f(light, 0.0));
}`;
}

/** A picture over `extent` texels, its first at stage texel `origin`. */
export const STAMP_PLANE_PICTURE = stampUniformLayout('PlanePicture', [['origin', 'vec2u'], ['extent', 'vec2u']]);

/** A picture's array layers: its colour, then its glaze when its plane is clear, then its emission when it glows. */
export function stampPlanePictureLayers(glazes: boolean, emits: boolean) {
  const glaze = glazes ? 1 : null;
  return { glaze, emission: emits ? 1 + Number(glazes) : null, count: 1 + Number(glazes) + Number(emits) };
}

/** The painting's linear light over `extent` stage texels from `origin`, written from the target's first texel into array layer `layer`. */
export const STAMP_PLANE_LIGHT = stampUniformLayout('PlaneLight', [['origin', 'vec2u'], ['extent', 'vec2u'], ['layer', 'u32']]);

/**
 * The light pass's WGSL: binds its uniform (0), the painting (1) and the target written (2), an array. It measures a
 * paper's own light and a clear plane's light on its paper, which the picture pass reads after the lay on black.
 */
export function stampPlaneLightWgsl(compositor: StampPaintCompositor, workgroup: number) {
  return /* wgsl */ `
${STAMP_SRGB_WGSL}
${STAMP_PLANE_LIGHT.wgsl}
@group(0) @binding(0) var<uniform> u: PlaneLight;
@group(0) @binding(1) var painting: ${targetType(compositor.targets.painting)};
@group(0) @binding(2) var light: texture_storage_2d_array<rgba16float, write>;
${compositor.output}
@compute @workgroup_size(${workgroup}, ${workgroup}) fn planeLight(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  textureStore(light, id.xy, u.layer, vec4f(linearLight(u.origin + id.xy), 1.0));
}`;
}

/**
 * The picture pass's WGSL: binds its uniform (0), the painting (1), its emission (2), the picture (3) and, for a clear
 * plane (`glazes`), its paper's light, stage-sized (4). A clear plane's painting is its lay on black; its picture
 * holds its light on paper (layer 0) and the black paper's (the glaze layer), read and replaced here.
 */
export function stampPlanePictureWgsl(compositor: StampPaintCompositor, glazes: boolean, emits: boolean, workgroup: number) {
  const layers = stampPlanePictureLayers(glazes, emits);
  // Light over backing b is C + T·b per channel, so the two lays give T = ΔL / Δpaper, and C what black leaves past
  // T·black. Where the papers' light barely differs, T is clamped rather than trusted.
  const clear = /* wgsl */ `
  let onPaper = textureLoad(picture, id.xy, 0u).rgb;
  let blackPaper = textureLoad(picture, id.xy, ${layers.glaze}u).rgb;
  let paper = textureLoad(paperLight, texel, 0).rgb;
  let through = clamp((onPaper - light) / max(paper - blackPaper, vec3f(1e-4)), vec3f(0.0), vec3f(1.0));
  textureStore(picture, id.xy, 0u, vec4f(max(light - through * blackPaper, vec3f(0.0)), 1.0 - (through.r + through.g + through.b) / 3.0));
  textureStore(picture, id.xy, ${layers.glaze}u, vec4f(1.0 - through, 0.0));`;
  return /* wgsl */ `
${STAMP_SRGB_WGSL}
${STAMP_PLANE_PICTURE.wgsl}
@group(0) @binding(0) var<uniform> u: PlanePicture;
@group(0) @binding(1) var painting: ${targetType(compositor.targets.painting)};
${emits ? '@group(0) @binding(2) var emission: texture_2d<f32>;' : ''}
@group(0) @binding(3) var picture: texture_storage_2d_array<rgba16float, ${glazes ? 'read_write' : 'write'}>;
${glazes ? '@group(0) @binding(4) var paperLight: texture_2d<f32>;' : ''}
${compositor.output}
@compute @workgroup_size(${workgroup}, ${workgroup}) fn planePicture(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let texel = u.origin + id.xy;
  let light = linearLight(texel);${glazes ? clear : `
  textureStore(picture, id.xy, 0u, vec4f(light, 1.0));`}${emits ? `
  // The glow source weighed each group's light by its cover already.
  textureStore(picture, id.xy, ${layers.emission}u, vec4f(textureLoad(emission, texel, 0).rgb, 0.0));` : ''}
}`;
}

/**
 * Where a frame shows a picture: `view` the plane's similarity to frame px (ma, mb, kx, ky: p ↦ (ma + i·mb)·p +
 * (kx + i·ky)); the picture's first texel's corner at plane point `origin`, `size` texels; `clipped`, clear past its
 * edge (a clear plane's), else its edge texels held (the back's, proved to reach past the frame).
 */
export const STAMP_PLANE_COMPOSITE = stampUniformLayout('PlaneComposite', [['view', 'vec4f'], ['origin', 'vec2f'], ['size', 'vec2f'], ['clipped', 'u32']]);

/**
 * How a picture is laid: `filter` multiplies what's behind, colour and emission, by what the picture lets through;
 * `add` adds its colour and emission. The two make `over` for a picture that doesn't glaze.
 */
export type StampPlaneLaying = 'filter' | 'add';

/**
 * The composite's WGSL, drawn twice a plane (`laying`) into the frame's colour (location 0) and, when `glowing`, its
 * emission (1): binds its uniform (0), the picture as an array (1) and a linear clamped sampler (2). Its layers are
 * stampPlanePictureLayers'; one with no glaze lets through what its alpha leaves.
 */
export function stampPlaneCompositeWgsl(glowing: boolean, glazes: boolean, emits: boolean, laying: StampPlaneLaying) {
  const layers = stampPlanePictureLayers(glazes, emits);
  const laid = {
    filter: `let through = ${glazes ? `1.0 - textureSampleLevel(picture, linearClamp, uv, ${layers.glaze}u, 0.0).rgb` : 'vec3f(1.0 - colour.a)'};
  return Laid(vec4f(through, 1.0 - colour.a)${glowing ? ', vec4f(through, 1.0 - colour.a)' : ''});`,
    add: `return Laid(colour${glowing ? `, vec4f(${emits ? `textureSampleLevel(picture, linearClamp, uv, ${layers.emission}u, 0.0).rgb` : 'vec3f(0.0)'}, 0.0)` : ''});`,
  }[laying];
  return /* wgsl */ `
${FULL_FRAME_WGSL}
${STAMP_PLANE_COMPOSITE.wgsl}
@group(0) @binding(0) var<uniform> u: PlaneComposite;
@group(0) @binding(1) var picture: texture_2d_array<f32>;
@group(0) @binding(2) var linearClamp: sampler;
struct Laid { @location(0) colour: vec4f${glowing ? ', @location(1) emission: vec4f' : ''} }
@fragment fn planeComposite(@builtin(position) at: vec4f) -> Laid {
  // The frame pixel's centre back through the view to the plane: q = m·p + k, so p = (q − k)·conj(m) / |m|².
  let m = u.view.xy;
  let d = at.xy - u.view.zw;
  let p = vec2f(d.x * m.x + d.y * m.y, d.y * m.x - d.x * m.y) / dot(m, m);
  var uv = (p - u.origin) / u.size;
  // Past a clipped picture's edge it's clear: nothing is laid there, by either laying.
  if (u.clipped == 1u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) { discard; }
  let colour = textureSampleLevel(picture, linearClamp, uv, 0u, 0.0);
  ${laid}
}`;
}

/**
 * The output's WGSL from the composite: its colour (0) and, when `glowing`, the emission bloomed (1), added in linear
 * light, encoded, and dithered into bytes when `dithered`.
 */
export function stampPlaneOutputWgsl(glowing: boolean, dithered: boolean) {
  return /* wgsl */ `
${FULL_FRAME_WGSL}
${STAMP_SRGB_WGSL}
@group(0) @binding(0) var colour: texture_2d<f32>;
${glowing ? '@group(0) @binding(1) var light: texture_2d<f32>;' : ''}
@fragment fn planeOutput(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let pixel = vec2u(at.xy);
  var linear = max(textureLoad(colour, pixel, 0).rgb, vec3f(0.0));${glowing ? `
  linear += max(textureLoad(light, pixel, 0).rgb, vec3f(0.0));` : ''}
  // An ordered dither, the same each frame, so a smooth flood doesn't band when the half floats become bytes.
  let dither = ${dithered ? '(fract(dot(vec2f(pixel), vec2f(0.7548776662, 0.5698402910))) - 0.5) / 255.0' : '0.0'};
  return vec4f(clamp(srgbEncoded(linear) + dither, vec3f(0.0), vec3f(1.0)), 1.0);
}`;
}
