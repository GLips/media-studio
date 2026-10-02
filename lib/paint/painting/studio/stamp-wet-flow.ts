// stamp-wet-flow.ts: the flow stage, the one way wet paint moves (models/stamp-wet-flow.ts has the laws,
// docs/brush-engine.md the scheme): a deposit's fresh paint feathers into the water and the paint there evens out as
// the water stirs it; round a lift, paint runs back in. Per deposit: each pixel's paper and stirring; per layer of
// the group, each pixel's hold (the compositor's washHold), and per stride the transport's ways
// (stamp-wet-transport.ts) and an exchange along x and y, which the layer takes once; last, the compositor's
// washMoved. All within the deposit's box.
//
// Negative space: nothing moves across washes, or where paint has set (its open share none), however wet again,
// but by a lift's rewetting. Crayon's spread is 0: it loads nothing.

import { STAMP_GRID_AT_WGSL } from '../models/stamp-region.ts';
import { STAMP_WET_FLOW_WGSL, stampWetFlowSigma } from '../models/stamp-wet-flow.ts';
import { stampWetTransportReach, stampWetTransportStrides } from '../models/stamp-wet-transport.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe-compile.ts';
import type { StampWetLanding } from '../models/stamp-wetness.ts';
import { stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import type { StampLoadedWetStage, StampWetDepositMoment, StampWetStage, StampWetStageContext } from './stamp-wet-stages.ts';
import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { putStampWetTransportSlot, stampWetTransportPipelines, stampWetTransportSlotBinding } from './stamp-wet-transport.ts';

const WORKGROUP = 8;
/** A uniform slot's bytes: WebGPU's minimum uniform offset alignment. */
const SLOT = 256;
const ACTIONS = { paint: 0, water: 1, lift: 2 } as const;

/**
 * One pass over a deposit's box (origin, extent): its landing's grids (lattice, size, where they start); the group
 * layer it moves (`chunk`); the stride, the last (0 for none), the variance before it and the axis (0 x, 1 y); its
 * sigma, water and the medium's rewetting; what it does; whether no exchange has run yet (`start`); the paper's depth.
 */
const FLOW_PASS = gpuUniformLayout('FlowPass', [
  ['origin', 'vec2u'], ['extent', 'vec2u'], ['lattice', 'vec4f'], ['size', 'vec2u'], ['first', 'u32'], ['chunk', 'u32'],
  ['stride', 'u32'], ['lastStride', 'u32'], ['before', 'f32'], ['axis', 'u32'], ['sigma', 'f32'], ['water', 'f32'], ['rewetting', 'f32'],
  ['action', 'u32'], ['start', 'u32'], ['depth', 'f32'],
]);
/** The fields a pass sets for itself; the rest every pass of a deposit shares. */
const FLOW_PASS_OWN = ['chunk', 'stride', 'lastStride', 'before', 'axis', 'start'] as const;
type FlowPassOwn = Partial<Record<(typeof FLOW_PASS_OWN)[number], number>>;

/**
 * The least hold a pixel is given: paint on a bare peak still moves off it, at a rate this keeps stable, and no pixel
 * pools more than its partners' hold over this.
 */
const LEAST_HOLD = 0.1;

// Moves hold a layer's two populations, the fresh paint's then the paint already there's; every scratch texture is
// box-local. A pixel \`p\` is a stage texel; grids and holds read its painting point.
const flowWgsl = (layers: number, movedWgsl: string, holdWgsl: string, stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${FLOW_PASS.wgsl}
${STAMP_WET_FLOW_WGSL}
${STAMP_GRID_AT_WGSL}
${movedWgsl}
${holdWgsl}
const LAYERS = ${layers}u;
${Object.entries(ACTIONS).map(([action, index]) => `const ${action.toUpperCase()} = ${index}u;`).join('\n')}
@group(0) @binding(0) var<uniform> f: FlowPass;
@group(0) @binding(1) var paint: texture_2d_array<f32>;
@group(0) @binding(2) var fresh: texture_2d_array<f32>;
@group(0) @binding(3) var footprint: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> grid: array<f32>;
// Per pixel, as the deposit left it: the paper's wetness as paint moves over it, how open it is to paint, how
// stirred the paint already there is, and how lifted.
@group(0) @binding(5) var paperOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var paper: texture_2d<f32>;
// Per pixel, its pigment before the flow, for washMoved.
@group(0) @binding(7) var pigmentOut: texture_storage_2d<r32float, write>;
@group(0) @binding(8) var pigment: texture_2d<f32>;
// Per pixel, how much of each of the layer's channels the paper holds (washHold).
@group(0) @binding(9) var holdOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var hold: texture_2d<f32>;
// The way from each pixel a stride on, along x (rg) and y (ba): the driest paper and the least open to paint on it.
@group(0) @binding(12) var path: texture_2d<f32>;
@group(0) @binding(14) var moved: texture_2d_array<f32>;
@group(0) @binding(15) var movedOut: texture_storage_2d_array<rgba32float, write>;
@group(0) @binding(16) var layer: texture_storage_2d_array<rgba16float, read_write>;

fn boxLocal(p: vec2i) -> vec2i { return p - vec2i(f.origin); }
fn inBox(p: vec2i) -> bool { return all(boxLocal(p) >= vec2i(0)) && all(boxLocal(p) < vec2i(f.extent)); }
// Layer \`l\` of the deposit's fresh paint at \`p\`, as its landing left it: only a paint deposit's, where it laid any.
fn freshAt(p: vec2i, l: u32) -> vec4f {
  if (f.action != PAINT || textureLoad(footprint, p, 0).r <= 0.0) { return vec4f(0.0); }
  return textureLoad(fresh, p, l, 0);
}
// Population \`pop\` of the layer moved, as the deposit left it: the fresh paint (0), or the paint already there (1).
fn laidAt(p: vec2i, pop: u32) -> vec4f {
  let own = freshAt(p, f.chunk);
  return select(max(textureLoad(paint, p, f.chunk, 0) - own, vec4f(0.0)), own, pop == 0u);
}
fn paperAt(p: vec2i) -> vec4f { return select(vec4f(0.0), textureLoad(paper, boxLocal(p), 0), inBox(p)); }
fn pathAt(p: vec2i) -> vec4f { return select(vec4f(0.0), textureLoad(path, boxLocal(p), 0), inBox(p)); }
fn movedAt(p: vec2i, pop: u32) -> vec4f { return select(textureLoad(moved, boxLocal(p), pop, 0), vec4f(0.0), f.start == 1u); }
fn heldAt(p: vec2i, pop: u32) -> vec4f { return laidAt(p, pop) + movedAt(p, pop); }
fn holdAt(p: vec2i) -> vec4f { return textureLoad(hold, boxLocal(p), 0); }
// How much of \`p\` the wash's paint covers: its layer's first channel, which only \`close\` moves.
fn coveredAt(p: vec2i) -> f32 { return textureLoad(paint, p, 0, 0).x; }

// Each pixel's paper and stirring, and its pigment. The paint already there is open as the pixel's open share was
// before its fresh paint, all of it open, joined it.
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn prepare(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= f.extent)) { return; }
  let p = vec2i(f.origin + id.xy);
  var held: array<vec4f, LAYERS>;
  var laid: array<vec4f, LAYERS>;
  for (var l = 0u; l < LAYERS; l++) {
    held[l] = textureLoad(paint, p, l, 0);
    laid[l] = freshAt(p, l);
  }
  let total = washPigmentTotal(held);
  let own = washPigmentTotal(laid);
  let there = total - own;
  let open = select(0.0, clamp((washOpen(held) * total - own) / there, 0.0, 1.0), there > 0.0);
  let at = stagePoint(p);
  let points = f.size.x * f.size.y;
  let wetness = gridAt(at, f.lattice.xyz, f.size, f.first);
  let workable = gridAt(at, f.lattice.xyz, f.size, f.first + points);
  let landed = textureLoad(footprint, p, 0);
  let lift = f.action == LIFT;
  let stirred = select(flowStirred(workable, open, landed.r), flowLiftStirred(workable, open, f.rewetting), lift);
  // A water stroke's brush drags the paint along where it touches, however damp: there it moves as on flooded paper.
  let wets = select(f.water, 1.0, f.action == WATER);
  textureStore(paperOut, id.xy, vec4f(flowWetness(wetness, wets, landed.r), landed.g, stirred, select(0.0, landed.r, lift)));
  textureStore(pigmentOut, id.xy, vec4f(total));
}

