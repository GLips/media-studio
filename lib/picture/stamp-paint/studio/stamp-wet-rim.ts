// stamp-wet-rim.ts: the wet stage that leaves a drying rim (models/stamp-wet-rim.ts) once each wash is done. Its
// domain is the wash's paint, the layer's coverage where its water went, with holes finer than the paper's grain
// closed: grain and seams between strokes don't rim. Distance to the edge comes by jump flooding over the wash's box;
// each band pixel gives a share of its open pigment to the line by the transport's scatter (stamp-wet-transport.ts),
// closed where it's paper at the grain's scale, so nothing crosses masking fluid or a gap; then washMoved.
//
// Negative space: the group's earlier paint under the wash is its domain too, so no rim falls along it; being set,
// none of it is drawn to the rim.

import { PAINT_PAPER_WGSL } from '#lib/picture/paint/models/paint-paper.ts';
import { STAMP_DRYING_RIM_MOST_BAND, STAMP_DRYING_RIM_WGSL, stampDryingRimBand, stampDryingRimWetShare, stampDryingWettest, stampWashDryings, type StampWashDrying } from '../models/stamp-wet-rim.ts';
import { STAMP_GRID_AT_WGSL, type StampGrid } from '../models/stamp-region.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe.ts';
import type { StampLoadedWetStage, StampWetDryingMoment, StampWetStage, StampWetStageContext } from './stamp-wet-stages.ts';
import { stampUniformLayout, stampUniformWriter } from './stamp-uniform-layout.ts';
import { encodeStampWetTransportSteps, stampWetSpreads } from './stamp-wet-transport.ts';

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

/** How far in from the edge, px, its hardness compares the paint's coverage: just inside it, and past a soft brush's rim. */
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

/** The jump flood's first step, px: every pixel within the widest band finds its nearest edge. */
const FLOOD_FIRST_STEP = 2 ** Math.ceil(Math.log2(STAMP_DRYING_RIM_MOST_BAND));

/**
 * A wash's rim: its wettest grid's lattice, size and first value in the grid buffer; the pixels it works over; its
 * medium's spread and damp, its brushes' mean diameter; its line's width; the seed its line's unevenness is drawn
 * from; and its strength, the drying's `rim`.
 */
const RIM = stampUniformLayout('Rim', [
  ['lattice', 'vec4f'], ['size', 'vec2u'], ['first', 'u32'], ['seed', 'u32'], ['origin', 'vec2u'], ['extent', 'vec2u'],
  ['spread', 'f32'], ['damp', 'f32'], ['diameter', 'f32'], ['width', 'f32'], ['rim', 'f32'],
]);

const PRELUDE = /* wgsl */ `
${RIM.wgsl}
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

// The wash's domain: its paint, where its water went.
const DOMAIN_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var<storage, read> grid: array<f32>;
${STAMP_GRID_AT_WGSL}
@group(0) @binding(2) var layer: texture_2d_array<f32>;
@group(0) @binding(3) var domain: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  let wettest = gridAt(vec2f(p) + 0.5, u.lattice.xyz, u.size, u.first);
  let paint = smoothstep(${DOMAIN_COVERAGE[0]}, ${DOMAIN_COVERAGE[1]}, textureLoad(layer, p, 0, 0).x);
  textureStore(domain, local(p), vec4f(select(0.0, paint, wettest > 0.001)));
}`;

