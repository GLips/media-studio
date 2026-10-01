// stamp-outside-layer-lay.ts: the renderer's pass laying an outside layer (models/stamp-outside-layer.ts) over the
// painting: its texture read texel for texel over the stage, scaled by its visibility, and handed to the compositor's
// `layOutside`, which lays linear light over flat colour or lifts it into a pigment painting's bands.
//
// Negative space: the texture is whoever rendered it's to fill and keep; the renderer never writes or destroys it,
// and reads it only within the frame it's laid in, so an outside layer can't make a frame depend on an earlier one.

import type { StampOutsideLayerSlot } from '../models/stamp-outside-layer.ts';
import type { StampStage } from '../models/stamp-stage.ts';
import type { StampPaintCompositor } from './stamp-paint-compositor.ts';
import { stampUniformLayout } from './stamp-uniform-layout.ts';

/** An outside layer as a renderer is made with: its slot, and the texture its pixels arrive in each frame. */
export type StampOutsideLayer = StampOutsideLayerSlot & { texture: GPUTexture };

/** Float formats an outside layer may arrive in: linear light in 8 bits would band in the dark. */
const STAMP_OUTSIDE_LAYER_FORMATS: ReadonlySet<GPUTextureFormat> = new Set(['rgba16float', 'rgba32float']);

/** Throws unless `layer`'s texture is one the lay pass reads whole: one 2D float image, sampled, `stage`'s size (frame and margin). */
export function checkStampOutsideLayerTexture({ id, texture }: StampOutsideLayer, { width, height, margin }: StampStage) {
  if (!(texture.usage & GPUTextureUsage.TEXTURE_BINDING)) throw new Error(`stamp paint: outside layer ${id}'s texture needs TEXTURE_BINDING usage`);
  if (!STAMP_OUTSIDE_LAYER_FORMATS.has(texture.format)) throw new Error(`stamp paint: outside layer ${id} arrives in ${[...STAMP_OUTSIDE_LAYER_FORMATS].join(' or ')}, not ${texture.format}`);
  if (texture.dimension !== '2d' || texture.depthOrArrayLayers !== 1 || texture.sampleCount !== 1) throw new Error(`stamp paint: outside layer ${id} arrives as one single-sampled 2D image`);
  if (texture.width !== width || texture.height !== height) throw new Error(`stamp paint: outside layer ${id} is ${texture.width} × ${texture.height}, and the stage ${width} × ${height} (a ${margin} px margin each side)`);
}

export const STAMP_OUTSIDE_LAY = stampUniformLayout('OutsideLay', [['visibility', 'f32']]);

/**
 * The lay pass's WGSL for `compositor`, `paintingDeclaration` declaring its painting at binding 2 for read_write.
 * Light past white, or colour past its alpha, is held to them: the painting shows reflectance, which no light exceeds.
 */
export function stampOutsideLayWgsl(compositor: StampPaintCompositor, paintingDeclaration: string, workgroup: number) {
  return /* wgsl */ `
${STAMP_OUTSIDE_LAY.wgsl}
@group(0) @binding(0) var<uniform> u: OutsideLay;
@group(0) @binding(1) var outside: texture_2d<f32>;
${paintingDeclaration}
${compositor.outside}
@compute @workgroup_size(${workgroup}, ${workgroup}) fn layOutsideLayer(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(outside))) { return; }
  let rendered = textureLoad(outside, id.xy, 0);
  let alpha = clamp(rendered.a, 0.0, 1.0);
  let over = vec4f(clamp(rendered.rgb, vec3f(0.0), vec3f(alpha)), alpha) * u.visibility;
  if (over.a <= 0.0 && all(over.rgb <= vec3f(0.0))) { return; }
  layOutside(id.xy, over);
}`;
}
