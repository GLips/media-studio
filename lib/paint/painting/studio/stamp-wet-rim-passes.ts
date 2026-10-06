// stamp-wet-rim-passes.ts: the drying rim's passes (stamp-wet-rim.ts loads and runs them), as WGSL: its sizing from
// what the drying saw, which opens its gate or keeps it shut; its domain, edge seeds and jump flood; the line and take
// by each pixel's distance to the edge; and the exchange through the transport's scatter.

import { PAINT_PAPER_WGSL } from '#lib/paint/materials/models/paint-paper.ts';
import { STAMP_DRYING_RIM_LEAST_BAND, STAMP_DRYING_RIM_MOST_BAND, STAMP_DRYING_RIM_WGSL } from '../models/stamp-wet-rim.ts';
import { gpuUniformLayout } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';

const WORKGROUP = 8;

/** Coverage below which a pixel is paper, not paint, and above which it's wholly paint: a wash's faintest film still counts. */
const DOMAIN_COVERAGE = [0.01, 0.06] as const;

/** The paper's grain, as a Gaussian's sigma in pixels: a hole in the paint this fine is closed, and grows no rim. */
const GRAIN_SIGMA = 2.5;

/**
 * The coverage the rim's line and hardness read, smoothed over this sigma, px: a fringe's pixel-scale texture shifts
 * with the paint's pigments (a flow evens each pigment by its own granulation), and the line, a pixel or two wide,
 * would shift with it; smoothed, a sunset's hours rim alike.
 */
const CONTOUR_SIGMA = 2.5;

/**
 * How far in from the edge, px, its hardness compares the paint's coverage: just inside it, and past a soft brush's
 * rim, or the rim's band if wider.
 */
const EDGE_DEPTHS = [4, 14] as const;

/**
 * How far in from the edge, px, the line reads the smoothed coverage round each pixel, fading over to its nearest
 * edge's distance by the second: the line has died away by then.
 */
const NEAR_EDGE = [4, 8] as const;

/**
 * How far round a pixel, px, the paint's level is read, and how far in from the edge the line looks for where the
 * paint is half that: a mask's softest edge.
 */
const HALF_DEPTH = 6;

/**
 * How far round a pixel, px, what the drying saw is read, its most: a wash's paint runs past where its water was laid,
 * and its rim is at that edge.
 */
const SEEN_REACH = 12;

/** The jump flood's first step, px: every pixel within the widest band finds its nearest edge. */
export const STAMP_DRYING_RIM_FLOOD_FIRST_STEP = 2 ** Math.ceil(Math.log2(STAMP_DRYING_RIM_MOST_BAND));

/**
 * A wash's rim: the pixels it works over; its medium's spread and damp; the seed its line's unevenness is drawn from;
 * its strength, the drying's `rim`; and the widest its band could be, as a sigma (stampDryingRimBound's band, halved),
 * which its spreads are sized by.
 */
export const STAMP_DRYING_RIM_UNIFORM = gpuUniformLayout('Rim', [
  ['origin', 'vec2u'], ['extent', 'vec2u'], ['seed', 'u32'], ['spread', 'f32'], ['damp', 'f32'], ['rim', 'f32'], ['bound', 'f32'],
]);

/**
 * What a rim's sizing finds, its widest band (the bit pattern of a non-negative float, ordered as its u32), and what it
 * sizes from it: its line's width, and its sigma's share of its bound (the transport's paper is that much narrower).
 */
const SIZING_WGSL = /* wgsl */ `
struct RimSizing { band: atomic<u32>, width: f32, ratio: f32 }
struct RimSized { band: u32, width: f32, ratio: f32 }`;
export const STAMP_DRYING_RIM_SIZING_BYTES = 12;

