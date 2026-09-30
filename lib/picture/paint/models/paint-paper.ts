// paint-paper.ts: how paint meets the paper, a height field (its grain image, light high). A wet medium pools into
// the valleys, further by a pigment's granulation and load: linear in the valley's relative depth (mean 1), so paint
// moves and none is added; with no granulation it's the flat compositor's tooth, mix(1, v, depth). A dry medium
// catches on the peaks. Flocculation clumps a pigment by noise seeded by its id, mean 1.
//
// Negative space: conserved over the paper, not within one footprint (a sum per deposit); and
// granulation doesn't yet depend on how wet the paper is (vid-81).

/** How far a granulating pigment's load deepens its pooling: at full load a granulation of 2/3 pools all the way. */
const GRANULATION_SETTLE = 1.5;

/** How deep the paper is at a height `h` (0..1, light high), relative to its mean depth: 1 on average. */
export function paintValley(h: number, meanHeight: number): number {
  return (1 - h) / Math.max(1 - meanHeight, 0.01);
}

/**
 * The share of a wet pigment's amount that lands where the paper's relative depth is `valley`: 1 + a(v − 1), `a` the
 * paper's depth plus granulation (the pigment's times the medium's) times GRANULATION_SETTLE times the pigment's load
 * in unit films, held to 0..1, so the share never falls below 0.
 */
export function paintWetSettle(valley: number, paperDepth: number, granulation: number, load: number): number {
  const a = Math.min(1, Math.max(0, paperDepth + granulation * GRANULATION_SETTLE * load));
  return 1 + a * (valley - 1);
}

/** The share of a dry medium's paint that catches where the paper stands `h` high: none below `tooth` of its mean, all at the mean. */
export function paintDryContact(h: number, meanHeight: number, tooth: number): number {
  return Math.min(1, Math.max(0, (h - tooth * meanHeight) / Math.max(meanHeight * (1 - tooth), 0.01)));
}

/** A whole number's hash to 0..1 (PCG's output permutation), the same in f64 here and u32 in WGSL. */
function hash01(x: number, y: number, seed: number): number {
  let v = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed) >>> 0;
  v = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((v >>> ((v >>> 28) + 4)) ^ v) >>> 0, 277803737) >>> 0;
  return (((word >>> 22) ^ word) >>> 8) / 16777216;
}

/** Smooth value noise at `x`, `y` (lattice units), 0..1. */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  // The lattice wraps at 2²⁴ so a whole number stays exact in f32 on the GPU.
  const at = (dx: number, dy: number) => hash01((ix + dx) & 0xffffff, (iy + dy) & 0xffffff, seed);
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * sx, bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * sx;
  return top + (bottom - top) * sy;
}

/** A pigment's seed for its clumps, from its id (FNV-1a): the same clumps wherever it's laid, apart from other pigments'. */
export function paintPigmentSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  // Held to 24 bits so the seed crosses to the GPU exactly through an f32 or a u32 alike.
  return h & 0xffffff;
}

/**
 * The share of a flocculating pigment's amount at painting pixel `x`, `y`: 1 + f(2n − 1), n clumps of about 2.5 and
 * 1.2 pixels, so a pigment with flocculation 1 lies from bare to doubled, 1 on average.
 */
export function paintClumps(flocculation: number, x: number, y: number, seed: number): number {
  if (flocculation <= 0) return 1;
  const n = 0.65 * valueNoise(x / 2.5, y / 2.5, seed) + 0.35 * valueNoise(x / 1.2, y / 1.2, seed ^ 0x5bd1e9);
  return 1 + flocculation * (2 * n - 1);
}

export const PAINT_PAPER_WGSL = /* wgsl */ `
fn paintValley(h: f32, meanHeight: f32) -> f32 { return (1.0 - h) / max(1.0 - meanHeight, 0.01); }
fn paintWetSettle(valley: f32, paperDepth: f32, granulation: f32, load: f32) -> f32 {
  let a = clamp(paperDepth + granulation * ${GRANULATION_SETTLE.toFixed(4)} * load, 0.0, 1.0);
  return 1.0 + a * (valley - 1.0);
}
fn paintDryContact(h: f32, meanHeight: f32, tooth: f32) -> f32 {
  return clamp((h - tooth * meanHeight) / max(meanHeight * (1.0 - tooth), 0.01), 0.0, 1.0);
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
