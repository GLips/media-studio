// stamp-rest-map.ts: where posed paint was planned (ENGINE 5.3). A pose maps a sheet's marks before painting; what
// travels with the paint (its fields, a ragged edge's noise, a stamp's tip noise, a flood's local scale, pigment
// clumps) is read at the rest point a map takes each paper point back to. The paper's grain and absorbency are the
// paper's, read where they lie. A sheet its owner's chain moves is placed whole, read back to rest the same way.

/** A similarity as a pass reads it, p ↦ (ma + i·mb)·p + (kx + i·ky): its words [ma, mb, kx, ky]. */
export type StampSimilarityWords = readonly [number, number, number, number];

/** The similarity taking a paper point back to where it was planned. */
export type StampRestMap = StampSimilarityWords;

/**
 * Where a sheet its owner's chain moves lies, paint, card and paper together: `laid` takes where it was painted to
 * where it lies, `rest` back.
 */
export type StampSheetPlace = { readonly laid: StampSimilarityWords; readonly rest: StampRestMap };

/** Paint lying where it was planned. */
export const STAMP_REST_IDENTITY: StampRestMap = [1, 0, 0, 0];

/** (x, y) under `words`: restPoint's twin. */
export const stampSimilarityPoint = ([ma, mb, kx, ky]: StampSimilarityWords, x: number, y: number) => ({ x: ma * x - mb * y + kx, y: mb * x + ma * y + ky });

/** `restPoint(m, p)`: p's rest point under the map whose words are `m`. */
export const STAMP_REST_POINT_WGSL = /* wgsl */ `
fn restPoint(m: vec4f, p: vec2f) -> vec2f { return vec2f(m.x * p.x - m.y * p.y + m.z, m.y * p.x + m.x * p.y + m.w); }`;