const PRELUDE = /* wgsl */ `
${STAMP_DRYING_RIM_UNIFORM.wgsl}
${SIZING_WGSL}
@group(0) @binding(0) var<uniform> u: Rim;
// Scratch textures hold the largest box, so a pixel's texel there is its place in the box.
fn local(p: vec2i) -> vec2i { return p - vec2i(u.origin); }
fn inside(p: vec2i) -> bool { return all(p >= vec2i(u.origin)) && all(p < vec2i(u.origin + u.extent)); }
// The pixel an invocation works on, or none past the box.
fn pixelOf(id: vec3u) -> vec2i { return select(vec2i(-1), vec2i(u.origin + id.xy), all(id.xy < u.extent)); }
const GRAIN_REACH = ${Math.ceil(3 * GRAIN_SIGMA)};
const CONTOUR_REACH = ${Math.ceil(3 * CONTOUR_SIGMA)};
fn contourKernel(d: i32) -> f32 { return exp(-f32(d * d) / ${(2 * CONTOUR_SIGMA * CONTOUR_SIGMA).toFixed(3)}); }
fn grainAt(d: i32) -> f32 { return exp(-f32(d * d) / ${(2 * GRAIN_SIGMA * GRAIN_SIGMA).toFixed(3)}); }
`;

// Whether the rim runs (stampWetTransportGate): the pixel a pass after its sizing works on, or none past its box or
// while its sizing keeps the gate shut.
const GATE_WGSL = /* wgsl */ `
@group(0) @binding(15) var<storage, read> gate: array<u32, 1>;
fn gatedPixelOf(id: vec3u) -> vec2i { return select(vec2i(-1), pixelOf(id), gate[0] != 0u); }
`;

// What the drying saw round each pixel (the wet field's rim texture: its wettest, x, and its tools' diameter, z), the
// most within SEEN_REACH: along rows, then columns, where each pixel's band joins the widest.
const SEEN_ROWS_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var seen: texture_2d<f32>;
@group(0) @binding(2) var seenRows: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  let last = vec2i(textureDimensions(seen)) - 1;
  var most = vec2f(0.0);
  for (var d = -${SEEN_REACH}; d <= ${SEEN_REACH}; d++) { most = max(most, textureLoad(seen, clamp(p + vec2i(d, 0), vec2i(0), last), 0).xz); }
  textureStore(seenRows, local(p), vec4f(most, 0.0, 0.0));
}`;
const SEEN_WGSL = /* wgsl */ `${PRELUDE}
${STAMP_DRYING_RIM_WGSL}
@group(0) @binding(1) var seenRows: texture_2d<f32>;
@group(0) @binding(2) var seen: texture_storage_2d<rg32float, write>;
@group(0) @binding(3) var<storage, read_write> sizing: RimSizing;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  var most = vec2f(0.0);
  for (var d = -${SEEN_REACH}; d <= ${SEEN_REACH}; d++) {
    let q = p + vec2i(0, d);
    if (inside(q)) { most = max(most, textureLoad(seenRows, local(q), 0).xy); }
  }
  textureStore(seen, local(p), vec4f(most, 0.0, 0.0));
  let band = dryingRimBand(u.spread, most.y, dryingRimWetShare(most.x, u.damp));
  if (band > 0.0) { atomicMax(&sizing.band, bitcast<u32>(band)); }
}`;

// Sizes the rim from its widest band, and whether it runs at all: a band under a pixel or two is a rim no one sees
// (damp brushwork, or a medium that barely spreads). It opens the gate (GATE_WGSL) or keeps it shut.
const FINALIZE_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var<storage, read_write> sizing: RimSizing;
@group(0) @binding(2) var<storage, read_write> gate: array<u32, 1>;
@compute @workgroup_size(1) fn run() {
  let band = bitcast<f32>(atomicLoad(&sizing.band));
  sizing.width = min(1.1, 0.5 + band / 50.0);
  // The bound is half the widest band the drying allows, so this is at most 1: no clamp, so a twin drifting past it shows.
  sizing.ratio = 0.5 * band / u.bound;
  gate[0] = select(0u, 1u, band >= ${STAMP_DRYING_RIM_LEAST_BAND.toFixed(3)});
}`;

// The wash's domain: its paint, where its water went.
const DOMAIN_WGSL = /* wgsl */ `${PRELUDE}${GATE_WGSL}
@group(0) @binding(1) var seen: texture_2d<f32>;
@group(0) @binding(2) var layer: texture_2d_array<f32>;
@group(0) @binding(3) var domain: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = gatedPixelOf(id);
  if (p.x < 0) { return; }
  let wettest = textureLoad(seen, local(p), 0).x;
  let paint = smoothstep(${DOMAIN_COVERAGE[0]}, ${DOMAIN_COVERAGE[1]}, textureLoad(layer, p, 0, 0).x);
  textureStore(domain, local(p), vec4f(select(0.0, paint, wettest > 0.001)));
}`;

