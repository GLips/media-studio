// stamp-wet-flow.ts: the flow stage (models/stamp-wet-flow.ts has the laws, docs/brush-engine.md the scheme). Per
// deposit: each population's potential, once, at half resolution; per stride, the ways a stride on, then an
// exchange along x and one along y of how far each potential has moved; then the layer takes the move, once. All
// within the deposit's box, which the renderer widens by `reach`; scratch textures cover the largest box yet.
//
// Negative space: nothing moves after a lift (its own stage), across washes, or where paint has set (`dried`),
// however wet again. Crayon's flow is 0: it loads nothing.

import { STAMP_GRID_AT_WGSL } from '../models/stamp-region.ts';
import { STAMP_WET_FLOW_WGSL, stampWetFlowReach, stampWetFlowSigma, stampWetFlowStrides } from '../models/stamp-wet-flow.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe.ts';
import type { StampWetLanding } from '../models/stamp-wetness.ts';
import type { StampWetStage, StampWetStageContext, StampWetStageMoment } from './stamp-wet-stages.ts';
import { stampUniformLayout, stampUniformWriter } from './stamp-uniform-layout.ts';

const WORKGROUP = 8;
/** A uniform slot's bytes: WebGPU's minimum uniform offset alignment. */
const SLOT = 256;

/**
 * One pass over a deposit's box (origin, extent): its landing's grids (lattice, size, where each starts); the stride,
 * the last (0 for none), the variance before it and the axis (0 x, 1 y); its sigma and water, whether it laid paint
 * (`fresh`), and whether no exchange has run yet (`first`).
 */
const FLOW_PASS = stampUniformLayout('FlowPass', [
  ['origin', 'vec2u'], ['extent', 'vec2u'], ['lattice', 'vec4f'], ['size', 'vec2u'], ['wetnessFirst', 'u32'], ['workableFirst', 'u32'], ['driedFirst', 'u32'],
  ['stride', 'u32'], ['lastStride', 'u32'], ['before', 'f32'], ['axis', 'u32'], ['sigma', 'f32'], ['water', 'f32'], ['fresh', 'u32'], ['first', 'u32'],
]);
/** The fields a pass sets for itself; the rest every pass of a deposit shares. */
const FLOW_PASS_OWN = ['stride', 'lastStride', 'before', 'axis', 'first'] as const;
type FlowPassOwn = Partial<Record<(typeof FLOW_PASS_OWN)[number], number>>;

