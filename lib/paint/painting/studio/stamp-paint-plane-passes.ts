// stamp-paint-plane-passes.ts: the renderer's passes from a plane's paint to its picture (stamp-plane.ts): its colour,
// premultiplied; a clear plane's taken share; its emission. The lens (lens-compositor.ts) defocuses each picture,
// lays it over the planes behind where the camera puts it, blooms the emission once, and encodes.
//
// A nearer plane is clear film, measured on white and on black and taken as C + T·b per RGB channel over backing b:
// exact over those two. Pigment's KM, R + T²·b/(1 − R·b) per spectral band, isn't that, so over other paint it's a
// two-point linearisation: a semi-opaque film over a mid-tone comes out a little light, a strongly coloured glaze over
// coloured paint far lighter (gate case planes/one-sheet). Passes hand on rgba16float.

import type { StampStage } from '../models/stamp-stage.ts';
import { stampStageWgsl } from '../models/stamp-stage.ts';
import { type StampPaintCompositor, type StampPaintTarget } from './stamp-paint-compositor.ts';
import { gpuUniformLayout } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';

/**
 * A glow's source over `origin` `extent`: the painting's linear light past `threshold` (by luminance, its hue kept),
 * times the cover there and `strength` (the glow's amount, the group's opacity and its visibility).
 */
export const STAMP_GLOW_SOURCE = gpuUniformLayout('GlowSource', [['threshold', 'f32'], ['strength', 'f32'], ['glaze', 'u32'], ['origin', 'vec2u'], ['extent', 'vec2u']]);

/** An opaque group's cover over `origin` `extent`, times `strength` (its opacity and visibility), taken out of the plane's emission. */
export const STAMP_GLOW_OCCLUSION = gpuUniformLayout('GlowOcclusion', [['strength', 'f32'], ['origin', 'vec2u'], ['extent', 'vec2u']]);

/** Where a laid group's cover is read: its layer as laid still, or through its lattice's rest map. */
export type StampLaidGroupCover = 'group' | 'moved group';

const targetType = (target: StampPaintTarget) => (target.kind === 'array' ? 'texture_2d_array<f32>' : 'texture_2d<f32>');

/**
 * `coverAt(pixel)`, a laid group's cover as `glaze` (WGSL) says it's composited: its layer bound at 3 and, for a moved
 * group, its rest map at 4, its cover then read bilinearly at the rest point its lattice shows. A glow and a shot's
 * coverage for alphaOf masks read it alike.
 */
export function stampLaidCoverWgsl(compositor: StampPaintCompositor, cover: StampLaidGroupCover, noRest: number, glaze: string) {
  const { layer } = compositor.targets;
  const firstLayer = (texel: string) => (layer.kind === 'array' ? `textureLoad(source, ${texel}, 0u, 0)` : `textureLoad(source, ${texel}, 0)`);
  // A rest map's value where no lattice covers a pixel: STAMP_NO_REST, halved as the group pass tests it.
  const coverAt = cover === 'group' ? `fn coverAt(pixel: vec2u) -> f32 { return groupCover(${firstLayer('pixel')}, ${glaze}); }` : /* wgsl */ `
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
    covered += w * groupCover(${firstLayer('vec2u(tap)')}, ${glaze});
  }
  return covered;
}`;
  return /* wgsl */ `
@group(0) @binding(3) var source: ${targetType(layer)};
${compositor.group.cover}
${coverAt}`;
}

/**
 * The glow source pass's WGSL for `compositor` on `stage`: binds its uniform (0), the painting (1), the plane's
 * emission, added to (2), and the group's cover (stampLaidCoverWgsl).
 */
