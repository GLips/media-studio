// stamp-wet-bloom.ts: the wet stage for blooms and backruns (models/stamp-wet-bloom.ts). A wash deposit's surplus
// water spreads (a Gaussian, rows then columns), stalls at a ragged front, and the paint it loosens inside is carried
// there, over the deposit's box, which the stage's reach widens.
//
// Carrying is a normalised scatter: a pixel sends what it loosens to the band pixels within the transport kernel, in
// proportion to their weight, so what one gives up is exactly what the band gains, per pigment.
//
// Negative space: the spreading water isn't written back into the wash's wetness, so later deposits don't see it.

import { STAMP_BLOOM_BAND_WIDTH, STAMP_BLOOM_CARRY_SPREAD, STAMP_WET_BLOOM_WGSL, stampBloomReach, stampBloomSizing } from '../models/stamp-wet-bloom.ts';
import { STAMP_WET_LIFT_WGSL } from '../models/stamp-wet-lift.ts';
import { STAMP_GRID_AT_WGSL } from '../models/stamp-region.ts';
import type { StampWetWindow } from '../models/stamp-wetness.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe.ts';
import type { StampLoadedWetStage, StampWetStage, StampWetStageContext, StampWetStageMoment } from './stamp-wet-stages.ts';
import { stampUniformLayout, stampUniformWriter } from './stamp-uniform-layout.ts';

const WORKGROUP = 8;

/**
 * A pixel gives its paint up fully only as near a front as `STAMP_BLOOM_SEND_FLOOR` of a straight front's reach
 * (the band blurred by the transport kernel), less further out: a pixel with a sliver of front in reach would pour
 * all it loosens into that sliver.
 */
const STAMP_BLOOM_SEND_FLOOR = 0.2;

/**
 * A bloom: its lattice; where its paper before starts in the painting's grids and its wetness after in the stage's;
 * its box; seed; drive; the medium's damp and shine (brushWater); the water's and the transport's Gaussians (sigma,
 * reach, the 1-D kernel's sum); the send floor.
 */
const BLOOM = stampUniformLayout('Bloom', [
  ['lattice', 'vec4f'], ['size', 'vec2u'], ['first', 'u32'], ['afterFirst', 'u32'],
  ['origin', 'vec2u'], ['extent', 'vec2u'],
  ['seed', 'u32'], ['drive', 'f32'], ['sigma', 'f32'], ['damp', 'f32'], ['shine', 'f32'],
  ['reach', 'u32'], ['norm', 'f32'], ['carrySigma', 'f32'], ['carryReach', 'u32'],
  ['carryNorm', 'f32'], ['sendFloor', 'f32'],
]);

// Scratch textures are indexed from the bloom's origin, so they're only as big as the largest box.
const PRELUDE = /* wgsl */ `
${BLOOM.wgsl}
@group(0) @binding(0) var<uniform> u: Bloom;
fn waterKernel(d: i32) -> f32 { return exp(-f32(d * d) / (2.0 * u.sigma * u.sigma)) / u.norm; }
fn carryKernel(d: i32) -> f32 { return exp(-f32(d * d) / (2.0 * u.carrySigma * u.carrySigma)) / u.carryNorm; }
fn inBox(local: vec2i) -> bool { return all(local >= vec2i(0)) && all(local < vec2i(u.extent)); }
// The scratch texel an invocation works on, or none past the bloom's extent.
fn localOf(id: vec3u) -> vec2i { return select(vec2i(-1), vec2i(id.xy), all(id.xy < u.extent)); }
`;

