// lens-defocus-passes.ts: the lens's defocus passes on the GPU, a picture blurred where it's out of focus, each
// texel by its own sigma: at its own distance (three sources), or across a plane at one distance under a tilted focus.

import { gpuUniformLayout } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { LENS_DEFOCUS_LEAST, LENS_GAUSSIAN_SIGMAS } from '../models/lens-focus.ts';

const LENS_DEFOCUS_LEAST_WGSL = LENS_DEFOCUS_LEAST.toFixed(3);

/**
 * A gaussian's taps as the defocus passes weigh them: erf, reachOf(sigma), kernelSum(sigma) and spread(i, sigma, sum),
 * the gaussian of sigma at offset i over its kernel's sum, so light is spread, never gained or lost; a sharp one keeps
 * its light to itself.
 */
const LENS_GAUSSIAN_TAPS_WGSL = /* wgsl */ `
// Abramowitz and Stegun 7.1.26, within 1.5e-7.
fn erf(x: f32) -> f32 {
  let t = 1.0 / (1.0 + 0.3275911 * x);
  return 1.0 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * exp(-x * x);
}
fn reachOf(sigma: f32) -> i32 { return i32(ceil(${LENS_GAUSSIAN_SIGMAS} * sigma)); }
fn kernelSum(sigma: f32) -> f32 {
  if (sigma < ${LENS_DEFOCUS_LEAST_WGSL}) { return 1.0; }
  let reach = reachOf(sigma);
  if (sigma >= 2.0) { return sigma * 2.5066283 * erf((f32(reach) + 0.5) / (sigma * 1.4142135)); }
  var sum = 0.0;
  for (var k = -reach; k <= reach; k++) { sum += exp(-0.5 * f32(k * k) / (sigma * sigma)); }
  return sum;
}
fn spread(i: i32, sigma: f32, sum: f32) -> f32 {
  if (sigma < ${LENS_DEFOCUS_LEAST_WGSL}) { return select(0.0, 1.0, i == 0); }
  if (abs(i) > reachOf(sigma)) { return 0.0; }
  return exp(-0.5 * f32(i * i) / (sigma * sigma)) / sum;
}`;

/**
 * One direction of a defocus whose sigma varies across a picture at one distance, a plane's under a tilted focus:
 * written over `box`, read within `read`, boxes in one space whose first texels sit at `sourceAt` (source) and `intoAt`
 * (the result), as the gaussian's (gpu-gaussian.ts). A texel's sigma at its centre c is |sigma·(c, 1)|, in that space.
 */
export const LENS_DEFOCUS_ACROSS = gpuUniformLayout('LensDefocusAcross', [
  ['sigma', 'vec4f'], ['read', 'vec4f'], ['box', 'vec4f'], ['sourceAt', 'vec2f'], ['intoAt', 'vec2f'], ['axis', 'u32'],
]);

/**
 * The defocus across a picture, for `layers` array layers: binds its uniform (0), the source (1) and the result,
 * storage (2). Each texel gathers its own gaussian: at one distance nothing stands in front, so the depth-aware
 * defocus's weighing reduces to this, over every layer a painted picture holds.
 */
export function lensDefocusAcrossWgsl({ layers, workgroup }: { layers: number; workgroup: number }) {
  return /* wgsl */ `
${LENS_DEFOCUS_ACROSS.wgsl}
@group(0) @binding(0) var<uniform> u: LensDefocusAcross;
@group(0) @binding(1) var source: texture_2d_array<f32>;
@group(0) @binding(2) var defocused: texture_storage_2d_array<rgba16float, write>;
${LENS_GAUSSIAN_TAPS_WGSL}
@compute @workgroup_size(${workgroup}, ${workgroup}) fn lensDefocusAcross(@builtin(global_invocation_id) id: vec3u) {
  if (any(vec2f(id.xy) >= u.box.zw)) { return; }
  let pixel = vec2i(u.box.xy) + vec2i(id.xy);
  let step = select(vec2i(1, 0), vec2i(0, 1), u.axis == 1u);
  let low = vec2i(u.read.xy);
  let high = low + vec2i(u.read.zw);
  let sigma = abs(dot(u.sigma.xyz, vec3f(vec2f(pixel) + 0.5, 1.0)));
  let sum = kernelSum(sigma);
  let reach = select(reachOf(sigma), 0, sigma < ${LENS_DEFOCUS_LEAST_WGSL});
  var gathered: array<vec4f, ${layers}>;
  for (var i = -reach; i <= reach; i++) {
    let at = pixel + step * i;
    if (any(at < low) || any(at >= high)) { continue; }
    let w = spread(i, sigma, sum);
    for (var l = 0u; l < ${layers}u; l++) { gathered[l] += textureLoad(source, at - vec2i(u.sourceAt), l, 0) * w; }
  }
  let into = pixel - vec2i(u.intoAt);
  for (var l = 0u; l < ${layers}u; l++) { textureStore(defocused, into, l, gathered[l]); }
}`;
}

