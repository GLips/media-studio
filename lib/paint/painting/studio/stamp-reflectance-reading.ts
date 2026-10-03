// stamp-reflectance-reading.ts: a spectral reflectance that reads as a given linear colour, for the pigment
// compositor's pictures (layPicture). Its includer declares BAND_VEC4S and the bands' TO_R, TO_G and TO_B readings.

/**
 * The most corrections a reading takes: each that doesn't finish holds a band more at its bound, and 8 bands matching
 * 3 channels run out by the 6th.
 */
const STAMP_REFLECTANCE_STEPS = 8;

/**
 * `reflectanceReading(light, near)`: `near` moved toward reading as `light` by the least change, bands pushed past 0..1
 * held at their bound and the rest moved again (an active set), exact for any colour a reflectance can read as.
 * paperReflectance's one-step clamp leaves dark paint far paler (ΔE 30-45 for near-black on cream paper).
 */
export const STAMP_REFLECTANCE_READING_WGSL = /* wgsl */ `
fn reflectanceReading(light: vec3f, near: array<vec4f, BAND_VEC4S>) -> array<vec4f, BAND_VEC4S> {
  var R = near;
  var free: array<vec4f, BAND_VEC4S>;
  for (var i = 0u; i < BAND_VEC4S; i++) { free[i] = vec4f(1.0); }
  for (var step = 0u; step < ${STAMP_REFLECTANCE_STEPS}u; step++) {
    var now = vec3f(0.0);
    var c0 = vec3f(0.0);
    var c1 = vec3f(0.0);
    var c2 = vec3f(0.0);
    for (var i = 0u; i < BAND_VEC4S; i++) {
      now += vec3f(dot(TO_R[i], R[i]), dot(TO_G[i], R[i]), dot(TO_B[i], R[i]));
      let r = TO_R[i] * free[i];
      let g = TO_G[i] * free[i];
      let b = TO_B[i] * free[i];
      c0 += vec3f(dot(r, TO_R[i]), dot(r, TO_G[i]), dot(r, TO_B[i]));
      c1 += vec3f(dot(g, TO_R[i]), dot(g, TO_G[i]), dot(g, TO_B[i]));
      c2 += vec3f(dot(b, TO_R[i]), dot(b, TO_G[i]), dot(b, TO_B[i]));
    }
    let off = light - now;
    let det = dot(c0, cross(c1, c2));
    if (abs(det) <= 1e-9 || all(abs(off) <= vec3f(1e-5))) { break; }
    // The free bands' Gram matrix inverted by its adjugate (symmetric, so its rows are its columns' crosses).
    let lambda = vec3f(dot(cross(c1, c2), off), dot(cross(c2, c0), off), dot(cross(c0, c1), off)) / det;
    for (var i = 0u; i < BAND_VEC4S; i++) {
      let moved = R[i] + free[i] * (TO_R[i] * lambda.x + TO_G[i] * lambda.y + TO_B[i] * lambda.z);
      let held = clamp(moved, vec4f(0.001), vec4f(0.999));
      free[i] = select(vec4f(0.0), free[i], held == moved);
      R[i] = held;
    }
  }
  return R;
}`;
