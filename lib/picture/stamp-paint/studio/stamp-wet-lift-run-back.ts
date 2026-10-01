// stamp-wet-lift-run-back.ts: the wet stage that softens a lift's edge. Lifted from wet paint, a hole doesn't keep
// the brush's edge: the paint around runs back in. After each lift, pixels near its edge trade pigment
// (STAMP_LIFT_RUN_BACK_WGSL), as far as the medium's paint flows and as wet as the paper is; on dry paper, or in a
// medium that doesn't flow, the lift keeps its edge. Four passes, each half a separable Gaussian: the lift's
// coverage by rows, then columns into each pixel's mobility; the mobility-weighted amounts by rows, then columns.
//
// It reads the paper as it was before the lift (its landing's `before`): the water the lift soaks up
// (stamp-wetness.ts) doesn't hold back the paint running into it.

import { STAMP_LIFT_RUN_BACK_WGSL, stampLiftRunBackSigma } from '../models/stamp-wet-lift.ts';
import { STAMP_GRID_AT_WGSL, type StampGrid } from '../models/stamp-region.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe.ts';
import type { StampWetStage, StampWetStageContext, StampWetStageMoment } from './stamp-wet-stages.ts';
import { stampUniformLayout, stampUniformWriter } from './stamp-uniform-layout.ts';

const WORKGROUP = 8;

/**
 * The furthest the run-back reaches, as a sigma in pixels: a broad lift on a flooded sheet would otherwise walk
 * hundreds of taps a pixel, and paint that has run this far reads as settled anyway.
 */
export const STAMP_LIFT_RUN_BACK_MOST_SIGMA = 16;

/**
 * A lift's run-back: its grids' lattice, size and first values in the grid buffer (wetness, workable, dried); the box its footprint
 * holds (`liftOrigin`, `liftExtent`); the pixels it works over; its sigma, the kernel's reach and the kernel's sum.
 */
const RUN_BACK = stampUniformLayout('RunBack', [
  ['lattice', 'vec4f'], ['size', 'vec2u'], ['first', 'u32'], ['reach', 'u32'], ['rewetting', 'f32'],
  ['liftOrigin', 'vec2u'], ['liftExtent', 'vec2u'], ['origin', 'vec2u'], ['extent', 'vec2u'], ['sigma', 'f32'], ['norm', 'f32'],
]);

const PRELUDE = /* wgsl */ `
${RUN_BACK.wgsl}
@group(0) @binding(0) var<uniform> u: RunBack;
fn kernelAt(d: i32) -> f32 { return exp(-f32(d * d) / (2.0 * u.sigma * u.sigma)) / u.norm; }
fn inside(p: vec2i, origin: vec2u, extent: vec2u) -> bool {
  return all(p >= vec2i(origin)) && all(p < vec2i(origin + extent));
}
// The pixel an invocation works on, or none past the run-back's extent.
fn pixelOf(id: vec3u) -> vec2i { return select(vec2i(-1), vec2i(u.origin + id.xy), all(id.xy < u.extent)); }
`;