// The paper before the deposit is the painting's grid buffer (\`grid\`); its wetness after, which the painting doesn't
// keep, is the stage's own (\`after\`), laid out alike.
const GRID_WGSL = /* wgsl */ `
@group(0) @binding(1) var<storage, read> grid: array<f32>;
@group(0) @binding(2) var<storage, read> after: array<f32>;
${STAMP_GRID_AT_WGSL}
fn workableAt(p: vec2i) -> f32 { return gridAt(vec2f(p) + 0.5, u.lattice.xyz, u.size, u.first + u.size.x * u.size.y); }
fn wetnessAfterAt(p: vec2i) -> f32 {
  let uv = clamp((vec2f(p) + 0.5 - u.lattice.xy) / u.lattice.z, vec2f(0.0), vec2f(u.size) - 1.0);
  let cell = min(vec2u(floor(uv)), u.size - 2u);
  let f = uv - vec2f(cell);
  let at = u.afterFirst + cell.y * u.size.x + cell.x;
  return mix(mix(after[at], after[at + 1u], f.x), mix(after[at + u.size.x], after[at + u.size.x + 1u], f.x), f.y);
}
// Where the paper round \`p\` stands, at the lattice's own resolution rather than bilinearly: (the wettest it was, of the
// lattice points a cell round p's own cell, and the least workable of p's cell's corners). A cell half under a wet
// brush and half dry averages to "damp", and a bloom read from it would ring every stroke's edge.
fn paperThroughout(p: vec2i) -> vec2f {
  let uv = clamp((vec2f(p) + 0.5 - u.lattice.xy) / u.lattice.z, vec2f(0.0), vec2f(u.size) - 1.0);
  let cell = vec2i(min(vec2u(floor(uv)), u.size - 2u));
  let workableFirst = u.first + u.size.x * u.size.y;
  var wettest = 0.0;
  var workable = 1.0;
  for (var j = -1; j <= 2; j++) {
    for (var i = -1; i <= 2; i++) {
      let at = vec2u(clamp(cell + vec2i(i, j), vec2i(0), vec2i(u.size) - 1));
      wettest = max(wettest, grid[u.first + at.y * u.size.x + at.x]);
      if (i >= 0 && i <= 1 && j >= 0 && j <= 1) { workable = min(workable, grid[workableFirst + at.y * u.size.x + at.x]); }
    }
  }
  return vec2f(wettest, workable);
}
`;

// The surplus water the deposit left, per pixel. It's where the wetness record puts the brush's water (its stamps'
// discs), not the paint's coverage: a soft brush's single stamp lays little paint but all its water.
const SURPLUS_WGSL = /* wgsl */ `${PRELUDE}${GRID_WGSL}
${STAMP_WET_BLOOM_WGSL}
@group(0) @binding(3) var surplus: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  let p = local + vec2i(u.origin);
  let paper = paperThroughout(p);
  textureStore(surplus, local, vec4f(bloomSurplus(paper.x, wetnessAfterAt(p), paper.y, u.damp, u.shine)));
}`;

// The surplus spread along rows.
const WATER_ROWS_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var surplus: texture_2d<f32>;
@group(0) @binding(2) var rows: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  var sum = 0.0;
  for (var d = -i32(u.reach); d <= i32(u.reach); d++) {
    let q = local + vec2i(d, 0);
    if (inBox(q)) { sum += waterKernel(d) * textureLoad(surplus, q, 0).r; }
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

// Where each pixel stands to the front: its band weight (x) and the share of its paint loosened (y), as free as it is
// (workable, and open), only where paint may land (footprint g: never under fluid, outside \`within\` or the clip).
const frontWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}${GRID_WGSL}
${STAMP_WET_BLOOM_WGSL}
${STAMP_WET_LIFT_WGSL}
${movedWgsl}
@group(0) @binding(3) var footprint: texture_2d<f32>;
@group(0) @binding(4) var water: texture_2d<f32>;
@group(0) @binding(5) var front: texture_storage_2d<rg32float, write>;
@group(0) @binding(6) var layer: texture_2d_array<f32>;
fn waterAt(local: vec2i) -> f32 { return textureLoad(water, clamp(local, vec2i(0), vec2i(u.extent) - 1), 0).r; }
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  let p = local + vec2i(u.origin);
  let slope = 0.5 * length(vec2f(waterAt(local + vec2i(1, 0)) - waterAt(local - vec2i(1, 0)), waterAt(local + vec2i(0, 1)) - waterAt(local - vec2i(0, 1))));
  let shift = bloomFrontShift(vec2f(p) + 0.5, u.seed, u.sigma);
  let d = bloomFrontDistance(waterAt(local), slope, shift, u.sigma);
  let allowed = clamp(textureLoad(footprint, p, 0).g, 0.0, 1.0);
  let band = bloomBand(d, bloomFrontLine(vec2f(p) + 0.5, u.seed, u.sigma)) * allowed * smoothstep(0.0, 0.1, wetnessAfterAt(p));
  var held: array<vec4f, ${layers}>;
  for (var l = 0; l < ${layers}; l++) { held[l] = textureLoad(layer, p, l, 0); }
  let free = liftFree(workableAt(p), washOpen(held));
  textureStore(front, local, vec4f(band, bloomLoosened(d, free, u.drive) * allowed, 0.0, 0.0));
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