/**
 * One direction of a per-pixel defocus over `size` texels: `axis` 0 across, 1 down, `reach` taps each side. A texel's
 * sigma at its centre c and distance d is |lean·(c, 1) − focus/d|, held to `most`: `lean` the lens's aperture times
 * its lean across the texels (lens-focus.ts), `focus` the aperture times the focus.
 */
export const LENS_DEFOCUS = gpuUniformLayout('LensDefocus', [['lean', 'vec4f'], ['size', 'vec2f'], ['focus', 'f32'], ['most', 'f32'], ['axis', 'u32'], ['reach', 'u32']]);

// A tap stands in front of a texel when it's nearer by more than this share of the texel's distance: a surface's own
// curve and a slope's next texels stay one surface.
const LENS_DEFOCUS_NEARER = 0.05;

/**
 * A per-pixel defocus over a two-layer picture, colour (0) and motion (1, its distance setting the sigma): binds the
 * uniform (0), source (1) and storage result (2). Depth-aware: a nearer texel spreads its blur over what's behind;
 * one at or behind reaches a texel only by the narrower blur, so a soft background stays off a sharp edge.
 */
export function lensDefocusWgsl(workgroup: number) {
  return /* wgsl */ `
${LENS_DEFOCUS.wgsl}
@group(0) @binding(0) var<uniform> u: LensDefocus;
@group(0) @binding(1) var source: texture_2d_array<f32>;
@group(0) @binding(2) var defocused: texture_storage_2d_array<rgba16float, write>;
fn sigmaOf(at: vec2i, motion: vec4f) -> f32 {
  if (motion.w < 1e-4) { return 0.0; }
  return min(u.most, abs(dot(u.lean.xyz, vec3f(vec2f(at) + 0.5, 1.0)) - u.focus / max(motion.z / motion.w, 1e-4)));
}
// A clear texel is farther than anything: whatever covers it stands in front.
fn distanceOf(motion: vec4f) -> f32 {
  return select(motion.z / motion.w, 1e30, motion.w < 1e-4);
}
${LENS_GAUSSIAN_TAPS_WGSL}
@compute @workgroup_size(${workgroup}, ${workgroup}) fn lensDefocus(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(u.size);
  let pixel = vec2i(id.xy);
  if (any(pixel >= size)) { return; }
  let step = select(vec2i(1, 0), vec2i(0, 1), u.axis == 1u);
  let own = textureLoad(source, pixel, 1, 0);
  let ownSigma = sigmaOf(pixel, own);
  let ownSum = kernelSum(ownSigma);
  let infront = distanceOf(own) * ${(1 - LENS_DEFOCUS_NEARER).toFixed(3)};
  var nearColour = vec4f(0.0);
  var nearMotion = vec4f(0.0);
  var seenColour = vec4f(0.0);
  var seenMotion = vec4f(0.0);
  var seen = 0.0;
  var hidden = 0.0;
  for (var i = -i32(u.reach); i <= i32(u.reach); i++) {
    let at = pixel + step * i;
    if (any(at < vec2i(0)) || any(at >= size)) { continue; }
    let tapMotion = textureLoad(source, at, 1, 0);
    let tapSigma = sigmaOf(at, tapMotion);
    let ownWeight = spread(i, ownSigma, ownSum);
    if (distanceOf(tapMotion) < infront) {
      // A tap hides only as much as it covers: a blurred edge's faint sliver, its distance read off a tiny cover, hides little.
      hidden += ownWeight * min(tapMotion.w, 1.0);
      let w = spread(i, tapSigma, kernelSum(tapSigma));
      if (w == 0.0) { continue; }
      nearColour += textureLoad(source, at, 0, 0) * w;
      nearMotion += tapMotion * w;
    } else {
      // Seen on this texel's own kernel, clear taps too, so the fill below can't stretch a silhouette's cover.
      seen += ownWeight;
      let sigma = min(tapSigma, ownSigma);
      let w = spread(i, sigma, select(kernelSum(sigma), ownSum, sigma == ownSigma));
      if (w == 0.0) { continue; }
      seenColour += textureLoad(source, at, 0, 0) * w;
      seenMotion += tapMotion * w;
    }
  }
  // What nearer texels hide of this one's blur is filled from what it still sees: else a sharp edge beside a blurred
  // one passes full cover on one side and falls short on the other, a dark fringe once composited. It sees itself.
  let under = (1.0 - min(nearColour.a, 1.0)) * (seen + hidden) / seen;
  let colour = nearColour + seenColour * under;
  // Near texels' blurs overlapping can still pass full cover: what's laid is scaled back to it.
  let over = max(1.0, colour.a);
  textureStore(defocused, pixel, 0, colour / over);
  textureStore(defocused, pixel, 1, (nearMotion + seenMotion * under) / over);
}`;
}