// Each pixel's hold of the layer's paint: as the compositor lays it, by the paper's tooth and the paint's habits, and
// only as far as paint may land there (footprint g). A fringe pixel half cut by \`within\` or fluid evened to the
// interior's full amount loses its anti-aliasing, and two washes sharing that outline would both fill it, a dark line.
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn holds(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= f.extent)) { return; }
  let p = vec2i(f.origin + id.xy);
  let held = textureLoad(paint, p, f.chunk, 0);
  let landed = textureLoad(footprint, p, 0);
  let hold = washHold(f.chunk, stagePoint(p), landed.ba, f.depth, held);
  textureStore(holdOut, id.xy, max(hold, vec4f(${LEAST_HOLD.toFixed(3)})) * max(landed.g, 0.001));
}

// Each pixel's exchange with the pixels a stride either side along the pass's axis, through the way between. Paint
// runs down the gradient of each pigment's whole amount per unit of hold, fresh and old together, so fresh paint
// never darkens paint already there as strong; each population carries the share of it that's free to move, the old
// as stirred. After a lift, a pair trades only as far as the lift reached either of it, and paint runs back only where
// the wash covers (flowRefill).
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn exchange(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= f.extent)) { return; }
  let q = vec2i(f.origin + id.xy);
  let along = select(vec2i(0, 1), vec2i(1, 0), f.axis == 0u);
  let partners = array<vec2i, 2>(q - along * i32(f.stride), q + along * i32(f.stride));
  // Each pair's way starts at its first pixel, so both of the pair read the same one.
  let ways = array<vec4f, 2>(pathAt(partners[0]), pathAt(q));
  let here = paperAt(q);
  var k = array<f32, 2>(0.0, 0.0);
  var stirred = array<f32, 2>(0.0, 0.0);
  for (var i = 0; i < 2; i++) {
    if (!inBox(partners[i])) { continue; }
    let way = select(ways[i].zw, ways[i].xy, f.axis == 0u);
    let there = paperAt(partners[i]);
    k[i] = transportConductance(f.sigma, f32(f.stride), f.before, way.x, way.y) * select(1.0, flowLiftPair(here.w, there.w), f.action == LIFT);
    stirred[i] = there.z;
  }
  let held = array<vec4f, 2>(heldAt(q, 0u), heldAt(q, 1u));
  var moved = array<vec4f, 2>(movedAt(q, 0u), movedAt(q, 1u));
  if (k[0] > 0.0 || k[1] > 0.0) {
    let wholeHere = held[0] + held[1];
    let holdHere = holdAt(q);
    let lift = f.action == LIFT;
    let coveredHere = coveredAt(q);
    for (var i = 0; i < 2; i++) {
      if (k[i] <= 0.0) { continue; }
      let p = partners[i];
      let heldThere = array<vec4f, 2>(heldAt(p, 0u), heldAt(p, 1u));
      let wholeThere = heldThere[0] + heldThere[1];
      let holdThere = holdAt(p);
      let coveredThere = coveredAt(p);
      for (var pop = 0u; pop < 2u; pop++) {
        let isFresh = pop == 0u;
        let freeHere = flowFree(select(here.z, 1.0, isFresh), held[pop], wholeHere);
        let freeThere = flowFree(select(stirred[i], 1.0, isFresh), heldThere[pop], wholeThere);
        let into = flowInto(wholeHere / holdHere, wholeThere / holdThere, holdHere, holdThere, freeHere, freeThere, k[i]);
        moved[pop] += select(into, flowRefill(into, coveredHere, coveredThere), lift);
      }
    }
  }
  for (var pop = 0u; pop < 2u; pop++) { textureStore(movedOut, id.xy, pop, moved[pop]); }
}

