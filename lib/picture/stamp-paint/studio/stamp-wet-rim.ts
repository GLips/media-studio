// stamp-wet-rim.ts: the wet stage that leaves a drying rim (models/stamp-wet-rim.ts) once each wash is done. Its
// domain is the wash's paint, the layer's coverage where its water went, with holes finer than the paper's grain
// closed: grain and seams between strokes don't rim. Distance to the edge comes by jump flooding over the wash's box;
// each pixel in the band gives a share of its pigment to the line, by a Gaussian normalised per giver.
//
// Negative space: coverage and the open share stay, as a rim moves pigment within the film. Where the wash lies over
// its group's earlier paint, that paint is its domain too, so no rim falls there.

import { PAINT_PAPER_WGSL, paintPigmentSeed } from '#lib/picture/paint/models/paint-paper.ts';
import { STAMP_DRYING_RIM_MOST_BAND, STAMP_DRYING_RIM_WGSL, stampDryingRimBand, stampDryingRimWetShare, stampWashWettest } from '../models/stamp-wet-rim.ts';
import { STAMP_GRID_AT_WGSL, type StampGrid } from '../models/stamp-region.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { stampPassDeposits, type CompiledStampPass } from '../models/stamp-paint-recipe.ts';
import type { StampLoadedWetStage, StampWetStage, StampWetStageContext, StampWetStageMoment } from './stamp-wet-stages.ts';
import { stampUniformLayout, stampUniformWriter } from './stamp-uniform-layout.ts';

const WORKGROUP = 8;

/** Coverage below which a pixel is paper, not paint, and above which it's wholly paint: a wash's faintest film still counts. */
const DOMAIN_COVERAGE = [0.01, 0.06] as const;

/** The paper's grain, as a Gaussian's sigma in pixels: a hole in the paint this fine is closed, and grows no rim. */
const GRAIN_SIGMA = 2.5;

/** How far in from the edge, px, its hardness compares the paint's coverage: just inside it, and past a soft brush's rim. */
const EDGE_DEPTHS = [4, 14] as const;

/** The jump flood's first step, px: every pixel within the widest band finds its nearest edge. */
const FLOOD_FIRST_STEP = 2 ** Math.ceil(Math.log2(STAMP_DRYING_RIM_MOST_BAND));

/**
 * A wash's rim: its wettest grid's lattice, size and first value in the grid buffer; the pixels it works over; its
 * medium's spread and damp, its brushes' mean diameter; its line's width; the gathering kernel's sigma, reach and sum;
 * and the seed its line's unevenness is drawn from.
 */
const RIM = stampUniformLayout('Rim', [
  ['lattice', 'vec4f'], ['size', 'vec2u'], ['first', 'u32'], ['seed', 'u32'], ['origin', 'vec2u'], ['extent', 'vec2u'],
  ['spread', 'f32'], ['damp', 'f32'], ['diameter', 'f32'], ['width', 'f32'], ['sigma', 'f32'], ['reach', 'u32'], ['norm', 'f32'],
]);

