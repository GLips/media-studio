// paint-paper.ts: how paint meets the paper, a height field (its grain image, light high). A wet medium pools into
// the valleys, further by a pigment's granulation and load, so paint moves and none is added. A dry medium catches
// on the peaks. Flocculation clumps a pigment by noise seeded by its id. Only the GPU lays paint, so the rules are
// WGSL alone, held to their accepted output by the GPU gate.
//
// Negative space: conserved over the paper, not within one footprint; and granulation doesn't yet depend on how wet
// the paper is (vid-81).

/** How far a granulating pigment's load deepens its pooling: at full load a granulation of 2/3 pools all the way. */
const GRANULATION_SETTLE = 1.5;

/** How much higher, as a share of the mean height, the paper must stand for a feather-light hand to catch it than a firm one. */
const DRY_LIGHT_REACH = 0.3;
/** How far the paper rises, as a share of its mean height, from where a dry stick first touches it to where it lays fully. */
const DRY_CATCH = 0.15;
/** A burnishing hand's press, past a drawing hand's full 1: a dry stick pressed this hard reaches every valley. */
export const PAINT_DRY_BURNISHED_PRESS = 2;

/** A pigment's seed for its clumps, from its id (FNV-1a): the same clumps wherever it's laid, apart from other pigments'. */
export function paintPigmentSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  // Held to 24 bits so the seed crosses to the GPU exactly through an f32 or a u32 alike.
  return h & 0xffffff;
}

/**
 * The paper in WGSL. `paintWetSettle` is linear in the valley's relative depth, steeper by granulation × load, the load
 * a share of a full one. `paintDryContact`: see its own note. `paintClumps` is value noise in clumps of about 2.5 and
 * 1.2 pixels, its lattice wrapping at 2²⁴ so it stays exact in f32.
 */
export const PAINT_PAPER_WGSL = /* wgsl */ `
fn paintValley(h: f32, meanHeight: f32) -> f32 { return (1.0 - h) / max(1.0 - meanHeight, 0.01); }
fn paintWetSettle(valley: f32, paperDepth: f32, granulation: f32, load: f32) -> f32 {
  let a = clamp(paperDepth + granulation * ${GRANULATION_SETTLE.toFixed(4)} * load, 0.0, 1.0);
  return 1.0 + a * (valley - 1.0);
}
// Catches nothing below \`tooth\` of the mean height at \`press\` 1, less at 0, everything burnished, the
// valleys raised \`filled\` of the way by wax.
fn paintDryContact(h: f32, meanHeight: f32, tooth: f32, paperDepth: f32, press: f32, filled: f32) -> f32 {
  let surface = h + (1.0 - h) * clamp(filled, 0.0, 1.0);
  let reach = tooth + ${DRY_LIGHT_REACH.toFixed(4)} * (1.0 - clamp(press, 0.0, 1.0));
  let contact = clamp((surface - reach * meanHeight) / (${DRY_CATCH.toFixed(4)} * meanHeight), 0.0, 1.0);
  let burnished = clamp((press - 1.0) / ${(PAINT_DRY_BURNISHED_PRESS - 1).toFixed(4)}, 0.0, 1.0);
  return 1.0 + paperDepth * (1.0 - burnished) * (contact - 1.0);
}
fn paintHash01(x: u32, y: u32, seed: u32) -> f32 {
  let v = (x * 0x27d4eb2du) ^ (y * 0x165667b1u) ^ seed;
  let s = v * 747796405u + 2891336453u;
  let word = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return f32(((word >> 22u) ^ word) >> 8u) / 16777216.0;
}
fn paintValueNoise(x: f32, y: f32, seed: u32) -> f32 {
  let i = floor(vec2f(x, y));
  let f = vec2f(x, y) - i;
  let s = f * f * (3.0 - 2.0 * f);
  let ix = u32(i32(i.x)) & 0xffffffu;
  let iy = u32(i32(i.y)) & 0xffffffu;
  let a = paintHash01(ix, iy, seed);
  let b = paintHash01((ix + 1u) & 0xffffffu, iy, seed);
  let c = paintHash01(ix, (iy + 1u) & 0xffffffu, seed);
  let d = paintHash01((ix + 1u) & 0xffffffu, (iy + 1u) & 0xffffffu, seed);
  let top = a + (b - a) * s.x;
  let bottom = c + (d - c) * s.x;
  return top + (bottom - top) * s.y;
}
fn paintClumps(flocculation: f32, x: f32, y: f32, seed: u32) -> f32 {
  if (flocculation <= 0.0) { return 1.0; }
  let n = 0.65 * paintValueNoise(x / 2.5, y / 2.5, seed) + 0.35 * paintValueNoise(x / 1.2, y / 1.2, seed ^ 0x5bd1e9u);
  return 1.0 + flocculation * (2.0 * n - 1.0);
}`;
