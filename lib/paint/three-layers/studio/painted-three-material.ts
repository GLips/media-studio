// painted-three-material.ts: what a three.js scene in a painted scene builds its materials with: a painted texture's
// colour as a material reads it.
//
// A stamp renderer hands over its output as a screen shows it, gamma-encoded, in a half-float texture. three's WebGPU
// backend decodes sRGB only for an -srgb format and ignores an ExternalTexture's colorSpace (vid-129's finding), so
// the decoding is written into the node here.

import { mix, step, texture, uv, vec3, vec4 } from 'three/tsl';
import type { ExternalTexture } from 'three/webgpu';

/**
 * `painted`'s colour in linear light, opaque, as a material's colorNode: its rows run down the painting and v up the
 * mesh, so (0, 0) in uv is the painting's bottom left. sRGB's decoding is written out: @types/three types three's
 * own (sRGBTransferEOTF) as returning a bare Node, which colorNode refuses.
 */
export function paintedThreeColorNode(painted: ExternalTexture) {
  const { rgb } = texture(painted, uv().flipY());
  return vec4(mix(rgb.add(0.055).div(1.055).pow(vec3(2.4)), rgb.div(12.92), step(rgb, vec3(0.04045))), 1);
}