// The layer takes both populations' moves of its pigment, in one half-float store.
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn settle(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= f.extent)) { return; }
  let p = vec2i(f.origin + id.xy);
  let was = textureLoad(layer, p, f.chunk);
  let now = max(was + movedAt(p, 0u) + movedAt(p, 1u), vec4f(0.0));
  textureStore(layer, p, f.chunk, mix(was, now, washPigmentMask(f.chunk)));
}

// What the rest of each pixel becomes, by the compositor's rule.
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn close(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= f.extent)) { return; }
  let p = vec2i(f.origin + id.xy);
  var now: array<vec4f, LAYERS>;
  for (var l = 0u; l < LAYERS; l++) { now[l] = textureLoad(layer, p, l); }
  let moved = washMoved(now, textureLoad(pigment, id.xy, 0).r);
  for (var l = 0u; l < LAYERS; l++) { textureStore(layer, p, l, moved[l]); }
}`;

/** A deposit's diffusion as planned once the painting loads. */
type FlowPlan = { first: number; layers: number; sigma: number; strides: { stride: number; before: number }[]; uniforms: GPUBuffer; slots: number; pipelines: FlowPipelines };
type FlowPipelines = Record<'prepare' | 'holds' | 'exchange' | 'settle' | 'close', GPUComputePipeline>;
type FlowScratch = { w: number; h: number; textures: GPUTexture[]; paper: GPUTextureView; pigment: GPUTextureView; holds: GPUTextureView; paths: GPUTextureView[]; moved: GPUTextureView[] };

/** Bytes of scratch a box takes per pixel: paper, pigment, hold, two ways and two moves. */
export const STAMP_WET_FLOW_SCRATCH_BYTES = 8 + 4 + 8 + 2 * 8 + 2 * 2 * 16;

/** Wet paint moving, after each wash deposit lands. */
export const STAMP_WET_FLOW_STAGE = {
  id: 'flow',
  after: 'deposit',
  reach: (deposit, medium) => stampWetTransportReach(stampWetFlowSigma(deposit, medium)),
  load: (context) => {
    // Deposits that move paint: landing wet somewhere, or carrying water, in a medium that spreads.
    const flowing = [...context.wetness.landings].filter(([deposit, landing]) => stampWetTransportStrides(stampWetFlowSigma(deposit, landing.medium)).length > 0
      && (landing.water > 0 || landing.before.wetness.some((v) => v > 0)));
    return flowing.length ? flowOnDevice(context, flowing) : { encode: () => null };
  },
} satisfies StampWetStage;

function flowOnDevice(context: StampWetStageContext, flowing: readonly (readonly [CompiledStampDeposit, StampWetLanding])[]): StampLoadedWetStage<StampWetDepositMoment> {
  const { device, layer, footprint, fresh, grids, wash, paperDepth, stage } = context;
  const transport = stampWetTransportPipelines(device);
  // Compiled per group, its holds being its palette's: groups alike share one.
  const pipelinesFor = new Map<string, FlowPipelines>();
  const pipelinesOf = (deposit: CompiledStampDeposit) => {
    const layers = wash.layersOf(deposit), code = flowWgsl(layers, wash.movedWgsl(deposit), wash.holdWgsl(deposit), stage);
    let found = pipelinesFor.get(code);
    if (!found) {
      const module = device.createShaderModule({ code });
      const pipeline = (entryPoint: string) => device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } });
      found = { prepare: pipeline('prepare'), holds: pipeline('holds'), exchange: pipeline('exchange'), settle: pipeline('settle'), close: pipeline('close') };
      pipelinesFor.set(code, found);
    }
    return found;
  };

  // Each deposit's passes, a uniform slot each: prepare and close, and per layer its holds, settle, and three a stride.
  const planned = new Map(flowing.map(([deposit, { medium }]): [CompiledStampDeposit, FlowPlan] => {
    const layers = wash.layersOf(deposit), sigma = stampWetFlowSigma(deposit, medium), strides = stampWetTransportStrides(sigma);
    const slots = 2 + layers * (2 + 3 * strides.length);
    const uniforms = device.createBuffer({ size: slots * SLOT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    return [deposit, { first: grids.firsts.get(deposit)!, layers, sigma, strides, uniforms, slots, pipelines: pipelinesOf(deposit) }];
  }));

  // Moves are full floats: this GPU's half-float stores truncate, and a dozen of them lost a tenth of a percent of
  // the pigment. The layer takes one half-float store a layer, in `settle`.
  let scratch: FlowScratch | null = null;
  const reserve = ({ w, h }: { w: number; h: number }) => {
    if (scratch && w <= scratch.w && h <= scratch.h) return;
    const size = { w: Math.max(w, scratch?.w ?? 0), h: Math.max(h, scratch?.h ?? 0) };
    // Reserved between frames: the frames that bound the old set are submitted, and destroy waits for them.
    for (const texture of scratch?.textures ?? []) texture.destroy();
    const textures: GPUTexture[] = [];
    const view = (tw: number, th: number, count: number, format: GPUTextureFormat, dimension: GPUTextureViewDimension) => {
      const texture = device.createTexture({ size: [tw, th, count], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
      textures.push(texture);
      return texture.createView({ dimension });
    };
    scratch = {
      ...size, textures,
      paper: view(size.w, size.h, 1, 'rgba16float', '2d'), pigment: view(size.w, size.h, 1, 'r32float', '2d'),
      holds: view(size.w, size.h, 1, 'rgba16float', '2d'),
      paths: [view(size.w, size.h, 1, 'rgba16float', '2d'), view(size.w, size.h, 1, 'rgba16float', '2d')],
      moved: [view(size.w, size.h, 2, 'rgba32float', '2d-array'), view(size.w, size.h, 2, 'rgba32float', '2d-array')],
    };
  };

  function encodeFlow(encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, { landing, box }: StampWetDepositMoment) {
    const plan = planned.get(deposit)!;
    if (!scratch || box.w > scratch.w || box.h > scratch.h) throw new Error(`stamp paint: the flow stage was given ${deposit.id}'s box unreserved`);
    const { paper, pigment, holds, paths, moved } = scratch;
    const { pipelines } = plan;
    const { window } = landing.before;
    const data = new ArrayBuffer(plan.slots * SLOT);
    let slots = 0;
    /** The next pass's uniform slot: the fields every pass shares, then `own`. */
    const slot = (own: FlowPassOwn): GPUBufferBinding => {
      const offset = slots++ * SLOT;
      const put = gpuUniformWriter(FLOW_PASS, {
        floats: new Float32Array(data, offset, SLOT / 4), ints: new Int32Array(data, offset, SLOT / 4), words: new Uint32Array(data, offset, SLOT / 4),
      });
      put('origin', [box.x, box.y]);
      put('extent', [box.w, box.h]);
      put('lattice', [window.x0, window.y0, window.cell, 0]);
      put('size', [window.columns, window.rows]);
      put('first', plan.first);
      put('sigma', plan.sigma);
      put('water', landing.water);
      put('rewetting', landing.medium.wetting.rewetting);
      put('action', ACTIONS[deposit.action.kind]);
      put('depth', paperDepth);
      for (const field of FLOW_PASS_OWN) {
        const value = own[field];
        if (value !== undefined) put(field, value);
      }
      return { buffer: plan.uniforms, offset, size: FLOW_PASS.words * 4 };
    };
    /** The next pass's uniform slot, for the transport's ways at `stride`. */
    const waysSlot = (stride: number, lastStride: number): GPUBufferBinding => {
      putStampWetTransportSlot(data, slots * SLOT, box, plan.sigma, { kind: 'ways', stride, lastStride });
      return stampWetTransportSlotBinding(plan.uniforms, slots++);
    };
    const dispatch = (pipeline: GPUComputePipeline, uniform: GPUBufferBinding, bound: [number, GPUBindingResource][]) => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: uniform }, ...bound.map(([binding, resource]) => ({ binding, resource }))],
      }));
      pass.dispatchWorkgroups(Math.ceil(box.w / WORKGROUP), Math.ceil(box.h / WORKGROUP));
      pass.end();
    };
    const laid: [number, GPUBindingResource][] = [[1, layer.view], [2, fresh.view], [3, footprint.view]];
    dispatch(pipelines.prepare, slot({}), [...laid, [4, { buffer: grids.buffer }], [5, paper], [7, pigment]]);
    for (let chunk = 0; chunk < plan.layers; chunk++) {
      dispatch(pipelines.holds, slot({ chunk }), [[1, layer.view], [3, footprint.view], [9, holds]]);
      let exchanges = 0;
      plan.strides.forEach(({ stride, before }, level) => {
        // This stride's ways are built from the last's, the two path textures taking turns.
        const [lastPath, path] = level % 2 ? [paths[0], paths[1]] : [paths[1], paths[0]];
        dispatch(transport.ways, waysSlot(stride, level ? plan.strides[level - 1].stride : 0), [[1, paper], [2, lastPath], [3, path]]);
        for (const axis of [0, 1]) {
          dispatch(pipelines.exchange, slot({ chunk, stride, before, axis, start: exchanges === 0 ? 1 : 0 }), [
            ...laid, [6, paper], [10, holds], [12, path], [14, moved[exchanges % 2]], [15, moved[(exchanges + 1) % 2]],
          ]);
          exchanges++;
        }
      });
      dispatch(pipelines.settle, slot({ chunk }), [[14, moved[exchanges % 2]], [16, layer.view]]);
    }
    dispatch(pipelines.close, slot({}), [[8, pigment], [16, layer.view]]);
    device.queue.writeBuffer(plan.uniforms, 0, data);
    return box;
  }

  return {
    reserve,
    encode: (encoder, moment) => (planned.has(moment.deposit) ? encodeFlow(encoder, moment.deposit, moment) : null),
  };
}