// The coverage smoothed (CONTOUR_SIGMA), along rows, then columns: what the line and hardness read.
const CONTOUR_ROWS_WGSL = /* wgsl */ `${PRELUDE}${GATE_WGSL}
@group(0) @binding(1) var layer: texture_2d_array<f32>;
@group(0) @binding(2) var contourRows: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = gatedPixelOf(id);
  if (p.x < 0) { return; }
  var sum = 0.0;
  var weight = 0.0;
  for (var d = -CONTOUR_REACH; d <= CONTOUR_REACH; d++) {
    let q = p + vec2i(d, 0);
    if (inside(q)) { sum += contourKernel(d) * textureLoad(layer, q, 0, 0).x; weight += contourKernel(d); }
  }
  textureStore(contourRows, local(p), vec4f(sum / weight));
}`;
const CONTOUR_WGSL = /* wgsl */ `${PRELUDE}${GATE_WGSL}
@group(0) @binding(1) var contourRows: texture_2d<f32>;
@group(0) @binding(2) var contour: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = gatedPixelOf(id);
  if (p.x < 0) { return; }
  var sum = 0.0;
  var weight = 0.0;
  for (var d = -CONTOUR_REACH; d <= CONTOUR_REACH; d++) {
    let q = p + vec2i(0, d);
    if (inside(q)) { sum += contourKernel(d) * textureLoad(contourRows, local(q), 0).r; weight += contourKernel(d); }
  }
  textureStore(contour, local(p), vec4f(sum / weight));
}`;

// The smoothed coverage's most along each row, within HALF_DEPTH (r) and EDGE_DEPTHS[1] (g): the first half of the
// paint's level round a pixel, near and further round.
const LEVEL_ROWS_WGSL = /* wgsl */ `${PRELUDE}${GATE_WGSL}
@group(0) @binding(1) var contour: texture_2d<f32>;
@group(0) @binding(2) var levelRows: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = gatedPixelOf(id);
  if (p.x < 0) { return; }
  var most = vec2f(0.0);
  for (var d = -${EDGE_DEPTHS[1]}; d <= ${EDGE_DEPTHS[1]}; d++) {
    let q = p + vec2i(d, 0);
    if (!inside(q)) { continue; }
    let here = textureLoad(contour, local(q), 0).r;
    most = vec2f(select(most.x, max(most.x, here), abs(d) <= ${HALF_DEPTH}), max(most.y, here));
  }
  textureStore(levelRows, local(p), vec4f(most, 0.0, 0.0));
}`;

// The domain blurred along rows at the grain's scale.
const GRAIN_ROWS_WGSL = /* wgsl */ `${PRELUDE}${GATE_WGSL}
@group(0) @binding(1) var domain: texture_2d<f32>;
@group(0) @binding(2) var grainRows: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = gatedPixelOf(id);
  if (p.x < 0) { return; }
  var sum = 0.0;
  var weight = 0.0;
  for (var d = -GRAIN_REACH; d <= GRAIN_REACH; d++) {
    let q = p + vec2i(d, 0);
    weight += grainAt(d);
    if (inside(q)) { sum += grainAt(d) * textureLoad(domain, local(q), 0).r; }
  }
  textureStore(grainRows, local(p), vec4f(sum / weight));
}`;