// What each pixel sends of its pigment channels, blurred along rows.
const sentRowsWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}
${movedWgsl}
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
    for (var l = 0; l < ${layers}; l++) { sent[l] += w * textureLoad(layer, q + vec2i(u.origin), l, 0) * washPigmentMask(u32(l)); }
  }
  for (var l = 0; l < ${layers}; l++) { textureStore(sentRows, local, l, sent[l]); }
}`;

// The carry, written back: each pixel keeps what it didn't give up and gains what its band weight gathers, in its
// pigment channels; the rest of it is the compositor's washMoved.
const landWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}
${STAMP_WET_BLOOM_WGSL}
${movedWgsl}
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
  var was: array<vec4f, ${layers}>;
  var now: array<vec4f, ${layers}>;
  for (var l = 0; l < ${layers}; l++) {
    was[l] = textureLoad(layer, p, l);
    now[l] = mix(was[l], bloomLand(was[l], given, band, gathered[l]), washPigmentMask(u32(l)));
  }
  let moved = washMoved(now, washPigmentTotal(was));
  for (var l = 0; l < ${layers}; l++) { textureStore(layer, p, l, moved[l]); }
}`;

type BloomPipelines = Record<'surplus' | 'waterRows' | 'waterColumns' | 'front' | 'bandRows' | 'send' | 'sentRows' | 'land', GPUComputePipeline>;
/** A landing's bloom, sized as the painting loads. */
type BloomPlan = { first: number; afterFirst: number; sigma: number; drive: number; lattice: StampWetWindow; pipelines: BloomPipelines; uniform: GPUBuffer };
/** A pipeline and what it's bound to, as one dispatch of a bloom runs it. */
type BloomStep = { pipeline: GPUComputePipeline; bindGroup: GPUBindGroup };
/**
 * The scratch textures, as big as the largest box reserved, and each plan's steps bound to them: a new set of
 * textures binds afresh.
 */
type BloomScratch = {
  w: number; h: number; textures: GPUTexture[]; steps: Map<BloomPlan, BloomStep[]>;
  surplus: GPUTextureView; rows: GPUTextureView; water: GPUTextureView; front: GPUTextureView; send: GPUTextureView; sentRows: GPUTextureView;
};

const kernelSum = (sigma: number, reach: number) => {
  let sum = 0;
  for (let d = -reach; d <= reach; d++) sum += Math.exp(-(d * d) / (2 * sigma * sigma));
  return sum;
};

