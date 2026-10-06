// gpu-wgsl.ts: WGSL pieces every studio pass that assembles its own shader may declare: sRGB's transfer and a
// full-frame vertex stage, each declared once per module that uses it; and a number written in as an f32 literal.

/** `value` as a WGSL f32 literal, to the precision an f32 holds. */
export const gpuWgslFloat = (value: number) => value.toPrecision(9);

/** sRGB's transfer, both ways: srgbDecoded and srgbEncoded, on linear light per channel. */
export const GPU_SRGB_WGSL = /* wgsl */ `
fn srgbDecoded(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
fn srgbEncoded(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }`;

/** Covers the target with one triangle, no buffers: a fragment pass reads its pixel from its position. */
export const GPU_FULL_FRAME_WGSL = /* wgsl */ `
@vertex fn fullFrame(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let corner = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
}`;