// The edge's seeds: paper at the grain's scale too (a finer hole is no edge), and bare in the layer (where the water
// ends over earlier paint is no edge). A seed holds its own pixel, any other -1. The transport's paper is closed at a
// seed and open on paint, narrowed to the band's share of its bound.
const SEEDS_WGSL = /* wgsl */ `${PRELUDE}${GATE_WGSL}
@group(0) @binding(1) var domain: texture_2d<f32>;
@group(0) @binding(2) var grainRows: texture_2d<f32>;
@group(0) @binding(3) var seeds: texture_storage_2d<rg32float, write>;
@group(0) @binding(4) var transportPaper: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var layer: texture_2d_array<f32>;
@group(0) @binding(6) var closed: texture_storage_2d<r32float, write>;
@group(0) @binding(7) var<storage, read> sizing: RimSized;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = gatedPixelOf(id);
  if (p.x < 0) { return; }
  var sum = 0.0;
  var weight = 0.0;
  for (var d = -GRAIN_REACH; d <= GRAIN_REACH; d++) {
    let q = p + vec2i(0, d);
    weight += grainAt(d);
    if (inside(q)) { sum += grainAt(d) * textureLoad(grainRows, local(q), 0).r; }
  }
  let paper = textureLoad(domain, local(p), 0).r < 0.5 && sum / weight < 0.5 && textureLoad(layer, p, 0, 0).x < ${DOMAIN_COVERAGE[1]};
  textureStore(seeds, local(p), select(vec4f(-1.0), vec4f(vec2f(p), 0.0, 0.0), paper));
  textureStore(closed, local(p), vec4f(sum / weight));
  // Closed at a seed, but by degrees: a fringe pixel's coverage shifts a little with the paint's pigments, and a
  // barrier that flipped with it would reroute what reaches the line.
  let painted = max(max(smoothstep(0.4, 0.6, textureLoad(domain, local(p), 0).r), smoothstep(0.4, 0.6, sum / weight)), smoothstep(${(DOMAIN_COVERAGE[1] - 0.01).toFixed(3)}, ${(DOMAIN_COVERAGE[1] + 0.01).toFixed(3)}, textureLoad(layer, p, 0, 0).x));
  textureStore(transportPaper, local(p), vec4f(sizing.ratio, painted, 0.0, 0.0));
}`;

// The drying's walls (StampWetStageContext's wallOf) joined by their most, one region a dispatch, the first
// laying it afresh: where any of its deposits' paint and water were let land.
const BARRIER_WGSL = /* wgsl */ `${PRELUDE}${GATE_WGSL}
struct Wall { box: vec4f, first: u32 }
@group(0) @binding(1) var<uniform> wall: Wall;
@group(0) @binding(2) var region: texture_2d<f32>;
@group(0) @binding(3) var barrier: texture_storage_2d<r32float, read_write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = gatedPixelOf(id);
  if (p.x < 0) { return; }
  let q = vec2f(p) - wall.box.xy;
  var r = 0.0;
  if (all(q >= vec2f(0.0)) && all(q < wall.box.zw)) { r = textureLoad(region, vec2u(q), 0).r; }
  if (wall.first == 0u) { r = max(r, textureLoad(barrier, local(p)).r); }
  textureStore(barrier, local(p), vec4f(r));
}`;

// One jump of the flood: each pixel keeps the nearest seed among its own and those \`jump\` away.
const FLOOD_WGSL = /* wgsl */ `${PRELUDE}${GATE_WGSL}
@group(0) @binding(1) var<uniform> jump: u32;
@group(0) @binding(2) var seedsIn: texture_2d<f32>;
@group(0) @binding(3) var seedsOut: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = gatedPixelOf(id);
  if (p.x < 0) { return; }
  var best = vec2f(-1.0);
  var nearest = 1e20;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let q = p + vec2i(i, j) * i32(jump);
      if (!inside(q)) { continue; }
      let seed = textureLoad(seedsIn, local(q), 0).xy;
      if (seed.x < 0.0) { continue; }
      let far = dot(seed - vec2f(p), seed - vec2f(p));
      if (far < nearest) { nearest = far; best = seed; }
    }
  }
  textureStore(seedsOut, local(p), vec4f(best, 0.0, 0.0));
}`;