// The lift's coverage, none outside the box its footprint was just written over, blurred along rows.
const LIFT_ROWS_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var footprint: texture_2d<f32>;
@group(0) @binding(2) var liftRows: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  var sum = 0.0;
  for (var d = -i32(u.reach); d <= i32(u.reach); d++) {
    let q = p + vec2i(d, 0);
    if (inside(q, u.liftOrigin, u.liftExtent)) { sum += kernelAt(d) * textureLoad(footprint, q, 0).r; }
  }
  textureStore(liftRows, p, vec4f(sum));
}`;

// Each pixel's mobility, from the lift blurred along columns and the paper's wetness there.
const MOBILITY_WGSL = /* wgsl */ `${PRELUDE}
${STAMP_LIFT_RUN_BACK_WGSL}
@group(0) @binding(1) var<storage, read> grid: array<f32>;
${STAMP_GRID_AT_WGSL}
@group(0) @binding(2) var liftRows: texture_2d<f32>;
@group(0) @binding(3) var mobility: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  var lifted = 0.0;
  for (var d = -i32(u.reach); d <= i32(u.reach); d++) {
    let q = p + vec2i(0, d);
    if (inside(q, u.origin, u.extent)) { lifted += kernelAt(d) * textureLoad(liftRows, q, 0).r; }
  }
  let at = vec2f(p) + 0.5;
  let points = u.size.x * u.size.y;
  let wetness = gridAt(at, u.lattice.xyz, u.size, u.first);
  let workable = gridAt(at, u.lattice.xyz, u.size, u.first + points);
  let dried = gridAt(at, u.lattice.xyz, u.size, u.first + 2u * points);
  textureStore(mobility, p, vec4f(liftRunBackMobility(wetness, workable, dried, u.rewetting, lifted)));
}`;

const pulledRowsWgsl = (layers: number) => /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var layer: texture_2d_array<f32>;
@group(0) @binding(2) var mobility: texture_2d<f32>;
@group(0) @binding(3) var pulledRows: texture_storage_2d_array<rgba32float, write>;
@group(0) @binding(4) var reachRows: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  var pulled: array<vec4f, ${layers}>;
  var reach = 0.0;
  for (var d = -i32(u.reach); d <= i32(u.reach); d++) {
    let q = p + vec2i(d, 0);
    if (!inside(q, u.origin, u.extent)) { continue; }
    let w = kernelAt(d) * textureLoad(mobility, q, 0).r;
    if (w <= 0.0) { continue; }
    reach += w;
    for (var l = 0; l < ${layers}; l++) { pulled[l] += w * textureLoad(layer, q, l, 0); }
  }
  for (var l = 0; l < ${layers}; l++) { textureStore(pulledRows, p, l, pulled[l]); }
  textureStore(reachRows, p, vec4f(reach));
}`;

// The exchange, written back: coverage (layer 0's x) stays, as paint running back thins no film to nothing.
const runBackWgsl = (layers: number) => /* wgsl */ `${PRELUDE}
${STAMP_LIFT_RUN_BACK_WGSL}
@group(0) @binding(1) var layer: texture_storage_2d_array<rgba16float, read_write>;
@group(0) @binding(2) var mobility: texture_2d<f32>;
@group(0) @binding(3) var pulledRows: texture_2d_array<f32>;
@group(0) @binding(4) var reachRows: texture_2d<f32>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let p = pixelOf(id);
  if (p.x < 0) { return; }
  let g = textureLoad(mobility, p, 0).r;
  if (g <= 0.0) { return; }
  var pulled: array<vec4f, ${layers}>;
  var reach = 0.0;
  for (var d = -i32(u.reach); d <= i32(u.reach); d++) {
    let q = p + vec2i(0, d);
    if (!inside(q, u.origin, u.extent)) { continue; }
    let k = kernelAt(d);
    reach += k * textureLoad(reachRows, q, 0).r;
    for (var l = 0; l < ${layers}; l++) { pulled[l] += k * textureLoad(pulledRows, q, l, 0); }
  }
  for (var l = 0; l < ${layers}; l++) {
    let was = textureLoad(layer, p, l);
    var now = liftRunBack(was, g, pulled[l], reach);
    if (l == 0) { now.x = was.x; }
    textureStore(layer, p, l, now);
  }
}`;

const clampGridIndex = (v: number, count: number) => Math.min(count - 1, Math.max(0, v));

/** The largest value of `grid` at its points over `box`, and the nearest where none fall in it. */
function stampGridMostOver(grid: StampGrid, box: StampPixelBox): number {
  const i0 = clampGridIndex(Math.floor((box.x - grid.x0) / grid.cell), grid.columns), i1 = clampGridIndex(Math.ceil((box.x + box.w - grid.x0) / grid.cell), grid.columns);
  const j0 = clampGridIndex(Math.floor((box.y - grid.y0) / grid.cell), grid.rows), j1 = clampGridIndex(Math.ceil((box.y + box.h - grid.y0) / grid.cell), grid.rows);
  let most = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) most = Math.max(most, grid.values[j * grid.columns + i]);
  return most;
}

