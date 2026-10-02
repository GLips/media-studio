// gpu-gaussian.ts: the studio's one separable gaussian, a compute pass per direction over array layers of
// rgba16float. Its weights are exp(−½·i²/σ²) over `reach` taps each side, normalised over every tap. How it reads is
// the caller's: whole texels, clear past a box (a lens spreading a picture into the clear around it), or bilinear
// with held edges, any number of source texels a tap (a mask's edge, read at half size).

import { gpuUniformLayout } from './gpu-uniform-layout.ts';

/**
 * One direction of a gaussian: `axis` 0 across, 1 down; `reach` taps each side; written over `box`. Reading
 * `texels`: read within `read`, boxes in one space whose first texels sit at `sourceAt` (source) and `intoAt` (the
 * result). Reading `bilinear`: `stride` source texels a tap, `read`, `sourceAt` and `intoAt` unused.
 */
export const GPU_GAUSSIAN_PASS = gpuUniformLayout('GaussianPass', [
  ['sigma', 'f32'], ['reach', 'u32'], ['axis', 'u32'], ['stride', 'f32'], ['read', 'vec4f'], ['box', 'vec4f'], ['sourceAt', 'vec2f'], ['intoAt', 'vec2f'],
]);

/**
 * How a pass reads its source. `texels`: whole texels, past `read` clear, so a picture fades into clear past its box.
 * `bilinear`: through the sampler bound at 3 (clamping), from the result texel's centre scaled to the source, so a
 * source twice the result's size is box-filtered as it's read.
 */
export type GpuGaussianRead = 'texels' | 'bilinear';

/**
 * WGSL for one direction over `layers` array layers (a plain texture viewed as an array of one): binds its uniform
 * (0), the source (1), the result, storage (2), and for `bilinear`, a clamping sampler (3).
 */
export function gpuGaussianPassWgsl({ layers, read, workgroup }: { layers: number; read: GpuGaussianRead; workgroup: number }) {
  const texels = read === 'texels';
  const tap = texels ? /* wgsl */ `
    let at = pixel + step * i;
    if (any(at < low) || any(at >= high)) { continue; }
    for (var l = 0u; l < ${layers}u; l++) { sum[l] += textureLoad(source, at - vec2i(u.sourceAt), l, 0) * w; }` : /* wgsl */ `
    for (var l = 0u; l < ${layers}u; l++) { sum[l] += textureSampleLevel(source, linearClamp, uv + stride * f32(i), l, 0.0) * w; }`;
  const setup = texels ? /* wgsl */ `
  let low = vec2i(u.read.xy);
  let high = low + vec2i(u.read.zw);` : /* wgsl */ `
  let uv = (vec2f(pixel) + 0.5) / vec2f(textureDimensions(blurred));
  let stride = vec2f(step) * u.stride / vec2f(textureDimensions(source));`;
  return /* wgsl */ `
${GPU_GAUSSIAN_PASS.wgsl}
@group(0) @binding(0) var<uniform> u: GaussianPass;
@group(0) @binding(1) var source: texture_2d_array<f32>;
@group(0) @binding(2) var blurred: texture_storage_2d_array<rgba16float, write>;
${texels ? '' : '@group(0) @binding(3) var linearClamp: sampler;'}
@compute @workgroup_size(${workgroup}, ${workgroup}) fn gaussianPass(@builtin(global_invocation_id) id: vec3u) {
  if (any(vec2f(id.xy) >= u.box.zw)) { return; }
  let pixel = vec2i(u.box.xy) + vec2i(id.xy);
  ${texels ? '' : 'if (any(vec2u(pixel) >= textureDimensions(blurred))) { return; }'}
  let step = select(vec2i(1, 0), vec2i(0, 1), u.axis == 1u);${setup}
  let reach = i32(u.reach);
  var sum: array<vec4f, ${layers}>;
  var total = 0.0;
  for (var i = -reach; i <= reach; i++) {
    let w = exp(-0.5 * f32(i * i) / (u.sigma * u.sigma));
    total += w;${tap}
  }
  let into = pixel - vec2i(u.intoAt);
  for (var l = 0u; l < ${layers}u; l++) { textureStore(blurred, into, l, sum[l] / total); }
}`;
}
