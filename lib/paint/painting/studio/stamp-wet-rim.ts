// stamp-wet-rim.ts: the wet stage that leaves a drying rim (models/stamp-wet-rim.ts) once each wash is done. Its
// domain is the wash's paint where its water went, holes finer than the paper's grain closed. Distance to the edge
// comes by jump flooding; each band pixel gives a share of its open pigment to the line by the transport's scatter
// (stamp-wet-transport.ts), closed at paper; then washMoved. Against a wall (stampDepositWalled) the wall's line is
// the edge, abrupt as dry paper's. The GPU sizes the band from what the drying saw, within stampDryingRimBound.
//
// Negative space: the group's earlier paint under the wash is its domain too, so no rim falls along it; being set,
// none of it is drawn to the rim.

import { STAMP_DRYING_RIM_LEAST_BAND, stampDryingRimBound } from '../models/stamp-wet-rim.ts';
import type { StampWashDrying } from '../models/stamp-wetness.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe-compile.ts';
import type { StampStage } from '../models/stamp-stage.ts';
import type { StampLoadedWetStage, StampWetDryingMoment, StampWetStage, StampWetStageContext, StampWetWall } from './stamp-wet-stages.ts';
import { gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { STAMP_DRYING_RIM_FLOOD_FIRST_STEP, STAMP_DRYING_RIM_SIZING_BYTES, STAMP_DRYING_RIM_UNIFORM, stampDryingRimGroupPasses, stampDryingRimPasses } from './stamp-wet-rim-passes.ts';
import { encodeStampWetTransportSteps, stampWetSpreads, stampWetTransportGate } from './stamp-wet-transport.ts';

/**
 * A drying's rim as its bank plans it: its box, uniform (whose seed `writeSeed` sets), its deposits' walls each with
 * its Wall uniform (one of none, for no wall), the group's layer count, and its transport's spreads (Gᵀ of the line,
 * then of what's sent), sized for its bound.
 */
type PlannedRim = {
  box: StampPixelBox; uniform: GPUBuffer; writeSeed: (seed: number) => void;
  walls: readonly { wall: StampWetWall | null; uniform: GPUBuffer }[]; layers: number; moved: string; spreads: ReturnType<typeof stampWetSpreads>;
};

type RimStep = { pipeline: GPUComputePipeline; bindGroup: GPUBindGroup };
/** A rim's dispatches: its sizing over its box, its finalize, and the rest as its finalize says. */
type RimSteps = { sizing: RimStep[]; finalize: RimStep; rim: RimStep[] };

/**
 * The scratch textures, as big as the largest box planned, the most layers a rim carries, and each rim's steps bound
 * to them: a new set binds afresh, and a rim given up with its bank lets its steps go.
 */
type RimScratch = {
  w: number; h: number; layers: number; textures: GPUTexture[]; steps: WeakMap<PlannedRim, RimSteps>;
  transport: { paper: GPUTextureView; paths: readonly [GPUTextureView, GPUTextureView]; values: readonly [GPUTextureView, GPUTextureView] };
  domain: GPUTextureView; grainRows: GPUTextureView; send: GPUTextureView; seenRows: GPUTextureView; seen: GPUTextureView; contourRows: GPUTextureView;
  contour: GPUTextureView; levelRows: GPUTextureView; closed: GPUTextureView; seeds: readonly [GPUTextureView, GPUTextureView]; weights: GPUTextureView; barrier: GPUTextureView;
};

/** A Wall uniform's bytes: its box's four floats and `first`, padded to its vec4f's alignment. */
const WALL_BYTES = 32;

function loadDryingRim({ device, stage, layer, wash, field }: StampWetStageContext): StampLoadedWetStage<StampWetDryingMoment> {
  // Every rim sizes itself and opens this or keeps it shut, one after another in a frame.
  const gate = stampWetTransportGate(device);
  const sizing = device.createBuffer({ size: STAMP_DRYING_RIM_SIZING_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const jumps: GPUBuffer[] = [];
  for (let step = STAMP_DRYING_RIM_FLOOD_FIRST_STEP; step >= 1; step /= 2) {
    const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, new Uint32Array([step, 0, 0, 0]));
    jumps.push(buffer);
  }
  const compile = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'run' } });
  const passes = stampDryingRimPasses(compile);
  // Compiled per group's wash layer WGSL: its layer count places its open share and bounds what's gathered.
  const groupPasses = new Map<string, ReturnType<typeof stampDryingRimGroupPasses<GPUComputePipeline>>>();
  const groupPassesOf = (moved: string, layers: number) => {
    let found = groupPasses.get(moved);
    if (!found) {
      found = stampDryingRimGroupPasses(compile, layers, moved, stage);
      groupPasses.set(moved, found);
    }
    return found;
  };

  let scratch: RimScratch | null = null;
  /** Grows the scratch to hold a box as big as `box` and `atLeast` layers: only as a bank plans, between frames. */
  const grow = ({ w, h }: { w: number; h: number }, atLeast: number) => {
    if (scratch && w <= scratch.w && h <= scratch.h && atLeast <= scratch.layers) return;
    const size = { w: Math.max(w, scratch?.w ?? 0), h: Math.max(h, scratch?.h ?? 0) }, layers = Math.max(atLeast, scratch?.layers ?? 1);
    // The frames that bound the old set are submitted, and destroy waits for them.
    for (const texture of scratch?.textures ?? []) texture.destroy();
    const textures: GPUTexture[] = [];
    // A one-layer array still binds as an array.
    const view = (format: GPUTextureFormat, depth?: number) => {
      const texture = device.createTexture({ size: [size.w, size.h, depth ?? 1], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
      textures.push(texture);
      return texture.createView({ dimension: depth === undefined ? '2d' : '2d-array' });
    };
    scratch = {
      ...size, layers, textures, steps: new WeakMap(),
      transport: { paper: view('rgba16float'), paths: [view('rgba16float'), view('rgba16float')], values: [view('rgba32float', layers), view('rgba32float', layers)] },
      domain: view('r32float'), grainRows: view('r32float'), send: view('rg32float'), seenRows: view('rg32float'), seen: view('rg32float'),
      contourRows: view('r32float'), contour: view('r32float'), levelRows: view('rg32float'), closed: view('r32float'),
      seeds: [view('rg32float'), view('rg32float')], weights: view('rg32float'), barrier: view('r32float'),
    };
  };

  // A rim's dispatches, in order, bound to one generation of scratch textures.
  const rimSteps = ({ uniform, moved, layers, spreads, walls }: PlannedRim, bound: RimScratch): RimSteps => {
    const { transport, domain, grainRows, send, seenRows, seen, contourRows, contour, levelRows, closed, seeds, weights, barrier } = bound;
    // Every pass after the sizing is behind the gate (stamp-wet-rim-passes.ts's GATE_WGSL binding).
    const step = (pipeline: GPUComputePipeline, resources: GPUBindingResource[], gated = true) => ({
      pipeline, bindGroup: device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [...resources.map((resource, binding) => ({ binding, resource })), ...(gated ? [{ binding: 15, resource: { buffer: gate } }] : [])],
      }),
    });
    const u = { buffer: uniform }, s = { buffer: sizing }, own = groupPassesOf(moved, layers);
    return {
      sizing: [step(passes.seenRows, [u, field.rim, seenRows], false), step(passes.seen, [u, seenRows, seen, s], false)],
      finalize: step(passes.finalize, [u, s, { buffer: gate }], false),
      rim: [
        // With no wall, one empty one lays it afresh: any texture stands for its region, as an empty box reads none.
        ...walls.map(({ wall, uniform: laid }) => step(passes.barrier, [u, { buffer: laid }, wall?.view ?? contour, barrier])),
        step(passes.domain, [u, seen, layer.view, domain]),
        step(passes.grainRows, [u, domain, grainRows]),
        step(passes.seeds, [u, domain, grainRows, seeds[0], transport.paper, layer.view, closed, s]),
        ...jumps.map((jump, k) => step(passes.flood, [u, { buffer: jump }, seeds[k % 2], seeds[(k + 1) % 2]])),
        step(passes.contourRows, [u, layer.view, contourRows]),
        step(passes.contour, [u, contourRows, contour]),
        step(passes.levelRows, [u, contour, levelRows]),
        step(own.weights, [u, seen, domain, seeds[jumps.length % 2], layer.view, weights, transport.values[1], contour, levelRows, closed, barrier, s]),
        ...spreads.steps(0, transport),
        step(passes.send, [u, weights, transport.values[1], send]),
        step(own.sent, [u, layer.view, send, transport.values[0]]),
        ...spreads.steps(1, transport),
        step(own.rim, [u, layer.view, weights, send, transport.values[0]]),
      ],
    };
  };

  return {
    plan: ({ device: on, wetness, boxOf, wallOf }) => {
      const rims = new Map<StampWashDrying, PlannedRim>();
      // Every deposit of a drying the medium could rim, whose brushes' own wet edges would rim it again: a drying at
      // strength 0 owns its edges too, so its brushes' rims don't come back when its own is turned off.
      const rimmed = new Set<CompiledStampDeposit>();
      for (const drying of [...wetness.washes.values()].flatMap((record) => record.dryings)) {
        const bound = stampDryingRimBound(drying, wetness);
        if (!bound || bound.spread <= 0 || bound.band < STAMP_DRYING_RIM_LEAST_BAND) continue;
        const { painted, spread, damp, band } = bound;
        const box = stageBox(drying.deposits.map(boxOf), stage);
        if (!box) continue;
        for (const deposit of drying.deposits) rimmed.add(deposit);
        // Nothing to gather: the drying keeps its edges, and pays nothing for a rim.
        if (drying.rim === 0) continue;
        const sigma = band / 2, layers = wash.layersOf(painted[0]);
        grow(box, layers);
        // The line, laid in values[1], spreads back there; what's sent spreads in values[0].
        const spreads = stampWetSpreads(on, [{ sigma, order: 'transposed', layers: 1, from: 1 }, { sigma, order: 'forward', layers, from: 0 }], gate);
        spreads.write(box);
        const words = new ArrayBuffer(STAMP_DRYING_RIM_UNIFORM.words * 4);
        const put = gpuUniformWriter(STAMP_DRYING_RIM_UNIFORM, { floats: new Float32Array(words), ints: new Int32Array(words), words: new Uint32Array(words) });
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
        put('spread', spread);
        put('damp', damp);
        put('rim', drying.rim);
        put('bound', sigma);
        const uniform = on.createBuffer({ size: STAMP_DRYING_RIM_UNIFORM.words * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const writeSeed = (seed: number) => {
          put('seed', seed);
          on.queue.writeBuffer(uniform, 0, words);
        };
        const walled = [...new Set(drying.deposits.map(wallOf).filter((wall) => wall !== null))];
        // A Wall uniform: its box (none for no wall), and whether it's the first laid.
        const walls = (walled.length ? walled : [null]).map((wall, k) => {
          const buffer = on.createBuffer({ size: WALL_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), wallWords = new ArrayBuffer(WALL_BYTES);
          new Float32Array(wallWords, 0, 4).set(wall ? [wall.box.x, wall.box.y, wall.box.w, wall.box.h] : [0, 0, 0, 0]);
          new Uint32Array(wallWords, 16, 1)[0] = k === 0 ? 1 : 0;
          on.queue.writeBuffer(buffer, 0, wallWords);
          return { wall, uniform: buffer };
        });
        rims.set(drying, { box, uniform, writeSeed, walls, layers, moved: wash.movedWgsl(painted[0]), spreads });
      }
      return {
        encode: (encoder, { drying, seed }) => {
          const rim = rims.get(drying);
          if (!rim) return null;
          // A frame encodes a drying once, so its uniform holds one epoch's seed until the frame's submit.
          rim.writeSeed(seed);
          const bound = scratch!;
          let steps = bound.steps.get(rim);
          if (!steps) {
            steps = rimSteps(rim, bound);
            bound.steps.set(rim, steps);
          }
          encoder.clearBuffer(sizing);
          encodeStampWetTransportSteps(encoder, steps.sizing, rim.box);
          encodeStampWetTransportSteps(encoder, [steps.finalize], { w: 1, h: 1 });
          encodeStampWetTransportSteps(encoder, steps.rim, rim.box);
          return rim.box;
        },
        ownsWetEdges: (deposit) => rimmed.has(deposit),
      };
    },
  };
}

/** The union of `boxes` (null for none), within the stage's texels; null if none of it is. */
function stageBox(boxes: readonly (StampPixelBox | null)[], { width, height }: StampStage): StampPixelBox | null {
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (const box of boxes) {
    if (!box) continue;
    x0 = Math.min(x0, Math.max(0, box.x));
    y0 = Math.min(y0, Math.max(0, box.y));
    x1 = Math.max(x1, Math.min(width, box.x + box.w));
    y1 = Math.max(y1, Math.min(height, box.y + box.h));
  }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Pigment gathered at a wash's edge as it dries, at each of its dryings. */
export const STAMP_DRYING_RIM_STAGE = { id: 'drying-rim', after: 'drying', load: loadDryingRim } satisfies StampWetStage;