// Each pixel's line (also for Gᵀ) and take, from its distance to the edge, how wet the wash was
// there and how much of its paint is open. The gate is the open share, not the paper's workable at the wash's end: a
// wash left to dry ends with none workable, and that drying is what rims it.
const weightsWgsl = (layers: number, movedWgsl: string, stage: StampStage) => /* wgsl */ `${PRELUDE}${GATE_WGSL}
${stampStageWgsl(stage)}
${STAMP_DRYING_RIM_WGSL}
${PAINT_PAPER_WGSL}
${movedWgsl}
@group(0) @binding(1) var seen: texture_2d<f32>;
@group(0) @binding(2) var domain: texture_2d<f32>;
@group(0) @binding(3) var seeds: texture_2d<f32>;
@group(0) @binding(4) var layer: texture_2d_array<f32>;
@group(0) @binding(5) var weights: texture_storage_2d<rg32float, write>;
@group(0) @binding(6) var lineOut: texture_storage_2d_array<rgba32float, write>;
@group(0) @binding(7) var contour: texture_2d<f32>;
@group(0) @binding(8) var levelRows: texture_2d<f32>;
fn contourAt(q: vec2i) -> f32 { return textureLoad(contour, clamp(q, vec2i(0), vec2i(u.extent) - 1), 0).r; }
// The paint's level round a pixel: the most of the smoothed coverage within HALF_DEPTH (x) and EDGE_DEPTHS[1] (y),
// rows' most then columns'.
fn levelAt(q: vec2i) -> vec2f {
  var most = vec2f(0.0);
  for (var d = -${EDGE_DEPTHS[1]}; d <= ${EDGE_DEPTHS[1]}; d++) {
    let here = textureLoad(levelRows, clamp(q + vec2i(0, d), vec2i(0), vec2i(u.extent) - 1), 0).xy;
    most = vec2f(select(most.x, max(most.x, here.x), abs(d) <= ${HALF_DEPTH}), max(most.y, here.y));
  }
  return most;
}
@group(0) @binding(9) var closed: texture_2d<f32>;
@group(0) @binding(10) var barrier: texture_2d<f32>;
@group(0) @binding(11) var<storage, read> sizing: RimSized;
// A field at a point, bilinear (a seed steps a pixel at a time along a slanted edge, and a nearest read there would
// chequer the band), held to the box.
fn fieldAt(field: texture_2d<f32>, point: vec2f) -> f32 {
  let at = clamp(point, vec2f(u.origin), vec2f(u.origin + u.extent) - 1.001);
  let i = local(vec2i(floor(at)));
  let f = at - floor(at);
  let a = textureLoad(field, i, 0).r;
  let b = textureLoad(field, i + vec2i(1, 0), 0).r;
  let c = textureLoad(field, i + vec2i(0, 1), 0).r;
  let e = textureLoad(field, i + vec2i(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}
// Where \`field\` first reaches \`level\` going \`toward\` from \`origin\`, px, to the sub-pixel; \`most\` if not by then.
fn reaches(field: texture_2d<f32>, origin: vec2f, toward: vec2f, level: f32, most: i32) -> f32 {
  var below = fieldAt(field, origin);
  if (below >= level) { return 0.0; }
  for (var k = 1; k <= most; k++) {
    let here = fieldAt(field, origin + toward * f32(k));
    if (here >= level) { return f32(k - 1) + clamp((level - below) / max(here - below, 1e-6), 0.0, 1.0); }
    below = here;
  }
  return f32(most);
}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = gatedPixelOf(id);
  if (p.x < 0) { return; }
  let paint = textureLoad(domain, local(p), 0).r;
  let seed = textureLoad(seeds, local(p), 0).xy;
  if (paint <= 0.0 || seed.x < 0.0) {
    textureStore(weights, local(p), vec4f(0.0));
    textureStore(lineOut, local(p), 0, vec4f(0.0));
    return;
  }
  let d = distance(seed, vec2f(p));
  // Every pixel judges its nearest stretch of edge alike, from the same two points along the way in.
  let toward = select(vec2f(0.0), (vec2f(p) - seed) / d, d > 0.5);
  let saw = textureLoad(seen, local(p), 0).xy;
  let wetShare = dryingRimWetShare(saw.x, u.damp);
  let band = dryingRimBand(u.spread, saw.y, wetShare);
  // The edge to the sub-pixel: where the paint, closed at the grain's scale, starts on the way in from the nearest
  // seed. Warning: the seed is a thresholded pixel, and a fringe's coverage shifts a little with the paint's pigments;
  // whatever is read from the edge, read from the seed itself, would jump a pixel with the colour.
  let painted = reaches(closed, seed, toward, 0.5, 4);
  // Paint standing against a wall (only walls are laid: stampDepositWalled) ends on its line as on dry paper: it's the
  // edge, wholly abrupt, and the rim's line starts on it.
  let wall = reaches(barrier, seed, toward, 0.5, 4);
  let walled = wall < 4.0 && painted <= wall + 2.0;
  let edge = seed + toward * select(painted, wall, walled);
  let inward = d - distance(seed, edge);
  // How abruptly the paint ends, from the smoothed coverage just inside the edge and well in, each averaged over a
  // few pixels: a fringe's step a pixel nearer or further then moves it by degrees. Well in is at least the band: a
  // wet-in-wet edge feathers over tens of pixels, and judged nearer it reads half-hard, its line in stray commas.
  var edgeCover = 0.0;
  var innerCover = 0.0;
  for (var k = -2; k <= 2; k++) {
    edgeCover += 0.2 * fieldAt(contour, edge + toward * f32(${EDGE_DEPTHS[0]} + k));
    innerCover += 0.2 * fieldAt(contour, edge + toward * (max(${EDGE_DEPTHS[1]}.0, band) + f32(k)));
  }
  let hardness = select(dryingRimHardness(edgeCover, innerCover), 1.0, walled);
  // How far in from where the paint is half there the pixel is, by its nearest edge.
  let half = select(reaches(contour, edge, toward, 0.5 * edgeCover, ${HALF_DEPTH}), 0.0, walled);
  let far = inward - half - 0.5;
  let at = local(p);
  let levels = levelAt(at);
  let level = levels.x;
  // The line starts where the paint is half there: a masked or cut wash fades in over the mask's soft edge, which it
  // shares with whatever is painted the other side, and a line out in that fringe would ring the neighbour too.
  // Warning: near the edge, how far in comes from the smoothed coverage round the pixel itself, not its nearest edge
  // pixel's. That edge is a thresholded pixel, and a fringe's coverage shifts a little with the paint's pigments, so
  // which pixel it is (and so the line, a pixel wide) would shift with the colour.
  let gradient = 0.5 * vec2f(contourAt(at + vec2i(1, 0)) - contourAt(at - vec2i(1, 0)), contourAt(at + vec2i(0, 1)) - contourAt(at - vec2i(0, 1)));
  let slope = length(gradient);
  let nearby = 1.0 - smoothstep(${NEAR_EDGE[0]}.0, ${NEAR_EDGE[1]}.0, far);
  // On paint as even as a plateau, the slope says nothing: there it's well in, and its edge the nearest edge's.
  let near = clamp(select((contourAt(at) - 0.5 * level) / max(slope, 1e-3) - 0.5, far, walled), -${NEAR_EDGE[0]}.0, ${NEAR_EDGE[1]}.0);
  // The line wavers along the edge in width, strength and how far in it sits, and breaks off in stretches, by noise at
  // the edge (so across the band alike) in the painting's own pixels, keyed to the wash's seed, meeting itself at a
  // wrapping sheet's seam.
  let sloped = select(nearby * smoothstep(0.01, 0.04, slope), 0.0, walled);
  let start = mix(edge + toward * half, vec2f(p) - gradient / max(slope, 1e-3) * (near + 0.5), sloped) - vec2f(STAGE_MARGIN);
  let width = sizing.width * (0.6 + 0.8 * paintNoiseWrapped(start.x, start.y, 6.0, u.seed, STAGE_WRAP));
  let present = dryingRimPresence(paintNoiseWrapped(start.x, start.y, 45.0, u.seed ^ 0x9e3779u, STAGE_WRAP), paintNoiseWrapped(start.x, start.y, 12.0, u.seed ^ 0x51ed27u, STAGE_WRAP));
  let strength = present * (0.55 + 0.45 * paintNoiseWrapped(start.x, start.y, 20.0, u.seed ^ 0x2545f4u, STAGE_WRAP));
  let inset = 1.2 * paintNoiseWrapped(start.x, start.y, 9.0, u.seed ^ 0x68e31du, STAGE_WRAP);
  // An edge pixel the paint only partly covers takes its share of the line, so the line keeps the paint's edge.
  let covered = clamp(textureLoad(layer, p, 0, 0).x / max(level, 1e-3), 0.0, 1.0);
  // A feathered fringe has no line: half-there contours wandering through one would gather the band's paint.
  // Nor, on an abrupt edge, does the faint fringe outside its step: there the paint round a pixel is well below the
  // paint further round, and its line would follow the fringe's own small steps, which a colour shifts.
  let line = paint * covered * present * nearby * select(dryingRimSteep(level, levels.y), 1.0, walled) * dryingRimLine(near - inset, width);
  var held: array<vec4f, ${layers}>;
  for (var l = 0; l < ${layers}; l++) { held[l] = textureLoad(layer, p, l, 0); }
  // The drying's strength scales what each giver gives, before the scatter normalises it, so what's given is all
  // delivered: band and line are the medium's whatever the strength.
  let take = u.rim * paint * hardness * dryingRimDraw(mix(far, near, nearby) - inset, far - inset, band, sizing.width) * dryingRimTake(u.spread, wetShare, strength) * clamp(washOpen(held), 0.0, 1.0);
  textureStore(weights, local(p), vec4f(line, take, 0.0, 0.0));
  textureStore(lineOut, local(p), 0, vec4f(line, 0.0, 0.0, 0.0));
}`;