// Potentials and moves hold the fresh paint's layers, then the paint already there's; every scratch texture is box-local.
const flowWgsl = (layers: number) => /* wgsl */ `
${FLOW_PASS.wgsl}
${STAMP_WET_FLOW_WGSL}
${STAMP_GRID_AT_WGSL}
const LAYERS = ${layers}u;
@group(0) @binding(0) var<uniform> f: FlowPass;
@group(0) @binding(1) var paint: texture_2d_array<f32>;
@group(0) @binding(2) var fresh: texture_2d_array<f32>;
@group(0) @binding(3) var footprint: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> grid: array<f32>;
@group(0) @binding(5) var potentialOut: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(6) var potential: texture_2d_array<f32>;
@group(0) @binding(7) var linearClamp: sampler;
// The way from each pixel a stride on, along x (rg) and y (ba): the driest paper and the least open to paint on it.
@group(0) @binding(8) var path: texture_2d<f32>;
@group(0) @binding(9) var pathOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var moved: texture_2d_array<f32>;
@group(0) @binding(11) var movedOut: texture_storage_2d_array<rgba32float, write>;
@group(0) @binding(12) var layerOut: texture_storage_2d_array<rgba16float, write>;
// The layer as the deposit left it, copied by the first exchange so the last pass can write the layer itself.
@group(0) @binding(13) var paintCopyOut: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(14) var painted: texture_2d_array<f32>;

fn boxLocal(p: vec2i) -> vec2i { return p - vec2i(f.origin); }
fn inBox(p: vec2i) -> bool { return all(boxLocal(p) >= vec2i(0)) && all(boxLocal(p) < vec2i(f.extent)); }
fn boxed(p: vec2i) -> vec2i { return clamp(p, vec2i(f.origin), vec2i(f.origin + f.extent) - 1); }
// The deposit's fresh paint at \`p\`, as its landing left it: only where its footprint laid any.
fn freshAt(p: vec2i, l: u32) -> vec4f {
  if (f.fresh == 0u || textureLoad(footprint, p, 0).r <= 0.0) { return vec4f(0.0); }
  return textureLoad(fresh, p, l, 0);
}
// How wet the paper is at \`p\` as paint moves over it, and how open to paint: none outside the box.
fn openAt(p: vec2i) -> vec2f {
  if (!inBox(p)) { return vec2f(0.0); }
  let landed = textureLoad(footprint, p, 0);
  return vec2f(flowWetness(gridAt(vec2f(p) + 0.5, f.lattice.xyz, f.size, f.wetnessFirst), f.water, landed.r), landed.g);
}
// Layer \`l\` of what a pixel holds of each population now: the fresh paint's, then the paint already there's.
fn heldAt(p: vec2i, l: u32) -> vec4f {
  let laid = freshAt(p, l % LAYERS);
  let held = select(max(textureLoad(paint, p, l % LAYERS, 0) - laid, vec4f(0.0)), laid, l < LAYERS);
  return held + movedAt(p, l);
}
fn stirredAt(p: vec2i) -> f32 {
  let at = vec2f(p) + 0.5;
  let workable = gridAt(at, f.lattice.xyz, f.size, f.workableFirst);
  return flowStirred(workable, gridAt(at, f.lattice.xyz, f.size, f.driedFirst), textureLoad(footprint, p, 0).r);
}
fn pathAt(p: vec2i) -> vec4f { return select(vec4f(0.0), textureLoad(path, boxLocal(p), 0), inBox(p)); }
fn movedAt(p: vec2i, l: u32) -> vec4f { return select(textureLoad(moved, boxLocal(p), l, 0), vec4f(0.0), f.first == 1u); }
// Layer \`l\` of the potentials: as they started, bilinear from half resolution, plus how far each has moved.
fn potentialAt(p: vec2i, l: u32) -> vec4f {
  let halfExtent = vec2f((f.extent + 1u) / 2u);
  let texel = clamp((vec2f(boxLocal(p)) + 0.5) * 0.5, vec2f(0.5), halfExtent - 0.5);
  return textureSampleLevel(potential, linearClamp, texel / vec2f(textureDimensions(potential)), l, 0.0) + movedAt(p, l);
}

// Each half-resolution texel: the mean of each population over the 8 × 8 pixels round its 2 × 2, within the box.
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn potentials(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= (f.extent + 1u) / 2u)) { return; }
  let base = vec2i(f.origin) + vec2i(id.xy) * 2;
  var laid: array<vec4f, LAYERS>;
  var there: array<vec4f, LAYERS>;
  for (var dy = -3; dy <= 4; dy++) {
    for (var dx = -3; dx <= 4; dx++) {
      let p = boxed(base + vec2i(dx, dy));
      for (var l = 0u; l < LAYERS; l++) {
        let own = freshAt(p, l);
        laid[l] += own;
        there[l] += max(textureLoad(paint, p, l, 0) - own, vec4f(0.0));
      }
    }
  }
  for (var l = 0u; l < LAYERS; l++) {
    textureStore(potentialOut, id.xy, l, laid[l] / 64.0);
    textureStore(potentialOut, id.xy, LAYERS + l, there[l] / 64.0);
  }
}

// Each pixel's way a stride on: from the last stride's way from it and from the pixel that far short of this
// stride's end, which overlap as each stride is at most twice the last; at the first, from its own openness.
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn ways(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= f.extent)) { return; }
  let p = vec2i(f.origin + id.xy);
  var way: vec4f;
  if (f.lastStride == 0u) {
    let here = openAt(p);
    way = vec4f(min(here, openAt(p + vec2i(1, 0))), min(here, openAt(p + vec2i(0, 1))));
  } else {
    let rest = i32(f.stride - f.lastStride);
    way = min(pathAt(p), vec4f(pathAt(p + vec2i(rest, 0)).xy, pathAt(p + vec2i(0, rest)).zw));
  }
  textureStore(pathOut, id.xy, way);
}

// Each pixel's exchange with the pixels a stride either side along the pass's axis, through the way between. The
// paint already there moves only as its water stirs it; the fresh paint moves freely.
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn exchange(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= f.extent)) { return; }
  let q = vec2i(f.origin + id.xy);
  if (f.first == 1u) {
    for (var l = 0u; l < LAYERS; l++) { textureStore(paintCopyOut, id.xy, l, textureLoad(paint, q, l, 0)); }
  }
  let along = select(vec2i(0, 1), vec2i(1, 0), f.axis == 0u);
  let partners = array<vec2i, 2>(q - along * i32(f.stride), q + along * i32(f.stride));
  // Each pair's way starts at its first pixel, so both of the pair read the same one.
  let ways = array<vec4f, 2>(pathAt(partners[0]), pathAt(q));
  var k = array<f32, 2>(0.0, 0.0);
  var stirred = array<f32, 2>(0.0, 0.0);
  for (var i = 0; i < 2; i++) {
    if (!inBox(partners[i])) { continue; }
    let way = select(ways[i].zw, ways[i].xy, f.axis == 0u);
    k[i] = flowConductance(f.sigma, f32(f.stride), f.before, way.x, way.y);
    if (k[i] > 0.0) { stirred[i] = stirredAt(partners[i]); }
  }
  let moves = k[0] > 0.0 || k[1] > 0.0;
  let stirredHere = select(0.0, stirredAt(q), moves);
  for (var l = 0u; l < 2u * LAYERS; l++) {
    var now = movedAt(q, l);
    if (moves) {
      let here = potentialAt(q, l);
      let isFresh = l < LAYERS;
      let freeHere = flowFree(select(stirredHere, 1.0, isFresh), heldAt(q, l), here);
      for (var i = 0; i < 2; i++) {
        if (k[i] <= 0.0) { continue; }
        let there = potentialAt(partners[i], l);
        now += flowInto(here, there, freeHere, flowFree(select(stirred[i], 1.0, isFresh), heldAt(partners[i], l), there), k[i]);
      }
    }
    textureStore(movedOut, id.xy, l, now);
  }
}

// The layer takes both populations' moves, in one half-float store.
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn settle(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= f.extent)) { return; }
  let p = vec2i(f.origin + id.xy);
  for (var l = 0u; l < LAYERS; l++) {
    let was = textureLoad(painted, vec2i(id.xy), l, 0);
    textureStore(layerOut, p, l, max(was + movedAt(p, l) + movedAt(p, LAYERS + l), vec4f(0.0)));
  }
}`;