function loadBloom({ device, medium, wetness, layer, footprint, grids, wash }: StampWetStageContext): StampLoadedWetStage {
  const { spread } = medium.wetting;
  if (spread <= 0) return { encode: () => null };
  const sized = [...wetness.landings].flatMap(([deposit, landing]) => {
    const bloom = deposit.action.kind === 'lift' ? null : stampBloomSizing(landing, medium.wetting, deposit.diameter);
    return bloom && bloom.sigma >= 0.5 ? [{ deposit, landing, ...bloom }] : [];
  });
  if (!sized.length) return { encode: () => null };

  // Compiled per layer count, the wash layer's WGSL being the group's.
  const pipelinesFor = new Map<number, BloomPipelines>();
  const pipelinesOf = (layers: number) => {
    let found = pipelinesFor.get(layers);
    if (!found) {
      const moved = wash.movedWgsl(layers);
      const pipeline = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'run' } });
      found = {
        surplus: pipeline(SURPLUS_WGSL), waterRows: pipeline(WATER_ROWS_WGSL), waterColumns: pipeline(WATER_COLUMNS_WGSL), front: pipeline(frontWgsl(layers, moved)),
        bandRows: pipeline(BAND_ROWS_WGSL), send: pipeline(SEND_WGSL), sentRows: pipeline(sentRowsWgsl(layers, moved)), land: pipeline(landWgsl(layers, moved)),
      };
      pipelinesFor.set(layers, found);
    }
    return found;
  };

  const afterValues = new Float32Array(sized.reduce((sum, { landing }) => sum + landing.after.wetness.length, 0));
  let afterFirst = 0;
  const plans = new Map(sized.map(({ deposit, landing, sigma, drive }): [CompiledStampDeposit, BloomPlan] => {
    afterValues.set(landing.after.wetness, afterFirst);
    const uniform = device.createBuffer({ size: BLOOM.words * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const plan = { first: grids.firsts.get(deposit)!, afterFirst, sigma, drive, lattice: landing.before.window, pipelines: pipelinesOf(wash.layersOf(deposit)), uniform };
    afterFirst += landing.after.wetness.length;
    return [deposit, plan];
  }));
  const after = device.createBuffer({ size: afterValues.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(after, 0, afterValues);
  const layers = sized.reduce((most, { deposit }) => Math.max(most, wash.layersOf(deposit)), 1);

  let scratch: BloomScratch | null = null;
  const reserve = ({ w, h }: { w: number; h: number }) => {
    if (scratch && w <= scratch.w && h <= scratch.h) return;
    const size = { w: Math.max(w, scratch?.w ?? 0), h: Math.max(h, scratch?.h ?? 0) };
    // Reserved between frames: the frames that bound the old set are submitted, and destroy waits for them.
    for (const texture of scratch?.textures ?? []) texture.destroy();
    const textures: GPUTexture[] = [];
    const view = (format: GPUTextureFormat, depth?: number) => {
      const texture = device.createTexture({ size: [size.w, size.h, depth ?? 1], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
      textures.push(texture);
      return texture.createView({ dimension: depth === undefined ? '2d' : '2d-array' });
    };
    scratch = { ...size, textures, steps: new Map(), surplus: view('r32float'), rows: view('r32float'), water: view('r32float'), front: view('rg32float'), send: view('rg32float'), sentRows: view('rgba32float', layers) };
  };

  const encode = (encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, { box, seed }: Extract<StampWetStageMoment, { kind: 'deposit' }>): StampPixelBox => {
    const plan = plans.get(deposit)!, { sigma, lattice } = plan;
    if (!scratch || box.w > scratch.w || box.h > scratch.h) throw new Error(`stamp paint: the bloom stage was given ${deposit.id}'s box unreserved`);
    const reach = Math.ceil(3 * sigma);
    const carrySigma = STAMP_BLOOM_CARRY_SPREAD * sigma, carryReach = Math.min(Math.ceil(3 * carrySigma), Math.max(box.w, box.h));
    const words = new ArrayBuffer(BLOOM.words * 4);
    const put = stampUniformWriter(BLOOM, { floats: new Float32Array(words), ints: new Int32Array(words), words: new Uint32Array(words) });
    put('lattice', [lattice.x0, lattice.y0, lattice.cell, 0]);
    put('size', [lattice.columns, lattice.rows]);
    put('first', plan.first);
    put('afterFirst', plan.afterFirst);
    put('origin', [box.x, box.y]);
    put('extent', [box.w, box.h]);
    put('seed', seed);
    put('drive', plan.drive);
    put('sigma', sigma);
    put('damp', medium.wetting.damp);
    put('shine', medium.wetting.brushWater);
    put('reach', reach);
    put('norm', kernelSum(sigma, reach));
    put('carrySigma', carrySigma);
    put('carryReach', carryReach);
    put('carryNorm', kernelSum(carrySigma, carryReach));
    put('sendFloor', (STAMP_BLOOM_SEND_FLOOR * STAMP_BLOOM_BAND_WIDTH) / (Math.sqrt(2 * Math.PI) * carrySigma));
    device.queue.writeBuffer(plan.uniform, 0, words);

    let steps = scratch.steps.get(plan);
    if (!steps) {
      steps = bloomSteps(plan, scratch);
      scratch.steps.set(plan, steps);
    }
    for (const { pipeline, bindGroup } of steps) {
      const compute = encoder.beginComputePass();
      compute.setPipeline(pipeline);
      compute.setBindGroup(0, bindGroup);
      compute.dispatchWorkgroups(Math.ceil(box.w / WORKGROUP), Math.ceil(box.h / WORKGROUP));
      compute.end();
    }
    return box;
  };
  // A plan's dispatches, in order, bound to one generation of scratch textures.
  const bloomSteps = (plan: BloomPlan, { surplus, rows, water, front, send, sentRows }: BloomScratch): BloomStep[] => {
    const { pipelines } = plan, u = { buffer: plan.uniform }, g = { buffer: grids.buffer }, a = { buffer: after };
    const step = (pipeline: GPUComputePipeline, resources: GPUBindingResource[]): BloomStep => ({
      pipeline, bindGroup: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: resources.map((resource, binding) => ({ binding, resource })) }),
    });
    return [
      step(pipelines.surplus, [u, g, a, surplus]),
      step(pipelines.waterRows, [u, surplus, rows]),
      step(pipelines.waterColumns, [u, rows, water]),
      step(pipelines.front, [u, g, a, footprint.view, water, front, layer.view]),
      step(pipelines.bandRows, [u, front, rows]),
      step(pipelines.send, [u, front, rows, send]),
      step(pipelines.sentRows, [u, layer.view, send, sentRows]),
      step(pipelines.land, [u, layer.view, front, send, sentRows]),
    ];
  };
  return {
    reserve,
    encode: (encoder, moment) => (moment.kind === 'deposit' && plans.has(moment.deposit) ? encode(encoder, moment.deposit, moment) : null),
  };
}

/** Blooms and backruns, after each wash deposit that lands wetter than the damp, workable paint round it. */
export const STAMP_BLOOM_STAGE: StampWetStage = { id: 'bloom', after: 'deposit', reach: stampBloomReach, load: loadBloom };
