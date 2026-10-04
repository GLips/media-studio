// shot-painted-texture-mips.ts: a painted texture's mip chain, so an object showing it far smaller than its size, or
// turned edge on, samples its paint averaged over what a pixel covers, not a scatter of texels that shimmers as the
// object moves. Each level is the one above downsampled through a tent twice a texel's footprint wide, in linear
// light: decoded, weighed, encoded again, as paintedThreeColorNode decodes every level. On an axis the texture wraps
// the tent's taps run round the seam, so a wrapped texture's smaller levels stay seamless; on one it doesn't, they're
// held at the edge.
//
// Negative space: no alpha. A painted texture is opaque, so its average needn't be premultiplied.

import { stampWrapsAcross, type StampWrap } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampBindGroup, type StampPaintDevice } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import { GPU_FULL_FRAME_WGSL, GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';

/** One texture's chain, readied: `encode` downsamples each level below its first from the one above, in order. */
export type ShotPaintedTextureMipChain = { readonly encode: (encoder: GPUCommandEncoder) => void };

// A texel below is the tent-weighted mean of the texels above within its reach, the level's scale either way (2, a
// little more where a side is odd, 1 where it's already 1): [1 3 3 1] / 8 a side at 2.
const SHOT_TEXTURE_MIP_WGSL = /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
${GPU_SRGB_WGSL}
override WRAP_X: bool;
override WRAP_Y: bool;
@group(0) @binding(0) var above: texture_2d<f32>;
fn texelAlong(j: i32, size: i32, wraps: bool) -> i32 {
  if (wraps) { return ((j % size) + size) % size; }
  return clamp(j, 0, size - 1);
}
fn tentAt(j: i32, centre: f32, reach: f32) -> f32 { return max(0.0, 1.0 - abs(f32(j) + 0.5 - centre) / reach); }
@fragment fn downsample(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(above));
  let reach = vec2f(size) / vec2f(max(vec2i(1), size / 2));
  let centre = at.xy * reach;
  let first = vec2i(floor(centre - reach));
  let last = vec2i(ceil(centre + reach));
  var sum = vec3f(0.0);
  var weights = 0.0;
  for (var y = first.y; y < last.y; y++) {
    let across = tentAt(y, centre.y, reach.y);
    for (var x = first.x; x < last.x; x++) {
      let weight = across * tentAt(x, centre.x, reach.x);
      sum += weight * srgbDecoded(textureLoad(above, vec2i(texelAlong(x, size.x, WRAP_X), texelAlong(y, size.y, WRAP_Y)), 0).rgb);
      weights += weight;
    }
  }
  return vec4f(srgbEncoded(sum / weights), 1.0);
}`;

/**
 * `texture`'s mip chain readied on `device`, sampling round each axis `wrap` names. Its module and pipelines come from
 * the device's caches (a painting owner's), so a chain readied for each texture shares them.
 */
export function shotPaintedTextureMipChain(device: StampPaintDevice, texture: GPUTexture, wrap: StampWrap | null): ShotPaintedTextureMipChain {
  const module = device.createShaderModule({ code: SHOT_TEXTURE_MIP_WGSL });
  const constants = { WRAP_X: stampWrapsAcross(wrap, 'x') ? 1 : 0, WRAP_Y: stampWrapsAcross(wrap, 'y') ? 1 : 0 };
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, constants, targets: [{ format: texture.format }] } });
  const level = (baseMipLevel: number) => texture.createView({ baseMipLevel, mipLevelCount: 1 });
  // A level is drawn while the one above is read: two subresources of one texture, which a pass may hold apart.
  const below = Array.from({ length: texture.mipLevelCount - 1 }, (_, l) => ({ view: level(l + 1), above: stampBindGroup(device, pipeline, [level(l)]) }));
  return {
    encode: (encoder) => {
      for (const { view, above } of below) {
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, above);
        pass.draw(3);
        pass.end();
      }
    },
  };
}