/** The flow stage. */
export const STAMP_WET_FLOW_STAGE: StampWetStage = {
  id: 'flow',
  after: 'deposit',
  load: (context) => {
    const sigmaOf = (deposit: CompiledStampDeposit) => stampWetFlowSigma(context.medium, deposit.diameter);
    // Deposits that move paint: paint or water, landing wet somewhere, in a medium that flows.
    const flowing = [...context.wetness.landings].filter(([deposit, landing]) =>
      deposit.action.kind !== 'lift' && stampWetFlowStrides(sigmaOf(deposit)).length > 0
      && (landing.water > 0 || landing.before.wetness.values.some((v) => v > 0)));
    if (!flowing.length) return { encode: () => null };
    return flowOnDevice(context, new Map(flowing), sigmaOf);
  },
};

type FlowScratch = { moved: GPUTextureView[]; potentials: GPUTextureView; paths: GPUTextureView[]; painted: GPUTextureView };

function flowOnDevice(context: StampWetStageContext, flowing: ReadonlyMap<CompiledStampDeposit, StampWetLanding>, sigmaOf: (deposit: CompiledStampDeposit) => number) {
  const { device, layer, footprint, fresh } = context;
  const layers = layer.layers.length;
  const module = device.createShaderModule({ code: flowWgsl(layers) });
  const flowPipeline = (entryPoint: string) => device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } });
  const pipelines = { potentials: flowPipeline('potentials'), ways: flowPipeline('ways'), exchange: flowPipeline('exchange'), settle: flowPipeline('settle') };
  const linearClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  // Moves are full floats: this GPU's half-float stores truncate, and a dozen of them lost a tenth of a percent of
  // the pigment. The layer takes one half-float store, in `settle`.
  let scratch: FlowScratch | null = null;
  let size = { w: 0, h: 0 };
  const scratchFor = (w: number, h: number): FlowScratch => {
    if (scratch && w <= size.w && h <= size.h) return scratch;
    size = { w: Math.max(w, size.w), h: Math.max(h, size.h) };
    const texture = (tw: number, th: number, count: number, format: GPUTextureFormat, dimension: GPUTextureViewDimension) =>
      device.createTexture({ size: [tw, th, count], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }).createView({ dimension });
    const moved = () => texture(size.w, size.h, 2 * layers, 'rgba32float', '2d-array');
    const path = () => texture(size.w, size.h, 1, 'rgba16float', '2d');
    scratch = {
      moved: [moved(), moved()],
      potentials: texture(Math.ceil(size.w / 2), Math.ceil(size.h / 2), 2 * layers, 'rgba16float', '2d-array'),
      paths: [path(), path()],
      painted: texture(size.w, size.h, layers, 'rgba16float', '2d-array'),
    };
    return scratch;
  };

  // Each flowing deposit's grids, and a uniform buffer with a slot for each of its passes.
  const floats: number[] = [];
  const planned = new Map([...flowing].map(([deposit, landing]) => {
    const { wetness, workable, dried } = landing.before;
    const firsts = { wetness: floats.length, workable: floats.length + wetness.values.length, dried: floats.length + 2 * wetness.values.length };
    floats.push(...wetness.values, ...workable.values, ...dried.values);
    const strides = stampWetFlowStrides(sigmaOf(deposit));
    const passes = 2 + 3 * strides.length;
    const uniforms = device.createBuffer({ size: passes * SLOT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    return [deposit, { landing, firsts, strides, passes, uniforms }] as const;
  }));
  const grids = device.createBuffer({ size: Math.max(4, floats.length * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(grids, 0, new Float32Array(floats));

  function encodeFlow(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, box: StampPixelBox) {
    const { landing, firsts, strides, passes, uniforms } = planned.get(deposit)!;
    const { moved, potentials, paths, painted } = scratchFor(box.w, box.h);
    const grid = landing.before.wetness;
    const data = new ArrayBuffer(passes * SLOT);
    let slots = 0;
    /** The next pass's uniform slot: the fields every pass shares, then `own`. */
    const slot = (own: FlowPassOwn): GPUBufferBinding => {
      const offset = slots++ * SLOT;
      const put = stampUniformWriter(FLOW_PASS, {
        floats: new Float32Array(data, offset, SLOT / 4), ints: new Int32Array(data, offset, SLOT / 4), words: new Uint32Array(data, offset, SLOT / 4),
      });
      put('origin', [box.x, box.y]);
      put('extent', [box.w, box.h]);
      put('lattice', [grid.x0, grid.y0, grid.cell, 0]);
      put('size', [grid.columns, grid.rows]);
      put('wetnessFirst', firsts.wetness);
      put('workableFirst', firsts.workable);
      put('driedFirst', firsts.dried);
      put('sigma', sigmaOf(deposit));
      put('water', landing.water);
      put('fresh', deposit.action.kind === 'paint' ? 1 : 0);
      for (const field of FLOW_PASS_OWN) {
        const value = own[field];
        if (value !== undefined) put(field, value);
      }
      return { buffer: uniforms, offset, size: FLOW_PASS.words * 4 };
    };
    const dispatch = (pipeline: GPUComputePipeline, uniform: GPUBufferBinding, bound: [number, GPUBindingResource][], w = box.w, h = box.h) => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: uniform }, ...bound.map(([binding, resource]) => ({ binding, resource }))],
      }));
      pass.dispatchWorkgroups(Math.ceil(w / WORKGROUP), Math.ceil(h / WORKGROUP));
      pass.end();
    };
    const lands: [number, GPUBindingResource][] = [[3, footprint.view], [4, { buffer: grids }]];
    dispatch(pipelines.potentials, slot({}), [[1, layer.view], [2, fresh.view], [3, footprint.view], [5, potentials]], Math.ceil(box.w / 2), Math.ceil(box.h / 2));
    let exchanges = 0;
    strides.forEach(({ stride, before }, level) => {
      // This stride's ways are built from the last's, the two path textures taking turns.
      const [lastPath, path] = level % 2 ? [paths[0], paths[1]] : [paths[1], paths[0]];
      dispatch(pipelines.ways, slot({ stride, lastStride: level ? strides[level - 1].stride : 0 }), [...lands, [8, lastPath], [9, path]]);
      for (const axis of [0, 1]) {
        dispatch(pipelines.exchange, slot({ stride, before, axis, first: exchanges === 0 ? 1 : 0 }), [
          [1, layer.view], [2, fresh.view], ...lands, [6, potentials], [7, linearClamp], [8, path], [10, moved[exchanges % 2]], [11, moved[(exchanges + 1) % 2]], [13, painted],
        ]);
        exchanges++;
      }
    });
    dispatch(pipelines.settle, slot({}), [[10, moved[exchanges % 2]], [12, layer.view], [14, painted]]);
    device.queue.writeBuffer(uniforms, 0, data);
    return box;
  }

  return {
    reach: (deposit: CompiledStampDeposit) => (planned.has(deposit) ? stampWetFlowReach(sigmaOf(deposit)) : 0),
    encode: (encoder: GPUCommandEncoder, moment: StampWetStageMoment) =>
      (moment.kind === 'deposit' && planned.has(moment.deposit) ? encodeFlow(encoder, moment.deposit, moment.box) : null),
  };
}
