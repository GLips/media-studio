// stamp-wet-bloom.ts: the wet stage for blooms and backruns (models/stamp-wet-bloom.ts). A wash deposit's surplus
// water spreads (a Gaussian, rows then columns), stalls at a ragged front, and the paint it loosens inside is carried
// there, over the box the stage's declared reach gives it.
//
// Carrying is a normalised scatter: a pixel sends what it loosens to the band pixels within the transport kernel, in
// proportion to their weight, so what one gives up is exactly what the band gains, per pigment.
//
// Negative space: the spreading water isn't written back into the wash's wetness, so later deposits don't see it.

import { randomSeedFromKey } from '#lib/picture/motion/models/random.ts';
import {
  STAMP_BLOOM_BAND_WIDTH, STAMP_BLOOM_CARRY_SPREAD, STAMP_WET_BLOOM_WGSL, stampBloomSizing,
} from '../models/stamp-wet-bloom.ts';
import { STAMP_GRID_AT_WGSL, type StampGrid } from '../models/stamp-region.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe.ts';
import type { StampWetStage, StampWetStageContext, StampWetStageMoment } from './stamp-wet-stages.ts';
import { stampUniformLayout, stampUniformWriter } from './stamp-uniform-layout.ts';

const WORKGROUP = 8;

/**
 * A pixel gives its paint up fully only as near a front as `STAMP_BLOOM_SEND_FLOOR` of a straight front's reach
 * (the band blurred by the transport kernel), less further out: a pixel with a sliver of front in reach would pour
 * all it loosens into that sliver.
 */
const STAMP_BLOOM_SEND_FLOOR = 0.2;

/**
 * A bloom: its landing's grids, the paper before it (wetness, workable) and after (wetness), by lattice, size and
 * where each starts in the grid buffer; the box it works over; the noise's seed; how strongly it blooms; the water's Gaussian and the transport's (sigma, reach, the 1-D kernel's
 * sum); the send floor.
 */
const BLOOM = stampUniformLayout('Bloom', [
  ['lattice', 'vec4f'], ['size', 'vec2u'], ['wetnessFirst', 'u32'], ['workableFirst', 'u32'], ['afterFirst', 'u32'],
  ['origin', 'vec2u'], ['extent', 'vec2u'],
  ['seed', 'u32'], ['drive', 'f32'], ['sigma', 'f32'],
  ['reach', 'u32'], ['norm', 'f32'], ['carrySigma', 'f32'], ['carryReach', 'u32'],
  ['carryNorm', 'f32'], ['sendFloor', 'f32'],
]);

// Scratch textures are indexed from the bloom's origin, so they're only as big as the largest bloom.
const PRELUDE = /* wgsl */ `
${BLOOM.wgsl}
@group(0) @binding(0) var<uniform> u: Bloom;
fn waterKernel(d: i32) -> f32 { return exp(-f32(d * d) / (2.0 * u.sigma * u.sigma)) / u.norm; }
fn carryKernel(d: i32) -> f32 { return exp(-f32(d * d) / (2.0 * u.carrySigma * u.carrySigma)) / u.carryNorm; }
fn inBox(local: vec2i) -> bool { return all(local >= vec2i(0)) && all(local < vec2i(u.extent)); }
// The scratch texel an invocation works on, or none past the bloom's extent.
fn localOf(id: vec3u) -> vec2i { return select(vec2i(-1), vec2i(id.xy), all(id.xy < u.extent)); }
`;