// The coverage smoothed (CONTOUR_SIGMA), along rows, then columns: what the line and hardness read.
const CONTOUR_ROWS_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var layer: texture_2d_array<f32>;
@group(0) @binding(2) var contourRows: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  var sum = 0.0;
  var weight = 0.0;
  for (var d = -CONTOUR_REACH; d <= CONTOUR_REACH; d++) {
    let q = p + vec2i(d, 0);
    if (inside(q)) { sum += contourKernel(d) * textureLoad(layer, q, 0, 0).x; weight += contourKernel(d); }
  }
  textureStore(contourRows, local(p), vec4f(sum / weight));
}`;
const CONTOUR_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var contourRows: texture_2d<f32>;
@group(0) @binding(2) var contour: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
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
const LEVEL_ROWS_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var contour: texture_2d<f32>;
@group(0) @binding(2) var levelRows: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
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
const GRAIN_ROWS_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var domain: texture_2d<f32>;
@group(0) @binding(2) var grainRows: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
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

// The edge's seeds: paper at the grain's scale too (a finer hole is no edge), and bare in the layer: where the water
// ends over the group's earlier paint, the lattice's staircase is no edge. A seed holds its own pixel, any other none
// (-1). The transport's paper is closed at a seed and open on paint.
const SEEDS_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var domain: texture_2d<f32>;
@group(0) @binding(2) var grainRows: texture_2d<f32>;
@group(0) @binding(3) var seeds: texture_storage_2d<rg32float, write>;
@group(0) @binding(4) var transportPaper: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var layer: texture_2d_array<f32>;
@group(0) @binding(6) var closed: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
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
  textureStore(transportPaper, local(p), vec4f(1.0, painted, 0.0, 0.0));
}`;

// One jump of the flood: each pixel keeps the nearest seed among its own and those \`jump\` away.
const FLOOD_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var<uniform> jump: u32;
@group(0) @binding(2) var seedsIn: texture_2d<f32>;
@group(0) @binding(3) var seedsOut: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
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
const weightsWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}
${STAMP_DRYING_RIM_WGSL}
${PAINT_PAPER_WGSL}
${movedWgsl}
@group(0) @binding(1) var<storage, read> grid: array<f32>;
${STAMP_GRID_AT_WGSL}
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
  let p = pixelOf(id);
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
  let wetShare = dryingRimWetShare(gridAt(vec2f(p) + 0.5, u.lattice.xyz, u.size, u.first), u.damp);
  let band = dryingRimBand(u.spread, u.diameter, wetShare);
  // The edge to the sub-pixel: where the paint, closed at the grain's scale, starts on the way in from the nearest
  // seed. Warning: the seed is a thresholded pixel, and a fringe's coverage shifts a little with the paint's pigments;
  // whatever is read from the edge, read from the seed itself, would jump a pixel with the colour.
  let edge = seed + toward * reaches(closed, seed, toward, 0.5, 4);
  let inward = d - distance(seed, edge);
  // How abruptly the paint ends, from the smoothed coverage just inside the edge and well in, each averaged over a
  // few pixels: a fringe's step a pixel nearer or further then moves it by degrees.
  var edgeCover = 0.0;
  var innerCover = 0.0;
  for (var k = -2; k <= 2; k++) {
    edgeCover += 0.2 * fieldAt(contour, edge + toward * f32(${EDGE_DEPTHS[0]} + k));
    innerCover += 0.2 * fieldAt(contour, edge + toward * f32(${EDGE_DEPTHS[1]} + k));
  }
  let hardness = dryingRimHardness(edgeCover, innerCover);
  // How far in from where the paint is half there the pixel is, by its nearest edge.
  let half = reaches(contour, edge, toward, 0.5 * edgeCover, ${HALF_DEPTH});
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
  let near = clamp((contourAt(at) - 0.5 * level) / max(slope, 1e-3) - 0.5, -${NEAR_EDGE[0]}.0, ${NEAR_EDGE[1]}.0);
  // The line wavers along the edge in width, strength and how far in it sits, and breaks off in stretches, by noise at
  // the edge (so across the band alike) in the painting's own pixels, keyed to the wash's seed.
  let sloped = nearby * smoothstep(0.01, 0.04, slope);
  let start = mix(edge + toward * half, vec2f(p) - gradient / max(slope, 1e-3) * (near + 0.5), sloped);
  let width = u.width * (0.6 + 0.8 * paintValueNoise(start.x / 6.0, start.y / 6.0, u.seed));
  let present = dryingRimPresence(paintValueNoise(start.x / 45.0, start.y / 45.0, u.seed ^ 0x9e3779u), paintValueNoise(start.x / 12.0, start.y / 12.0, u.seed ^ 0x51ed27u));
  let strength = present * (0.55 + 0.45 * paintValueNoise(start.x / 20.0, start.y / 20.0, u.seed ^ 0x2545f4u));
  let inset = 1.2 * paintValueNoise(start.x / 9.0, start.y / 9.0, u.seed ^ 0x68e31du);
  // An edge pixel the paint only partly covers takes its share of the line, so the line keeps the paint's edge.
  let covered = clamp(textureLoad(layer, p, 0, 0).x / max(level, 1e-3), 0.0, 1.0);
  // A feathered fringe has no line: half-there contours wandering through one would gather the band's paint.
  // Nor, on an abrupt edge, does the faint fringe outside its step: there the paint round a pixel is well below the
  // paint further round, and its line would follow the fringe's own small steps, which a colour shifts.
  let line = paint * covered * present * nearby * dryingRimSteep(level, levels.y) * dryingRimLine(near - inset, width);
  var held: array<vec4f, ${layers}>;
  for (var l = 0; l < ${layers}; l++) { held[l] = textureLoad(layer, p, l, 0); }
  // The drying's strength scales what each giver gives, before the scatter normalises it, so what's given is all
  // delivered: band and line are the medium's whatever the strength.
  let take = u.rim * paint * hardness * dryingRimDraw(mix(far, near, nearby) - inset, far - inset, band, u.width) * dryingRimTake(u.spread, wetShare, strength) * clamp(washOpen(held), 0.0, 1.0);
  textureStore(weights, local(p), vec4f(line, take, 0.0, 0.0));
  textureStore(lineOut, local(p), 0, vec4f(line, 0.0, 0.0, 0.0));
}`;

const LEAST_REACHED = 1e-5;

// Each giver's send (x): the share of its amounts it gives (y), over the line its paint would reach (N, the line spread
// back). A giver with no line in reach gives nothing.
const SEND_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var weights: texture_2d<f32>;
@group(0) @binding(2) var reached: texture_2d_array<f32>;
@group(0) @binding(3) var send: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  let n = textureLoad(reached, local(p), 0, 0).r;
  let take = select(0.0, textureLoad(weights, local(p), 0).y, n > ${LEAST_REACHED});
  textureStore(send, local(p), vec4f(select(0.0, take / n, take > 0.0), take, 0.0, 0.0));
}`;