export function stampGlowSourceWgsl(compositor: StampPaintCompositor, cover: StampLaidGroupCover, stage: StampStage, noRest: number, workgroup: number) {
  return /* wgsl */ `
${stampStageWgsl(stage)}
${GPU_SRGB_WGSL}
${STAMP_GLOW_SOURCE.wgsl}
@group(0) @binding(0) var<uniform> u: GlowSource;
@group(0) @binding(1) var painting: ${targetType(compositor.targets.painting)};
@group(0) @binding(2) var emission: texture_storage_2d<rgba16float, read_write>;
${compositor.output}
${stampLaidCoverWgsl(compositor, cover, noRest, 'u.glaze == 1u')}
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

/**
 * The glow occlusion pass's WGSL: binds its uniform (0), the plane's emission, scaled (2), and the group's cover
 * (stampLaidCoverWgsl). Emission so far on a plane dims by what a later opaque group lays over it, as its light does.
 */
export function stampGlowOcclusionWgsl(compositor: StampPaintCompositor, cover: StampLaidGroupCover, stage: StampStage, noRest: number, workgroup: number) {
  return /* wgsl */ `
${stampStageWgsl(stage)}
${STAMP_GLOW_OCCLUSION.wgsl}
@group(0) @binding(0) var<uniform> u: GlowOcclusion;
@group(0) @binding(2) var emission: texture_storage_2d<rgba16float, read_write>;
${stampLaidCoverWgsl(compositor, cover, noRest, 'false')}
@compute @workgroup_size(${workgroup}, ${workgroup}) fn glowOcclusion(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let covered = clamp(coverAt(pixel), 0.0, 1.0) * u.strength;
  if (covered <= 0.0) { return; }
  textureStore(emission, pixel, textureLoad(emission, pixel) * (1.0 - covered));
}`;
}

/** A picture over `extent` texels, its first at stage texel `origin`, all it holds faded by `visibility` 0..1. */
export const STAMP_PLANE_PICTURE = gpuUniformLayout('PlanePicture', [['origin', 'vec2u'], ['extent', 'vec2u'], ['visibility', 'f32']]);

/**
 * A picture's array layers (lens-passes.ts): its colour (0), premultiplied, then for `film` (a clear plane's) its
 * taken share (1 − what it lets through, per channel), then its emission when it glows, then its groups' own motion
 * when one travels over the shutter. A `paper` picture is laid over by its alpha, as a three render is.
 */
export type StampPlanePictureLayers =
  | { readonly kind: 'paper'; readonly taken: null; readonly emission: number | null; readonly motion: number | null }
  | { readonly kind: 'film'; readonly taken: 1; readonly emission: number | null; readonly motion: number | null };

export function stampPlanePictureLayers(kind: StampPlanePictureLayers['kind'], { emits, travels }: { emits: boolean; travels: boolean }): StampPlanePictureLayers {
  const emission = kind === 'film' ? 2 : 1, motion = emission + Number(emits);
  const extra = { emission: emits ? emission : null, motion: travels ? motion : null };
  return kind === 'film' ? { kind, taken: 1, ...extra } : { kind, taken: null, ...extra };
}

export const stampPlanePictureLayerCount = (layers: StampPlanePictureLayers) => 1 + Number(layers.kind === 'film') + Number(layers.emission !== null) + Number(layers.motion !== null);

/** A pipeline key naming `layers`' shape. */
export const stampPlanePictureLayersKey = (layers: StampPlanePictureLayers) => `${layers.kind}|${layers.emission !== null}|${layers.motion !== null}`;

/** The painting's linear light over `extent` stage texels from `origin`, written from the target's first texel into array layer `layer`. */
export const STAMP_PLANE_LIGHT = gpuUniformLayout('PlaneLight', [['origin', 'vec2u'], ['extent', 'vec2u'], ['layer', 'u32']]);

/**
 * The light pass's WGSL: binds its uniform (0), the painting (1) and the target written (2), an array. It measures the
 * measuring backings' own light, and a clear plane's light on white, which the picture pass reads after the lay on black.
 */
export function stampPlaneLightWgsl(compositor: StampPaintCompositor, workgroup: number) {
  return /* wgsl */ `
${GPU_SRGB_WGSL}
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
 * The picture pass's WGSL: binds its uniform (0), the painting (1), its emission (2), the picture (3), for a film the
 * backings' light (4: white's at layer 0, black's at 1), and its groups' motion (5). A film's painting is its lay on
 * black, its colour layer its light on white; its alpha 1 − luminance(T), for a canvas over HTML.
 */
export function stampPlanePictureWgsl(compositor: StampPaintCompositor, layers: StampPlanePictureLayers, workgroup: number) {
  // Light over backing b taken as C + T·b per channel: the two lays give T = ΔL / Δbacking, and C what black leaves
  // past T·black. Faded by v, it's v·C + (1 − v·(1 − T))·b: every layer scales by v.
  const film = layers.kind === 'film' && /* wgsl */ `
  let onWhite = textureLoad(picture, id.xy, 0u).rgb;
  let white = textureLoad(backingLight, vec2u(0u), 0u, 0).rgb;
  let black = textureLoad(backingLight, vec2u(0u), 1u, 0).rgb;
  let through = clamp((onWhite - light) / (white - black), vec3f(0.0), vec3f(1.0));
  let kept = 1.0 - dot(through, vec3f(0.2126, 0.7152, 0.0722));
  textureStore(picture, id.xy, 0u, vec4f(max(light - through * black, vec3f(0.0)), kept) * u.visibility);
  textureStore(picture, id.xy, ${layers.taken}u, vec4f(1.0 - through, 0.0) * u.visibility);`;
  return /* wgsl */ `
${GPU_SRGB_WGSL}
${STAMP_PLANE_PICTURE.wgsl}
@group(0) @binding(0) var<uniform> u: PlanePicture;
@group(0) @binding(1) var painting: ${targetType(compositor.targets.painting)};
${layers.emission !== null ? '@group(0) @binding(2) var emission: texture_2d<f32>;' : ''}
@group(0) @binding(3) var picture: texture_storage_2d_array<rgba16float, ${film ? 'read_write' : 'write'}>;
${film ? '@group(0) @binding(4) var backingLight: texture_2d_array<f32>;' : ''}
${layers.motion !== null ? '@group(0) @binding(5) var motion: texture_2d<f32>;' : ''}
${compositor.output}
@compute @workgroup_size(${workgroup}, ${workgroup}) fn planePicture(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let texel = u.origin + id.xy;
  let light = linearLight(texel);${film || `
  textureStore(picture, id.xy, 0u, vec4f(light, 1.0) * u.visibility);`}${layers.emission !== null ? `
  // The glow source weighed each group's light by its cover already.
  textureStore(picture, id.xy, ${layers.emission}u, vec4f(textureLoad(emission, texel, 0).rgb, 0.0) * u.visibility);` : ''}${layers.motion !== null ? `
  // Motion is premultiplied by its cover, which fades with the rest.
  textureStore(picture, id.xy, ${layers.motion}u, textureLoad(motion, texel, 0) * u.visibility);` : ''}
}`;
}