const PRELUDE = /* wgsl */ `
${RIM.wgsl}
@group(0) @binding(0) var<uniform> u: Rim;
// Scratch textures hold the largest box, so a pixel's texel there is its place in the box.
fn local(p: vec2i) -> vec2i { return p - vec2i(u.origin); }
fn inside(p: vec2i) -> bool { return all(p >= vec2i(u.origin)) && all(p < vec2i(u.origin + u.extent)); }
// The pixel an invocation works on, or none past the box.
fn pixelOf(id: vec3u) -> vec2i { return select(vec2i(-1), vec2i(u.origin + id.xy), all(id.xy < u.extent)); }
fn kernelAt(d: i32) -> f32 { return exp(-f32(d * d) / (2.0 * u.sigma * u.sigma)) / u.norm; }
const GRAIN_REACH = ${Math.ceil(3 * GRAIN_SIGMA)};
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

// The edge's seeds: paper that's paper at the grain's scale too, so a hole finer than the grain is no edge. A seed
// holds its own pixel; any other pixel, none (-1).
const SEEDS_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var domain: texture_2d<f32>;
@group(0) @binding(2) var grainRows: texture_2d<f32>;
@group(0) @binding(3) var seeds: texture_storage_2d<rg32float, write>;
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
  let paper = textureLoad(domain, local(p), 0).r < 0.5 && sum / weight < 0.5;
  textureStore(seeds, local(p), select(vec4f(-1.0), vec4f(vec2f(p), 0.0, 0.0), paper));
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

// Each pixel's line and take, from its distance to the edge and how wet the wash was there.
const WEIGHTS_WGSL = /* wgsl */ `${PRELUDE}
${STAMP_DRYING_RIM_WGSL}
${PAINT_PAPER_WGSL}
@group(0) @binding(1) var<storage, read> grid: array<f32>;
${STAMP_GRID_AT_WGSL}
@group(0) @binding(2) var domain: texture_2d<f32>;
@group(0) @binding(3) var seeds: texture_2d<f32>;
@group(0) @binding(4) var layer: texture_2d_array<f32>;
@group(0) @binding(5) var weights: texture_storage_2d<rg32float, write>;
// The paint's coverage \`depth\` px in from the edge point \`seed\`, toward \`p\`, bilinear (a seed steps a pixel
// at a time along a slanted edge, and a nearest read there would chequer the band), held to the box.
fn coverageIn(seed: vec2f, toward: vec2f, depth: f32) -> f32 {
  let at = clamp(seed + toward * depth, vec2f(u.origin), vec2f(u.origin + u.extent) - 1.001);
  let i = vec2i(floor(at));
  let f = at - floor(at);
  let a = textureLoad(layer, i, 0, 0).x;
  let b = textureLoad(layer, i + vec2i(1, 0), 0, 0).x;
  let c = textureLoad(layer, i + vec2i(0, 1), 0, 0).x;
  let e = textureLoad(layer, i + vec2i(1, 1), 0, 0).x;
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  let paint = textureLoad(domain, local(p), 0).r;
  let seed = textureLoad(seeds, local(p), 0).xy;
  if (paint <= 0.0 || seed.x < 0.0) { textureStore(weights, local(p), vec4f(0.0)); return; }
  let d = distance(seed, vec2f(p));
  // Every pixel judges its nearest stretch of edge alike, from the same two points along the way in.
  let toward = select(vec2f(0.0), (vec2f(p) - seed) / d, d > 0.5);
  let wetShare = dryingRimWetShare(gridAt(vec2f(p) + 0.5, u.lattice.xyz, u.size, u.first), u.damp);
  let band = dryingRimBand(u.spread, u.diameter, wetShare);
  // The line wavers in width and strength along the edge, by noise at the edge point (so across the band alike) in
  // the painting's own pixels, keyed to the wash's seed.
  let width = u.width * (0.6 + 0.8 * paintValueNoise(seed.x / 6.0, seed.y / 6.0, u.seed));
  let strength = 0.3 + 0.7 * paintValueNoise(seed.x / 40.0, seed.y / 40.0, u.seed ^ 0x9e3779u);
  // An edge pixel the paint only partly covers takes its share of the line, so the line keeps the paint's edge.
  let edgeCover = coverageIn(seed, toward, ${EDGE_DEPTHS[0]}.0);
  let covered = clamp(textureLoad(layer, p, 0, 0).x / max(edgeCover, 1e-3), 0.0, 1.0);
  let line = paint * covered * dryingRimLine(d, width);
  let hardness = dryingRimHardness(edgeCover, coverageIn(seed, toward, ${EDGE_DEPTHS[1]}.0));
  let take = paint * hardness * dryingRimDraw(d, band, u.width) * dryingRimTake(u.spread, wetShare, strength);
  textureStore(weights, local(p), vec4f(line, take, 0.0, 0.0));
}`;

// The line blurred along rows by the gathering kernel: half of each giver's normaliser.
const NORM_ROWS_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var weights: texture_2d<f32>;
@group(0) @binding(2) var normRows: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  var sum = 0.0;
  for (var d = -i32(u.reach); d <= i32(u.reach); d++) {
    let q = p + vec2i(d, 0);
    if (inside(q)) { sum += kernelAt(d) * textureLoad(weights, local(q), 0).x; }
  }
  textureStore(normRows, local(p), vec4f(sum));
}`;

// Each giver's normaliser: the line within its reach, by the kernel. A giver with no line in reach gives nothing.
const NORM_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var normRows: texture_2d<f32>;
@group(0) @binding(2) var norm: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  var sum = 0.0;
  for (var d = -i32(u.reach); d <= i32(u.reach); d++) {
    let q = p + vec2i(0, d);
    if (inside(q)) { sum += kernelAt(d) * textureLoad(normRows, local(q), 0).r; }
  }
  textureStore(norm, local(p), vec4f(sum));
}`;

const GIVES_WGSL = /* wgsl */ `
const LEAST_NORM = 1e-5;
// The share of its amounts pixel \`q\` gives, over its normaliser: none where no line is in reach.
fn givenShare(q: vec2i) -> f32 {
  let n = textureLoad(norm, local(q), 0).r;
  return select(0.0, textureLoad(weights, local(q), 0).y / n, n > LEAST_NORM);
}`;

const pulledRowsWgsl = (layers: number) => /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var layer: texture_2d_array<f32>;
@group(0) @binding(2) var weights: texture_2d<f32>;
@group(0) @binding(3) var norm: texture_2d<f32>;
@group(0) @binding(4) var pulledRows: texture_storage_2d_array<rgba32float, write>;
${GIVES_WGSL}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  var pulled: array<vec4f, ${layers}>;
  for (var d = -i32(u.reach); d <= i32(u.reach); d++) {
    let q = p + vec2i(d, 0);
    if (!inside(q)) { continue; }
    let w = kernelAt(d) * givenShare(q);
    if (w <= 0.0) { continue; }
    for (var l = 0; l < ${layers}; l++) { pulled[l] += w * textureLoad(layer, q, l, 0); }
  }
  for (var l = 0; l < ${layers}; l++) { textureStore(pulledRows, local(p), l, pulled[l]); }
}`;