const LEAST_REACHED = 1e-5;

// Each giver's send (x): the share of its amounts it gives (y), over the line its paint would reach (N, the line spread
// back). A giver with no line in reach gives nothing.
const SEND_WGSL = /* wgsl */ `${PRELUDE}${GATE_WGSL}
@group(0) @binding(1) var weights: texture_2d<f32>;
@group(0) @binding(2) var reached: texture_2d_array<f32>;
@group(0) @binding(3) var send: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = gatedPixelOf(id);
  if (p.x < 0) { return; }
  let n = textureLoad(reached, local(p), 0, 0).r;
  let take = select(0.0, textureLoad(weights, local(p), 0).y, n > ${LEAST_REACHED});
  textureStore(send, local(p), vec4f(select(0.0, take / n, take > 0.0), take, 0.0, 0.0));
}`;

// What each giver sends of its pigment channels, for the transport to spread.
const sentWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}${GATE_WGSL}
${movedWgsl}
@group(0) @binding(1) var layer: texture_2d_array<f32>;
@group(0) @binding(2) var send: texture_2d<f32>;
@group(0) @binding(3) var sent: texture_storage_2d_array<rgba32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = gatedPixelOf(id);
  if (p.x < 0) { return; }
  let share = textureLoad(send, local(p), 0).x;
  for (var l = 0; l < ${layers}; l++) { textureStore(sent, local(p), l, share * textureLoad(layer, p, l, 0) * washPigmentMask(u32(l))); }
}`;

// The exchange, in the pigment channels; the rest of each pixel is the compositor's washMoved.
const rimWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}${GATE_WGSL}
${STAMP_DRYING_RIM_WGSL}
${movedWgsl}
@group(0) @binding(1) var layer: texture_storage_2d_array<rgba16float, read_write>;
@group(0) @binding(2) var weights: texture_2d<f32>;
@group(0) @binding(3) var send: texture_2d<f32>;
@group(0) @binding(4) var pulled: texture_2d_array<f32>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = gatedPixelOf(id);
  if (p.x < 0) { return; }
  let line = textureLoad(weights, local(p), 0).x;
  let take = textureLoad(send, local(p), 0).y;
  if (line <= 0.0 && take <= 0.0) { return; }
  var was: array<vec4f, ${layers}>;
  var now: array<vec4f, ${layers}>;
  for (var l = 0; l < ${layers}; l++) {
    was[l] = textureLoad(layer, p, l);
    now[l] = mix(was[l], dryingRimExchange(was[l], take, line, textureLoad(pulled, local(p), l, 0)), washPigmentMask(u32(l)));
  }
  let moved = washMoved(now, washPigmentTotal(was));
  for (var l = 0; l < ${layers}; l++) { textureStore(layer, p, l, moved[l]); }
}`;

/** The drying rim's passes shared by every group, each made by `compile`: its sizing, then the rest behind its gate. */
export const stampDryingRimPasses = <P>(compile: (code: string) => P) => ({
  seenRows: compile(SEEN_ROWS_WGSL), seen: compile(SEEN_WGSL), finalize: compile(FINALIZE_WGSL), domain: compile(DOMAIN_WGSL),
  grainRows: compile(GRAIN_ROWS_WGSL), seeds: compile(SEEDS_WGSL), flood: compile(FLOOD_WGSL), send: compile(SEND_WGSL),
  contourRows: compile(CONTOUR_ROWS_WGSL), contour: compile(CONTOUR_WGSL), levelRows: compile(LEVEL_ROWS_WGSL), barrier: compile(BARRIER_WGSL),
});

/** The drying rim's passes made per group's wash layer WGSL (`movedWgsl`, its `layers`) on `stage` by `compile`. */
export const stampDryingRimGroupPasses = <P>(compile: (code: string) => P, layers: number, movedWgsl: string, stage: StampStage) => ({
  weights: compile(weightsWgsl(layers, movedWgsl, stage)), sent: compile(sentWgsl(layers, movedWgsl)), rim: compile(rimWgsl(layers, movedWgsl)),
});
