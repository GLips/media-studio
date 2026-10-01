// stamp-wet-transport.ts: the wet stages' shared transport (models/stamp-wet-transport.ts has the law), box-local. A
// stage supplies the paper (rg: wet, open). `ways` finds the way from each pixel a stride on along x (rg) and y (ba):
// the driest, least open paper on it. `spread` trades linearly along one axis through those ways, every layer of a
// texture array at once. Flow builds the ways and trades paint by its own law; bloom and rim run whole spreads.
//
// A spread G is its levels' passes, x then y; each pass is symmetric (a pair trades through one way), so the same
// passes reversed are exactly Gᵀ, which lets a stage scatter conserving exactly (docs/brush-engine.md, "The
// transport").

import { STAMP_WET_TRANSPORT_WGSL, stampWetTransportStrides } from '../models/stamp-wet-transport.ts';
import { stampUniformLayout, stampUniformWriter } from './stamp-uniform-layout.ts';

const WORKGROUP = 8;
/** A uniform slot's bytes: WebGPU's minimum uniform offset alignment. */
export const STAMP_WET_TRANSPORT_SLOT = 256;

/** One pass over a box `extent`: its stride; for ways, the last level's (0: built from the paper); for a spread, the variance below it, the axis (0 x, 1 y) and its sigma. */
const TRANSPORT_PASS = stampUniformLayout('TransportPass', [
  ['extent', 'vec2u'], ['stride', 'u32'], ['lastStride', 'u32'], ['before', 'f32'], ['axis', 'u32'], ['sigma', 'f32'],
]);

/**
 * One pass of a ladder: its ways (from the last level's, or with `lastStride` 0 from the paper over the whole stride),
 * or a spread along `axis`.
 */
export type StampWetTransportPass = { kind: 'ways'; stride: number; lastStride: number } | { kind: 'spread'; stride: number; before: number; axis: 0 | 1 };

/**
 * The passes of a spread `sigma` px wide, forward (G) or transposed (Gᵀ). Transposed, a level's ways come straight
 * from the paper, a stride at a time: a narrower stride's ways can't be found from a wider one's, and keeping every
 * level's would cost a texture a level.
 */
export function stampWetSpreadPasses(sigma: number, order: 'forward' | 'transposed'): StampWetTransportPass[] {
  const strides = stampWetTransportStrides(sigma);
  if (order === 'forward') {
    return strides.flatMap(({ stride, before }, level): StampWetTransportPass[] => [
      { kind: 'ways', stride, lastStride: level ? strides[level - 1].stride : 0 },
      { kind: 'spread', stride, before, axis: 0 }, { kind: 'spread', stride, before, axis: 1 },
    ]);
  }
  return strides.toReversed().flatMap(({ stride, before }): StampWetTransportPass[] => [
    { kind: 'ways', stride, lastStride: 0 }, { kind: 'spread', stride, before, axis: 1 }, { kind: 'spread', stride, before, axis: 0 },
  ]);
}

/** Writes `pass`, over a box `extent` and as part of a spread `sigma` wide, into the slot at byte `offset` of `data`. */
export function putStampWetTransportSlot(data: ArrayBuffer, offset: number, extent: { w: number; h: number }, sigma: number, pass: StampWetTransportPass) {
  const words = STAMP_WET_TRANSPORT_SLOT / 4;
  const put = stampUniformWriter(TRANSPORT_PASS, {
    floats: new Float32Array(data, offset, words), ints: new Int32Array(data, offset, words), words: new Uint32Array(data, offset, words),
  });
  put('extent', [extent.w, extent.h]);
  put('stride', pass.stride);
  put('lastStride', pass.kind === 'ways' ? pass.lastStride : 0);
  put('before', pass.kind === 'spread' ? pass.before : 0);
  put('axis', pass.kind === 'spread' ? pass.axis : 0);
  put('sigma', sigma);
}

/** A slot's binding in `buffer`. */
export const stampWetTransportSlotBinding = (buffer: GPUBuffer, slot: number): GPUBufferBinding => ({ buffer, offset: slot * STAMP_WET_TRANSPORT_SLOT, size: TRANSPORT_PASS.words * 4 });

