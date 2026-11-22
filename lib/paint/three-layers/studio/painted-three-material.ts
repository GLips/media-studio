// painted-three-material.ts: what a three.js scene in a painted scene builds its materials with: a painted texture's
// colour as a material reads it.
//
// A stamp renderer hands over its output as a screen shows it, gamma-encoded, in a half-float texture. three's WebGPU
// backend decodes sRGB only for an -srgb format and ignores an ExternalTexture's colorSpace (vid-129's finding), so
// the decoding is written into the node here.

import { mix, step, texture, uv, vec3, vec4 } from 'three/tsl';
import type { ExternalTexture, Node } from 'three/webgpu';

/**
 * `painted`'s colour in linear light, opaque, as a material's colorNode, read at `at`: the painting's top left (0, 0)
 * to its bottom right (1, 1); the mesh's uv, v up the mesh, when left out. sRGB's decoding is written out:
 * @types/three types three's own (sRGBTransferEOTF) as returning a bare Node, which colorNode refuses.
 */
export function paintedThreeColorNode(painted: ExternalTexture, at: Node<'vec2'> = uv().flipY()) {
  const { rgb } = texture(painted, at);
  return vec4(mix(rgb.add(0.055).div(1.055).pow(vec3(2.4)), rgb.div(12.92), step(rgb, vec3(0.04045))), 1);
}
