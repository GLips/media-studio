// stamp-rest-map.ts: where posed paint was planned (ENGINE 5.3). A pose maps a sheet's marks before painting; what
// travels with the paint (its fields, a ragged edge's noise, a stamp's tip noise, a flood's local scale, pigment
// clumps) is read at the rest point a map takes each paper point back to. The paper's grain and absorbency are the
// paper's, read where they lie.

/**
 * A similarity taking a paper point back to where it was planned, p ↦ (ma + i·mb)·p + (kx + i·ky), as the words
 * [ma, mb, kx, ky] a pass reads (stampPlacementInverseWords' form).
 */
export type StampRestMap = readonly [number, number, number, number];

/** Paint lying where it was planned. */
export const STAMP_REST_IDENTITY: StampRestMap = [1, 0, 0, 0];

/** (x, y)'s rest point under `map`: restPoint's twin. */
export const stampRestPoint = ([ma, mb, kx, ky]: StampRestMap, x: number, y: number) => ({ x: ma * x - mb * y + kx, y: mb * x + ma * y + ky });

/** `restPoint(m, p)`: p's rest point under the map whose words are `m`. */
export const STAMP_REST_POINT_WGSL = /* wgsl */ `
fn restPoint(m: vec4f, p: vec2f) -> vec2f { return vec2f(m.x * p.x - m.y * p.y + m.z, m.y * p.x + m.x * p.y + m.w); }`;