function loadLiftRunBack({ device, medium, wetness, width, height, layer, footprint }: StampWetStageContext) {
  const lifts = [...wetness.landings].filter(([deposit]) => deposit.action.kind === 'lift');
  if (!lifts.length || medium.wetting.spread <= 0) return { encode: () => null };

  // Every lift's grids (wetness, workable, dried, on one lattice), one after another, each lift with a uniform
  // buffer of its own, as a frame may hold several.
  const firsts = new Map<CompiledStampDeposit, number>(), values: number[] = [];
  for (const [deposit, { before }] of lifts) {
    firsts.set(deposit, values.length);
    values.push(...before.wetness.values, ...before.workable.values, ...before.dried.values);
  }
  const grid = device.createBuffer({ size: values.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(grid, 0, new Float32Array(values));
  const uniforms = new Map(lifts.map(([deposit]) => [deposit, device.createBuffer({ size: RUN_BACK.words * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })]));

  const layers = layer.layers.length;
  const scratch = (format: GPUTextureFormat, depth = 1) => {
    const texture = device.createTexture({ size: [width, height, depth], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    return texture.createView({ dimension: depth > 1 ? '2d-array' : '2d' });
  };
  // A one-layer array still binds as an array.
  const pulledRows = device.createTexture({ size: [width, height, layers], format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
    .createView({ dimension: '2d-array' });
  const liftRows = scratch('r32float'), mobility = scratch('r32float'), reachRows = scratch('r32float');
  const pipeline = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'run' } });
  const passes = {
    liftRows: pipeline(LIFT_ROWS_WGSL), mobility: pipeline(MOBILITY_WGSL),
    pulledRows: pipeline(pulledRowsWgsl(layers)), runBack: pipeline(runBackWgsl(layers)),
  };

  const encode = (encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, lift: StampPixelBox): StampPixelBox | null => {
    const landing = wetness.landings.get(deposit)!, { wetness: wet } = landing.before;
    const sigma = Math.min(STAMP_LIFT_RUN_BACK_MOST_SIGMA, stampLiftRunBackSigma(medium.wetting.spread, deposit.diameter, stampGridMostOver(wet, lift)));
    if (sigma < 0.5) return null;
    const reach = Math.ceil(3 * sigma);
    const x = Math.max(0, lift.x - reach), y = Math.max(0, lift.y - reach);
    const box = { x, y, w: Math.min(width, lift.x + lift.w + reach) - x, h: Math.min(height, lift.y + lift.h + reach) - y };
    let norm = 0;
    for (let d = -reach; d <= reach; d++) norm += Math.exp(-(d * d) / (2 * sigma * sigma));

    const words = new ArrayBuffer(RUN_BACK.words * 4);
    const put = stampUniformWriter(RUN_BACK, { floats: new Float32Array(words), ints: new Int32Array(words), words: new Uint32Array(words) });
    put('lattice', [wet.x0, wet.y0, wet.cell, 0]);
    put('size', [wet.columns, wet.rows]);
    put('first', firsts.get(deposit)!);
    put('rewetting', medium.wetting.rewetting);
    put('reach', reach);
    put('liftOrigin', [lift.x, lift.y]);
    put('liftExtent', [lift.w, lift.h]);
    put('origin', [box.x, box.y]);
    put('extent', [box.w, box.h]);
    put('sigma', sigma);
    put('norm', norm);
    const uniform = uniforms.get(deposit)!;
    device.queue.writeBuffer(uniform, 0, words);

    const dispatch = (pass: GPUComputePipeline, resources: GPUBindingResource[]) => {
      const compute = encoder.beginComputePass();
      compute.setPipeline(pass);
      compute.setBindGroup(0, device.createBindGroup({ layout: pass.getBindGroupLayout(0), entries: resources.map((resource, binding) => ({ binding, resource })) }));
      compute.dispatchWorkgroups(Math.ceil(box.w / WORKGROUP), Math.ceil(box.h / WORKGROUP));
      compute.end();
    };
    dispatch(passes.liftRows, [{ buffer: uniform }, footprint.view, liftRows]);
    dispatch(passes.mobility, [{ buffer: uniform }, { buffer: grid }, liftRows, mobility]);
    dispatch(passes.pulledRows, [{ buffer: uniform }, layer.view, mobility, pulledRows, reachRows]);
    dispatch(passes.runBack, [{ buffer: uniform }, layer.view, mobility, pulledRows, reachRows]);
    return box;
  };
  return {
    encode: (encoder: GPUCommandEncoder, moment: StampWetStageMoment) =>
      moment.kind === 'deposit' && firsts.has(moment.deposit) ? encode(encoder, moment.deposit, moment.box) : null,
  };
}

/** Wet paint running back into a lift, after each lift lands. */
export const STAMP_LIFT_RUN_BACK_STAGE: StampWetStage = { id: 'lift-run-back', after: 'deposit', load: loadLiftRunBack };