const GRID_WGSL = /* wgsl */ `
@group(0) @binding(1) var<storage, read> grid: array<f32>;
${STAMP_GRID_AT_WGSL}
fn workableAt(p: vec2i) -> f32 { return gridAt(vec2f(p) + 0.5, u.lattice.xyz, u.size, u.workableFirst); }
fn wetnessAfterAt(p: vec2i) -> f32 { return gridAt(vec2f(p) + 0.5, u.lattice.xyz, u.size, u.afterFirst); }
// Where the paper round \`p\` stands, at the lattice's own resolution rather than bilinearly: (the wettest it was, of the
// lattice points a cell round p's own cell, and the least workable of p's cell's corners). A cell half under a wet
// brush and half dry averages to "damp", and a bloom read from it would ring every stroke's edge.
fn paperThroughout(p: vec2i) -> vec2f {
  let uv = clamp((vec2f(p) + 0.5 - u.lattice.xy) / u.lattice.z, vec2f(0.0), vec2f(u.size) - 1.0);
  let cell = vec2i(min(vec2u(floor(uv)), u.size - 2u));
  var wettest = 0.0;
  var workable = 1.0;
  for (var j = -1; j <= 2; j++) {
    for (var i = -1; i <= 2; i++) {
      let at = vec2u(clamp(cell + vec2i(i, j), vec2i(0), vec2i(u.size) - 1));
      wettest = max(wettest, grid[u.wetnessFirst + at.y * u.size.x + at.x]);
      if (i >= 0 && i <= 1 && j >= 0 && j <= 1) { workable = min(workable, grid[u.workableFirst + at.y * u.size.x + at.x]); }
    }
  }
  return vec2f(wettest, workable);
}
`;

// The surplus water the deposit left, blurred along rows. It's where the wetness record puts the brush's water (its
// stamps' discs), not the paint's coverage: a soft brush's single stamp lays little paint but all its water.
const SURPLUS_ROWS_WGSL = /* wgsl */ `${PRELUDE}${GRID_WGSL}
${STAMP_WET_BLOOM_WGSL}
@group(0) @binding(2) var rows: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  var sum = 0.0;
  for (var d = -i32(u.reach); d <= i32(u.reach); d++) {
    let q = local + vec2i(d, 0);
    let p = q + vec2i(u.origin);
    if (!inBox(q)) { continue; }
    let paper = paperThroughout(p);
    sum += waterKernel(d) * bloomSurplus(paper.x, wetnessAfterAt(p), paper.y);
  }
  textureStore(rows, local, vec4f(sum));
}`;

const WATER_COLUMNS_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var rows: texture_2d<f32>;
@group(0) @binding(2) var water: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  var sum = 0.0;
  for (var d = -i32(u.reach); d <= i32(u.reach); d++) {
    let q = local + vec2i(0, d);
    if (inBox(q)) { sum += waterKernel(d) * textureLoad(rows, q, 0).r; }
  }
  textureStore(water, local, vec4f(sum));
}`;

// Where each pixel stands to the front: its band weight (x) and the share of its paint loosened (y), only where paint
// may land (the footprint's g: never under masking fluid, nor outside \`within\` or the clip) and the paper is wet.
const FRONT_WGSL = /* wgsl */ `${PRELUDE}${GRID_WGSL}
${STAMP_WET_BLOOM_WGSL}
@group(0) @binding(2) var footprint: texture_2d<f32>;
@group(0) @binding(3) var water: texture_2d<f32>;
@group(0) @binding(4) var front: texture_storage_2d<rg32float, write>;
fn waterAt(local: vec2i) -> f32 { return textureLoad(water, clamp(local, vec2i(0), vec2i(u.extent) - 1), 0).r; }
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  let p = local + vec2i(u.origin);
  let slope = 0.5 * length(vec2f(waterAt(local + vec2i(1, 0)) - waterAt(local - vec2i(1, 0)), waterAt(local + vec2i(0, 1)) - waterAt(local - vec2i(0, 1))));
  let shift = bloomFrontShift(vec2f(p) + 0.5, u.seed, u.sigma);
  let d = bloomFrontDistance(waterAt(local), slope, shift, u.sigma);
  let allowed = clamp(textureLoad(footprint, p, 0).g, 0.0, 1.0);
  let wet = wetnessAfterAt(p);
  let band = bloomBand(d, bloomFrontLine(vec2f(p) + 0.5, u.seed, u.sigma)) * allowed * smoothstep(0.0, 0.1, wet);
  textureStore(front, local, vec4f(band, bloomLoosened(d, workableAt(p), u.drive) * allowed, 0.0, 0.0));
}`;

const BAND_ROWS_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var front: texture_2d<f32>;
@group(0) @binding(2) var rows: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  var sum = 0.0;
  for (var d = -i32(u.carryReach); d <= i32(u.carryReach); d++) {
    let q = local + vec2i(d, 0);
    if (inBox(q)) { sum += carryKernel(d) * textureLoad(front, q, 0).x; }
  }
  textureStore(rows, local, vec4f(sum));
}`;