const PRELUDE = /* wgsl */ `
${TRANSPORT_PASS.wgsl}
@group(0) @binding(0) var<uniform> t: TransportPass;
fn inBox(q: vec2i) -> bool { return all(q >= vec2i(0)) && all(q < vec2i(t.extent)); }
`;

// Each pixel's way a stride on: from the last stride's way from it and from the pixel that far short of this stride's
// end, which overlap as each stride is at most twice the last; with no last, the paper's least over the stride. A
// minimum is exact, so both give the same way.
const WAYS_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var paper: texture_2d<f32>;
@group(0) @binding(2) var lastPath: texture_2d<f32>;
@group(0) @binding(3) var pathOut: texture_storage_2d<rgba16float, write>;
fn paperAt(q: vec2i) -> vec2f { return select(vec2f(0.0), textureLoad(paper, q, 0).xy, inBox(q)); }
fn lastPathAt(q: vec2i) -> vec4f { return select(vec4f(0.0), textureLoad(lastPath, q, 0), inBox(q)); }
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= t.extent)) { return; }
  let q = vec2i(id.xy);
  var way: vec4f;
  if (t.lastStride == 0u) {
    let here = paperAt(q);
    var x = here;
    var y = here;
    for (var i = 1; i <= i32(t.stride); i++) {
      x = min(x, paperAt(q + vec2i(i, 0)));
      y = min(y, paperAt(q + vec2i(0, i)));
    }
    way = vec4f(x, y);
  } else {
    let rest = i32(t.stride - t.lastStride);
    way = min(lastPathAt(q), vec4f(lastPathAt(q + vec2i(rest, 0)).xy, lastPathAt(q + vec2i(0, rest)).zw));
  }
  textureStore(pathOut, id.xy, way);
}`;

// Each pixel's trade with the pixels a stride either side along the pass's axis, through the way between, in full
// floats: a dozen half-float stores would lose a tenth of a percent.
const spreadWgsl = (layers: number) => /* wgsl */ `${PRELUDE}
${STAMP_WET_TRANSPORT_WGSL}
@group(0) @binding(1) var path: texture_2d<f32>;
@group(0) @binding(2) var values: texture_2d_array<f32>;
@group(0) @binding(3) var spreadOut: texture_storage_2d_array<rgba32float, write>;
fn pathAt(q: vec2i) -> vec4f { return select(vec4f(0.0), textureLoad(path, q, 0), inBox(q)); }
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= t.extent)) { return; }
  let q = vec2i(id.xy);
  let along = select(vec2i(0, 1), vec2i(1, 0), t.axis == 0u);
  let partners = array<vec2i, 2>(q - along * i32(t.stride), q + along * i32(t.stride));
  // Each pair's way starts at its first pixel, so both of the pair read the same one.
  let ways = array<vec4f, 2>(pathAt(partners[0]), pathAt(q));
  var k = array<f32, 2>(0.0, 0.0);
  for (var i = 0; i < 2; i++) {
    if (!inBox(partners[i])) { continue; }
    let way = select(ways[i].zw, ways[i].xy, t.axis == 0u);
    k[i] = transportConductance(t.sigma, f32(t.stride), t.before, way.x, way.y);
  }
  for (var l = 0; l < ${layers}; l++) {
    let here = textureLoad(values, q, l, 0);
    var now = here;
    for (var i = 0; i < 2; i++) {
      if (k[i] > 0.0) { now += k[i] * (textureLoad(values, partners[i], l, 0) - here); }
    }
    textureStore(spreadOut, q, l, now);
  }
}`;

/** The transport's pipelines on a device: ways, and a spread per layer count. */
export type StampWetTransportPipelines = { ways: GPUComputePipeline; spread: (layers: number) => GPUComputePipeline };

const compiled = new WeakMap<GPUDevice, StampWetTransportPipelines>();
/** The transport's pipelines on `device`, compiled once for every stage that runs it. */
export function stampWetTransportPipelines(device: GPUDevice): StampWetTransportPipelines {
  const found = compiled.get(device);
  if (found) return found;
  const compile = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'run' } });
  const spreads = new Map<number, GPUComputePipeline>();
  const made: StampWetTransportPipelines = {
    ways: compile(WAYS_WGSL),
    spread: (layers) => {
      let pipeline = spreads.get(layers);
      if (!pipeline) {
        pipeline = compile(spreadWgsl(layers));
        spreads.set(layers, pipeline);
      }
      return pipeline;
    },
  };
  compiled.set(device, made);
  return made;
}

/**
 * Where a spread works, box-local: the paper (rg: wet, open), two textures its ways take turns in (rgba16float), and
 * two rgba32float arrays its values take turns in, as many layers as the most a spread carries.
 */
export type StampWetSpreadTextures = { paper: GPUTextureView; paths: readonly [GPUTextureView, GPUTextureView]; values: readonly [GPUTextureView, GPUTextureView] };

/** A spread a stage runs: how wide, which way, how many layers of `values` it carries, and which holds them (in and out). */
export type StampWetSpread = { sigma: number; order: 'forward' | 'transposed'; layers: number; from: 0 | 1 };

/** A pipeline and what it's bound to, as one dispatch runs it. */
export type StampWetTransportStep = { pipeline: GPUComputePipeline; bindGroup: GPUBindGroup };

/**
 * A stage's spreads, their uniform slots one after another in one buffer of their own (a buffer per plan, as two
 * plans encoded in one frame each write theirs before it's submitted).
 */
export function stampWetSpreads(device: GPUDevice, spreads: readonly StampWetSpread[]) {
  const pipelines = stampWetTransportPipelines(device);
  const passes = spreads.map((spread) => stampWetSpreadPasses(spread.sigma, spread.order));
  const firsts = passes.map((_, s) => passes.slice(0, s).reduce((sum, list) => sum + list.length, 0));
  const slots = passes.reduce((sum, list) => sum + list.length, 0);
  const uniforms = device.createBuffer({ size: Math.max(1, slots) * STAMP_WET_TRANSPORT_SLOT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  return {
    /** Writes every slot for a box `extent` big. */
    write: (extent: { w: number; h: number }) => {
      const data = new ArrayBuffer(slots * STAMP_WET_TRANSPORT_SLOT);
      spreads.forEach(({ sigma }, s) => passes[s].forEach((pass, k) => putStampWetTransportSlot(data, (firsts[s] + k) * STAMP_WET_TRANSPORT_SLOT, extent, sigma, pass)));
      device.queue.writeBuffer(uniforms, 0, data);
    },
    /** Spread `s`'s dispatches, in order, bound to `textures`; it ends where it starts, in values[from]. */
    steps: (s: number, { paper, paths, values }: StampWetSpreadTextures): StampWetTransportStep[] => {
      const { layers, from } = spreads[s];
      let level = 0, path = paths[0];
      return passes[s].map((pass, k) => {
        const uniform = stampWetTransportSlotBinding(uniforms, firsts[s] + k);
        const step = (pipeline: GPUComputePipeline, resources: GPUBindingResource[]): StampWetTransportStep => ({
          pipeline, bindGroup: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [uniform, ...resources].map((resource, binding) => ({ binding, resource })) }),
        });
        if (pass.kind === 'ways') {
          // Built from the last level's, the two path textures taking turns; straight from the paper, either serves.
          const [last, next] = level++ % 2 ? [paths[0], paths[1]] : [paths[1], paths[0]];
          path = next;
          return step(pipelines.ways, [paper, last, next]);
        }
        // The level's first axis moves the values out of values[from], its second back.
        const first = (pass.axis === 0) === (spreads[s].order === 'forward');
        const [source, target] = first ? [values[from], values[1 - from]] : [values[1 - from], values[from]];
        return step(pipelines.spread(layers), [path, source, target]);
      });
    },
  };
}

/** Runs `steps` over a box `w` × `h`, a compute pass each. */
export function encodeStampWetTransportSteps(encoder: GPUCommandEncoder, steps: readonly StampWetTransportStep[], { w, h }: { w: number; h: number }) {
  for (const { pipeline, bindGroup } of steps) {
    const compute = encoder.beginComputePass();
    compute.setPipeline(pipeline);
    compute.setBindGroup(0, bindGroup);
    compute.dispatchWorkgroups(Math.ceil(w / WORKGROUP), Math.ceil(h / WORKGROUP));
    compute.end();
  }
}