// What each giver sends of its pigment channels, for the transport to spread.
const sentWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}
${movedWgsl}
@group(0) @binding(1) var layer: texture_2d_array<f32>;
@group(0) @binding(2) var send: texture_2d<f32>;
@group(0) @binding(3) var sent: texture_storage_2d_array<rgba32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  let share = textureLoad(send, local(p), 0).x;
  for (var l = 0; l < ${layers}; l++) { textureStore(sent, local(p), l, share * textureLoad(layer, p, l, 0) * washPigmentMask(u32(l))); }
}`;

// The exchange, in the pigment channels; the rest of each pixel is the compositor's washMoved.
const rimWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}
${STAMP_DRYING_RIM_WGSL}
${movedWgsl}
@group(0) @binding(1) var layer: texture_storage_2d_array<rgba16float, read_write>;
@group(0) @binding(2) var weights: texture_2d<f32>;
@group(0) @binding(3) var send: texture_2d<f32>;
@group(0) @binding(4) var pulled: texture_2d_array<f32>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
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

/** The pixels `grid` spans, within the painting. */
function gridBox(grid: StampGrid, width: number, height: number): StampPixelBox {
  const x = Math.max(0, grid.x0), y = Math.max(0, grid.y0);
  return { x, y, w: Math.min(width, grid.x0 + (grid.columns - 1) * grid.cell) - x, h: Math.min(height, grid.y0 + (grid.rows - 1) * grid.cell) - y };
}

/**
 * A drying's rim as loaded: its wettest grid's place in the grid buffer, its box, uniform (whose seed `writeSeed`
 * sets), the group's layer count, and its transport's spreads (Gᵀ of the line, then of what's sent).
 */
type LoadedRim = {
  grid: StampGrid; first: number; box: StampPixelBox; uniform: GPUBuffer; writeSeed: (seed: number) => void;
  layers: number; spreads: ReturnType<typeof stampWetSpreads>;
};

function loadDryingRim({ device, painting, medium, wetness, width, height, layer, wash }: StampWetStageContext): StampLoadedWetStage<StampWetDryingMoment> {
  const { spread, damp } = medium.wetting;
  const dryings = painting.groups.flatMap((group) => group.passes).flatMap(stampWashDryings);
  if (spread <= 0 || !dryings.length) return { encode: () => null };

  const rims = new Map<StampWashDrying, LoadedRim>();
  // Every deposit of a drying the medium would rim, whose brushes' own wet edges would rim it again: a drying at
  // strength 0 owns its edges too, so its brushes' rims don't come back when its own is turned off.
  const rimmed = new Set<CompiledStampDeposit>();
  const ownsWetEdges = (deposit: CompiledStampDeposit) => rimmed.has(deposit);
  let points = 0;
  for (const drying of dryings) {
    const grid = stampDryingWettest(drying, wetness);
    const painted = drying.deposits.filter((deposit) => deposit.action.kind === 'paint');
    if (!grid || !painted.length) continue;
    const wetShare = stampDryingRimWetShare(grid.values.reduce((most, value) => Math.max(most, value), 0), damp);
    const diameter = painted.reduce((sum, deposit) => sum + deposit.diameter, 0) / painted.length;
    const band = stampDryingRimBand(spread, diameter, wetShare);
    // A band under a pixel or two is a rim no one sees: damp brushwork, or a medium that barely spreads.
    if (band < 1.5) continue;
    const box = gridBox(grid, width, height);
    if (box.w <= 0 || box.h <= 0) continue;
    for (const deposit of drying.deposits) rimmed.add(deposit);
    // Nothing to gather: the drying keeps its edges, and pays nothing for a rim.
    if (drying.rim === 0) continue;
    const sigma = band / 2, layers = wash.layersOf(painted[0]);
    // The line, laid in values[1], spreads back there; what's sent spreads in values[0].
    const spreads = stampWetSpreads(device, [{ sigma, order: 'transposed', layers: 1, from: 1 }, { sigma, order: 'forward', layers, from: 0 }]);
    spreads.write(box);
    const words = new ArrayBuffer(RIM.words * 4);
    const put = stampUniformWriter(RIM, { floats: new Float32Array(words), ints: new Int32Array(words), words: new Uint32Array(words) });
    put('lattice', [grid.x0, grid.y0, grid.cell, 0]);
    put('size', [grid.columns, grid.rows]);
    put('first', points);
    put('origin', [box.x, box.y]);
    put('extent', [box.w, box.h]);
    put('spread', spread);
    put('damp', damp);
    put('diameter', diameter);
    put('width', Math.min(1.1, 0.5 + band / 50));
    put('rim', drying.rim);
    const uniform = device.createBuffer({ size: RIM.words * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const writeSeed = (seed: number) => {
      put('seed', seed);
      device.queue.writeBuffer(uniform, 0, words);
    };
    rims.set(drying, { grid, first: points, box, uniform, writeSeed, layers, spreads });
    points += grid.values.length;
  }
  if (!rims.size) return { encode: () => null, ownsWetEdges };

  const values = new Float32Array(points);
  for (const rim of rims.values()) values.set(rim.grid.values, rim.first);
  const grid = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(grid, 0, values);
  const jumps: GPUBuffer[] = [];
  for (let step = FLOOD_FIRST_STEP; step >= 1; step /= 2) {
    const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, new Uint32Array([step, 0, 0, 0]));
    jumps.push(buffer);
  }

  const layers = [...rims.values()].reduce((most, rim) => Math.max(most, rim.layers), 1);
  const most = [...rims.values()].reduce((size, { box }) => ({ w: Math.max(size.w, box.w), h: Math.max(size.h, box.h) }), { w: 0, h: 0 });
  const scratch = (format: GPUTextureFormat, depth = 1) =>
    device.createTexture({ size: [most.w, most.h, depth], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
      .createView({ dimension: depth > 1 ? '2d-array' : '2d' });
  // A one-layer array still binds as an array.
  const valuesTexture = () => device.createTexture({ size: [most.w, most.h, layers], format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
    .createView({ dimension: '2d-array' });
  const transport = { paper: scratch('rgba16float'), paths: [scratch('rgba16float'), scratch('rgba16float')], values: [valuesTexture(), valuesTexture()] } as const;
  const domain = scratch('r32float'), grainRows = scratch('r32float'), send = scratch('rg32float');
  const contourRows = scratch('r32float'), contour = scratch('r32float'), levelRows = scratch('rg32float'), closed = scratch('r32float');
  const seeds = [scratch('rg32float'), scratch('rg32float')], weights = scratch('rg32float');
  const compile = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'run' } });
  const passes = {
    domain: compile(DOMAIN_WGSL), grainRows: compile(GRAIN_ROWS_WGSL), seeds: compile(SEEDS_WGSL), flood: compile(FLOOD_WGSL),
    send: compile(SEND_WGSL), contourRows: compile(CONTOUR_ROWS_WGSL), contour: compile(CONTOUR_WGSL), levelRows: compile(LEVEL_ROWS_WGSL),
  };
  // Compiled per group layer count, which places the group's open share and bounds what's gathered.
  const groupPasses = new Map([...new Set([...rims.values()].map((rim) => rim.layers))].map((n): [number, Record<'weights' | 'sent' | 'rim', GPUComputePipeline>] => {
    const moved = wash.movedWgsl(n);
    return [n, { weights: compile(weightsWgsl(n, moved)), sent: compile(sentWgsl(n, moved)), rim: compile(rimWgsl(n, moved)) }];
  }));

  // Each rim's dispatches, in order, bound once: the scratch textures are sized for every rim at load.
  const rimSteps = new Map([...rims].map(([drying, { uniform, layers: groupLayers, spreads }]): [StampWashDrying, { pipeline: GPUComputePipeline; bindGroup: GPUBindGroup }[]] => {
    const step = (pipeline: GPUComputePipeline, resources: GPUBindingResource[]) => ({
      pipeline, bindGroup: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: resources.map((resource, binding) => ({ binding, resource })) }),
    });
    const u = { buffer: uniform }, own = groupPasses.get(groupLayers)!;
    return [drying, [
      step(passes.domain, [u, { buffer: grid }, layer.view, domain]),
      step(passes.grainRows, [u, domain, grainRows]),
      step(passes.seeds, [u, domain, grainRows, seeds[0], transport.paper, layer.view, closed]),
      ...jumps.map((jump, k) => step(passes.flood, [u, { buffer: jump }, seeds[k % 2], seeds[(k + 1) % 2]])),
      step(passes.contourRows, [u, layer.view, contourRows]),
      step(passes.contour, [u, contourRows, contour]),
      step(passes.levelRows, [u, contour, levelRows]),
      step(own.weights, [u, { buffer: grid }, domain, seeds[jumps.length % 2], layer.view, weights, transport.values[1], contour, levelRows, closed]),
      ...spreads.steps(0, transport),
      step(passes.send, [u, weights, transport.values[1], send]),
      step(own.sent, [u, layer.view, send, transport.values[0]]),
      ...spreads.steps(1, transport),
      step(own.rim, [u, layer.view, weights, send, transport.values[0]]),
    ]];
  }));

  return {
    encode: (encoder, { drying, seed }) => {
      const rim = rims.get(drying);
      if (!rim) return null;
      // A frame encodes a drying once, so its uniform holds one epoch's seed until the frame's submit.
      rim.writeSeed(seed);
      encodeStampWetTransportSteps(encoder, rimSteps.get(drying)!, rim.box);
      return rim.box;
    },
    ownsWetEdges,
  };
}

/** Pigment gathered at a wash's edge as it dries, at each of its dryings. */
export const STAMP_DRYING_RIM_STAGE = { id: 'drying-rim', after: 'drying', load: loadDryingRim } satisfies StampWetStage;