// Each pixel's send (x): the share of its paint it gives up (y), over the band within its reach, so that the band,
// gathering what's sent through the same kernel, gains exactly what's given up.
const SEND_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var front: texture_2d<f32>;
@group(0) @binding(2) var rows: texture_2d<f32>;
@group(0) @binding(3) var send: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  var reach = 0.0;
  for (var d = -i32(u.carryReach); d <= i32(u.carryReach); d++) {
    let q = local + vec2i(0, d);
    if (inBox(q)) { reach += carryKernel(d) * textureLoad(rows, q, 0).r; }
  }
  let given = textureLoad(front, local, 0).y * smoothstep(0.0, u.sendFloor, reach);
  textureStore(send, local, vec4f(select(0.0, given / reach, reach > 1e-12 && given > 0.0), given, 0.0, 0.0));
}`;

// What each pixel sends, per pigment (coverage's channel sends nothing), blurred along rows.
const sentRowsWgsl = (layers: number) => /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var layer: texture_2d_array<f32>;
@group(0) @binding(2) var send: texture_2d<f32>;
@group(0) @binding(3) var sentRows: texture_storage_2d_array<rgba32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  var sent: array<vec4f, ${layers}>;
  for (var d = -i32(u.carryReach); d <= i32(u.carryReach); d++) {
    let q = local + vec2i(d, 0);
    if (!inBox(q)) { continue; }
    let w = carryKernel(d) * textureLoad(send, q, 0).x;
    if (w <= 0.0) { continue; }
    for (var l = 0; l < ${layers}; l++) { sent[l] += w * textureLoad(layer, q + vec2i(u.origin), l, 0); }
  }
  sent[0].x = 0.0;
  for (var l = 0; l < ${layers}; l++) { textureStore(sentRows, local, l, sent[l]); }
}`;

// The carry, written back: each pixel keeps what it didn't give up and gains what its band weight gathers. Paint
// carried onto bare wet paper covers it as thinly as it lies.
const landWgsl = (layers: number) => /* wgsl */ `${PRELUDE}
${STAMP_WET_BLOOM_WGSL}
@group(0) @binding(1) var layer: texture_storage_2d_array<rgba16float, read_write>;
@group(0) @binding(2) var front: texture_2d<f32>;
@group(0) @binding(3) var send: texture_2d<f32>;
@group(0) @binding(4) var sentRows: texture_2d_array<f32>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  let band = textureLoad(front, local, 0).x;
  let given = textureLoad(send, local, 0).y;
  if (band <= 0.0 && given <= 0.0) { return; }
  var gathered: array<vec4f, ${layers}>;
  if (band > 0.0) {
    for (var d = -i32(u.carryReach); d <= i32(u.carryReach); d++) {
      let q = local + vec2i(0, d);
      if (!inBox(q)) { continue; }
      let k = carryKernel(d);
      for (var l = 0; l < ${layers}; l++) { gathered[l] += k * textureLoad(sentRows, q, l, 0); }
    }
  }
  let p = local + vec2i(u.origin);
  var received = 0.0;
  for (var l = 0; l < ${layers}; l++) { received += band * dot(gathered[l], vec4f(1.0)); }
  for (var l = 0; l < ${layers}; l++) {
    let was = textureLoad(layer, p, l);
    var now = bloomLand(was, given, band, gathered[l]);
    if (l == 0) { now.x = max(was.x, clamp(4.0 * received, 0.0, 1.0)); }
    textureStore(layer, p, l, now);
  }
}`;

/** A landing's bloom, sized as the painting loads. */
type StampBloomPlan = { wetnessFirst: number; workableFirst: number; afterFirst: number; window: StampPixelBox; sigma: number; drive: number; seed: number; lattice: StampGrid };