// The exchange, written back to the pigment channels alone.
const rimWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}
${STAMP_DRYING_RIM_WGSL}
${movedWgsl}
@group(0) @binding(1) var layer: texture_storage_2d_array<rgba16float, read_write>;
@group(0) @binding(2) var weights: texture_2d<f32>;
@group(0) @binding(3) var norm: texture_2d<f32>;
@group(0) @binding(4) var pulledRows: texture_2d_array<f32>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  let w = textureLoad(weights, local(p), 0).xy;
  let take = select(0.0, w.y, textureLoad(norm, local(p), 0).r > 1e-5);
  if (w.x <= 0.0 && take <= 0.0) { return; }
  var pulled: array<vec4f, ${layers}>;
  if (w.x > 0.0) {
    for (var d = -i32(u.reach); d <= i32(u.reach); d++) {
      let q = p + vec2i(0, d);
      if (!inside(q)) { continue; }
      let k = kernelAt(d);
      for (var l = 0; l < ${layers}; l++) { pulled[l] += k * textureLoad(pulledRows, local(q), l, 0); }
    }
  }
  for (var l = 0; l < ${layers}; l++) {
    let was = textureLoad(layer, p, l);
    textureStore(layer, p, l, mix(was, dryingRimExchange(was, take, w.x, pulled[l]), washPigmentMask(u32(l))));
  }
}`;

/** The pixels `grid` spans, within the painting. */
function gridBox(grid: StampGrid, width: number, height: number): StampPixelBox {
  const x = Math.max(0, grid.x0), y = Math.max(0, grid.y0);
  return { x, y, w: Math.min(width, grid.x0 + (grid.columns - 1) * grid.cell) - x, h: Math.min(height, grid.y0 + (grid.rows - 1) * grid.cell) - y };
}

/** A wash's rim as loaded: its wettest grid's place in the grid buffer, its box, uniform and whether it rims at all. */
type LoadedRim = { grid: StampGrid; first: number; box: StampPixelBox; uniform: GPUBuffer; layers: number };

function loadDryingRim({ device, painting, medium, wetness, width, height, layer, wash }: StampWetStageContext): StampLoadedWetStage {
  const { spread, damp } = medium.wetting;
  const washes = painting.groups.flatMap((group) => group.passes).filter((pass) => pass.kind === 'wash');
  if (spread <= 0 || !washes.length) return { encode: () => null };

  const rims = new Map<CompiledStampPass, LoadedRim>(), values: number[] = [];
  for (const pass of washes) {
    const grid = stampWashWettest(pass, wetness);
    const painted = stampPassDeposits(pass).filter((deposit) => deposit.action.kind === 'paint');
    if (!grid || !painted.length) continue;
    const wetShare = stampDryingRimWetShare(Math.max(...grid.values), damp);
    const diameter = painted.reduce((sum, deposit) => sum + deposit.diameter, 0) / painted.length;
    const band = stampDryingRimBand(spread, diameter, wetShare);
    // A band under a pixel or two is a rim no one sees: damp brushwork, or a medium that barely spreads.
    if (band < 1.5) continue;
    const box = gridBox(grid, width, height);
    if (box.w <= 0 || box.h <= 0) continue;
    const sigma = band / 2, reach = Math.ceil(3 * sigma);
    let norm = 0;
    for (let d = -reach; d <= reach; d++) norm += Math.exp(-(d * d) / (2 * sigma * sigma));
    const words = new ArrayBuffer(RIM.words * 4);
    const put = stampUniformWriter(RIM, { floats: new Float32Array(words), ints: new Int32Array(words), words: new Uint32Array(words) });
    put('lattice', [grid.x0, grid.y0, grid.cell, 0]);
    put('size', [grid.columns, grid.rows]);
    put('first', values.length);
    put('seed', paintPigmentSeed(pass.id));
    put('origin', [box.x, box.y]);
    put('extent', [box.w, box.h]);
    put('spread', spread);
    put('damp', damp);
    put('diameter', diameter);
    put('width', Math.min(2.2, 0.8 + band / 20));
    put('sigma', sigma);
    put('reach', reach);
    put('norm', norm);
    const uniform = device.createBuffer({ size: RIM.words * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, words);
    rims.set(pass, { grid, first: values.length, box, uniform, layers: wash.layersOf(painted[0]) });
    values.push(...grid.values);
  }
  if (!rims.size) return { encode: () => null };

  const grid = device.createBuffer({ size: values.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(grid, 0, new Float32Array(values));
  const steps: GPUBuffer[] = [];
  for (let step = FLOOD_FIRST_STEP; step >= 1; step /= 2) {
    const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, new Uint32Array([step, 0, 0, 0]));
    steps.push(buffer);
  }

  const layers = layer.layers.length;
  const most = { w: Math.max(...[...rims.values()].map(({ box }) => box.w)), h: Math.max(...[...rims.values()].map(({ box }) => box.h)) };
  const scratch = (format: GPUTextureFormat, depth = 1) =>
    device.createTexture({ size: [most.w, most.h, depth], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
      .createView({ dimension: depth > 1 ? '2d-array' : '2d' });
  // A one-layer array still binds as an array.
  const pulledRows = device.createTexture({ size: [most.w, most.h, layers], format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
    .createView({ dimension: '2d-array' });
  const domain = scratch('r32float'), grainRows = scratch('r32float'), normRows = scratch('r32float'), norm = scratch('r32float');
  const seeds = [scratch('rg32float'), scratch('rg32float')], weights = scratch('rg32float');
  const pipeline = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'run' } });
  const passes = {
    domain: pipeline(DOMAIN_WGSL), grainRows: pipeline(GRAIN_ROWS_WGSL), seeds: pipeline(SEEDS_WGSL), flood: pipeline(FLOOD_WGSL),
    weights: pipeline(WEIGHTS_WGSL), normRows: pipeline(NORM_ROWS_WGSL), norm: pipeline(NORM_WGSL),
    pulledRows: pipeline(pulledRowsWgsl(layers)),
  };
  // Each group's own layer count places its open share.
  const rimPasses = new Map([...new Set([...rims.values()].map((rim) => rim.layers))].map((n) => [n, pipeline(rimWgsl(n, wash.movedWgsl(n)))]));

  const encode = (encoder: GPUCommandEncoder, { box, uniform, layers: groupLayers }: LoadedRim): StampPixelBox => {
    const dispatch = (pass: GPUComputePipeline, resources: GPUBindingResource[]) => {
      const compute = encoder.beginComputePass();
      compute.setPipeline(pass);
      compute.setBindGroup(0, device.createBindGroup({ layout: pass.getBindGroupLayout(0), entries: resources.map((resource, binding) => ({ binding, resource })) }));
      compute.dispatchWorkgroups(Math.ceil(box.w / WORKGROUP), Math.ceil(box.h / WORKGROUP));
      compute.end();
    };
    dispatch(passes.domain, [{ buffer: uniform }, { buffer: grid }, layer.view, domain]);
    dispatch(passes.grainRows, [{ buffer: uniform }, domain, grainRows]);
    dispatch(passes.seeds, [{ buffer: uniform }, domain, grainRows, seeds[0]]);
    steps.forEach((step, k) => dispatch(passes.flood, [{ buffer: uniform }, { buffer: step }, seeds[k % 2], seeds[(k + 1) % 2]]));
    dispatch(passes.weights, [{ buffer: uniform }, { buffer: grid }, domain, seeds[steps.length % 2], layer.view, weights]);
    dispatch(passes.normRows, [{ buffer: uniform }, weights, normRows]);
    dispatch(passes.norm, [{ buffer: uniform }, normRows, norm]);
    dispatch(passes.pulledRows, [{ buffer: uniform }, layer.view, weights, norm, pulledRows]);
    dispatch(rimPasses.get(groupLayers)!, [{ buffer: uniform }, layer.view, weights, norm, pulledRows]);
    return box;
  };
  return {
    encode: (encoder: GPUCommandEncoder, moment: StampWetStageMoment) => {
      const rim = moment.kind === 'wash' ? rims.get(moment.pass) : undefined;
      return rim ? encode(encoder, rim) : null;
    },
  };
}

/** Pigment gathered at a wash's edge as it dries, once each wash is done. */
export const STAMP_DRYING_RIM_STAGE: StampWetStage = { id: 'drying-rim', after: 'wash', load: loadDryingRim };