/** The pixels a grid's points span. */
const gridSpan = ({ x0, y0, cell, columns, rows }: StampGrid): StampPixelBox => ({ x: x0, y: y0, w: (columns - 1) * cell + 1, h: (rows - 1) * cell + 1 });

/**
 * The room a bloom has, px: how far past `deposit`'s stamps its landing's wetness `window` reaches, the least on any
 * side but where the canvas ends. Its front must stall inside it, so the reach is clamped to it: a landing's window is
 * its stamps and a cell round them (stamp-wetness.ts), and the paper further out isn't known.
 */
function stampBloomRoom(deposit: CompiledStampDeposit, window: StampPixelBox, width: number, height: number): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { x, y, diameter } of [...deposit.stamps, ...deposit.dualStamps]) {
    x0 = Math.min(x0, x - diameter / 2); y0 = Math.min(y0, y - diameter / 2); x1 = Math.max(x1, x + diameter / 2); y1 = Math.max(y1, y + diameter / 2);
  }
  if (deposit.kind === 'flood') {
    const { box } = deposit.flood;
    x0 = Math.min(x0, box.x0); y0 = Math.min(y0, box.y0); x1 = Math.max(x1, box.x1); y1 = Math.max(y1, box.y1);
  }
  const sides = [
    window.x > 0 ? x0 - window.x : Infinity, window.y > 0 ? y0 - window.y : Infinity,
    window.x + window.w < width ? window.x + window.w - x1 : Infinity, window.y + window.h < height ? window.y + window.h - y1 : Infinity,
  ];
  return Math.max(0, Math.min(...sides));
}

/** How many of its sigmas past its source a bloom's front stands at most, its lobes included. */
const STAMP_BLOOM_FRONT_SIGMAS = 2;

/** How far past its deposit a bloom works, px: its water's Gaussian, three sigmas out. */
const bloomReach = (sigma: number) => Math.ceil(3 * sigma);

const kernelSum = (sigma: number, reach: number) => {
  let sum = 0;
  for (let d = -reach; d <= reach; d++) sum += Math.exp(-(d * d) / (2 * sigma * sigma));
  return sum;
};

const intersect = (a: StampPixelBox, b: StampPixelBox): StampPixelBox | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};

function loadBloom({ device, medium, wetness, width, height, layer, footprint }: StampWetStageContext) {
  const { flow } = medium.wetting;
  if (flow <= 0) return { encode: () => null };
  const canvas = { x: 0, y: 0, w: width, h: height };
  const plans = new Map<CompiledStampDeposit, StampBloomPlan>(), values: number[] = [];
  for (const [deposit, landing] of wetness.landings) {
    const sized = deposit.action.kind === 'lift' ? null : stampBloomSizing(landing, flow, deposit.diameter);
    const window = sized && intersect(gridSpan(landing.before.wetness), canvas);
    if (!sized || !window) continue;
    const sigma = Math.min(sized.sigma, stampBloomRoom(deposit, window, width, height) / STAMP_BLOOM_FRONT_SIGMAS);
    if (sigma < 0.5) continue;
    const wetnessFirst = values.length;
    values.push(...landing.before.wetness.values);
    const workableFirst = values.length;
    values.push(...landing.before.workable.values);
    const afterFirst = values.length;
    values.push(...landing.after.wetness.values);
    plans.set(deposit, { drive: sized.drive, sigma, wetnessFirst, workableFirst, afterFirst, window, seed: randomSeedFromKey(deposit.id), lattice: landing.before.wetness });
  }
  if (!plans.size) return { encode: () => null };

  const grid = device.createBuffer({ size: values.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(grid, 0, new Float32Array(values));
  const uniforms = new Map([...plans.keys()].map((deposit) => [deposit, device.createBuffer({ size: BLOOM.words * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })]));

  const most = [...plans.values()].reduce((size, { window }) => ({ w: Math.max(size.w, window.w), h: Math.max(size.h, window.h) }), { w: 1, h: 1 });
  const layers = layer.layers.length;
  const scratch = (format: GPUTextureFormat, depth?: number) =>
    device.createTexture({ size: [most.w, most.h, depth ?? 1], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
      .createView({ dimension: depth === undefined ? '2d' : '2d-array' });
  const rows = scratch('r32float'), water = scratch('r32float'), front = scratch('rg32float'), send = scratch('rg32float');
  const sentRows = scratch('rgba32float', layers);
  const pipeline = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'run' } });
  const passes = {
    surplusRows: pipeline(SURPLUS_ROWS_WGSL), waterColumns: pipeline(WATER_COLUMNS_WGSL), front: pipeline(FRONT_WGSL),
    bandRows: pipeline(BAND_ROWS_WGSL), send: pipeline(SEND_WGSL), sentRows: pipeline(sentRowsWgsl(layers)), land: pipeline(landWgsl(layers)),
  };

  const encode = (encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, landed: StampPixelBox): StampPixelBox | null => {
    const plan = plans.get(deposit)!, { sigma, lattice } = plan;
    const reach = bloomReach(sigma);
    const box = intersect(landed, plan.window);
    if (!box) return null;
    const carrySigma = STAMP_BLOOM_CARRY_SPREAD * sigma, carryReach = Math.min(Math.ceil(3 * carrySigma), Math.max(box.w, box.h));
    const words = new ArrayBuffer(BLOOM.words * 4);
    const put = stampUniformWriter(BLOOM, { floats: new Float32Array(words), ints: new Int32Array(words), words: new Uint32Array(words) });
    put('lattice', [lattice.x0, lattice.y0, lattice.cell, 0]);
    put('size', [lattice.columns, lattice.rows]);
    put('wetnessFirst', plan.wetnessFirst);
    put('workableFirst', plan.workableFirst);
    put('afterFirst', plan.afterFirst);
    put('origin', [box.x, box.y]);
    put('extent', [box.w, box.h]);
    put('seed', plan.seed);
    put('drive', plan.drive);
    put('sigma', sigma);
    put('reach', reach);
    put('norm', kernelSum(sigma, reach));
    put('carrySigma', carrySigma);
    put('carryReach', carryReach);
    put('carryNorm', kernelSum(carrySigma, carryReach));
    put('sendFloor', (STAMP_BLOOM_SEND_FLOOR * STAMP_BLOOM_BAND_WIDTH) / (Math.sqrt(2 * Math.PI) * carrySigma));
    const uniform = uniforms.get(deposit)!;
    device.queue.writeBuffer(uniform, 0, words);

    const dispatch = (pass: GPUComputePipeline, resources: GPUBindingResource[]) => {
      const compute = encoder.beginComputePass();
      compute.setPipeline(pass);
      compute.setBindGroup(0, device.createBindGroup({ layout: pass.getBindGroupLayout(0), entries: resources.map((resource, binding) => ({ binding, resource })) }));
      compute.dispatchWorkgroups(Math.ceil(box.w / WORKGROUP), Math.ceil(box.h / WORKGROUP));
      compute.end();
    };
    const u = { buffer: uniform }, g = { buffer: grid };
    dispatch(passes.surplusRows, [u, g, rows]);
    dispatch(passes.waterColumns, [u, rows, water]);
    dispatch(passes.front, [u, g, footprint.view, water, front]);
    dispatch(passes.bandRows, [u, front, rows]);
    dispatch(passes.send, [u, front, rows, send]);
    dispatch(passes.sentRows, [u, layer.view, send, sentRows]);
    dispatch(passes.land, [u, layer.view, front, send, sentRows]);
    return box;
  };
  return {
    reach: (deposit: CompiledStampDeposit) => { const plan = plans.get(deposit); return plan ? bloomReach(plan.sigma) : 0; },
    encode: (encoder: GPUCommandEncoder, moment: StampWetStageMoment) =>
      moment.kind === 'deposit' && plans.has(moment.deposit) ? encode(encoder, moment.deposit, moment.box) : null,
  };
}

/** Blooms and backruns, after each wash deposit that lands wetter than the damp paint round it. */
export const STAMP_BLOOM_STAGE: StampWetStage = { id: 'bloom', after: 'deposit', load: loadBloom };
