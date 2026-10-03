// stamp-wet-field.ts: a wash's wet history on the GPU, the one place water lands, from dry paper or its preparation.
// Each deposit's water lands in one pass by one law (landingOf, advanced), leaving its stages the landing they read.
//
// `paper`: a pixel's level, the painting second it went there, whether it had settled. `rim`, cleared at each drying:
// the wettest paper since, how much tools touched, their mean diameter by touch.
//
// Warning: the field moves on before the deposit's stages run, so they read the paper only from its landing, which
// lasts only through them.
//
// Its textures are the stage's (stamp-stage.ts); boxes are stage texels, fields and scale grids painting points.

import { STAMP_PAINT_FIELD_SHARE, stampPaintFieldEnds, type StampSeededPaintField } from '../models/stamp-paint-field.ts';
import { STAMP_GRID_AT_WGSL, type StampGrid } from '../models/stamp-region.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe-compile.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { STAMP_LANDED_WETNESS_WGSL, STAMP_WET_CONTACT_WGSL, STAMP_WET_PAPER_WGSL, stampFloodHeldWetness, type StampDrying, type StampWetLanding } from '../models/stamp-wetness.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';
import { STAMP_REGION_AT_WGSL } from './stamp-region-textures.ts';
import { stampRegionTexelWords, stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import { gpuUniformLayout, gpuUniformStruct, gpuUniformWriter, type GpuUniformViews } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';

const WORKGROUP = 8;

/** The field's textures' formats: the paper's, whose times want full floats, the rim's, and a landing's. */
export const STAMP_WET_FIELD_FORMATS = { paper: 'rgba32float', rim: 'rgba16float', landing: 'rgba32float', scale: 'r32float' } as const;

/**
 * A wash pass's start over the stage's `size`: its preparation's region (`region`'s box, within its pass's `within`)
 * and the fluid it's laid under (`fluid`'s box, empty for none), its wetness field (STAMP_PAINT_FIELD_SHARE's kind and
 * geometry, its two ends); `prepared` 0 for dry paper.
 */
export const STAMP_WET_PREPARE = gpuUniformLayout('WetPrepare', [
  ['region', 'vec4f'], ['fluid', 'vec4f'], ['geometry', 'vec4f'], ['ends', 'vec2f'], ['size', 'vec2u'], ['kind', 'i32'], ['prepared', 'u32'],
]);

/** Where a deposit's tool's local scale is read in the scale buffer (StampWetScale), by STAMP_GRID_AT_WGSL. */
export const STAMP_WET_SCALE = gpuUniformLayout('WetScale', [['lattice', 'vec4f'], ['size', 'vec2u'], ['first', 'u32']]);

/**
 * A wash deposit landing over its box (origin, extent), found over the box its stages read (foundOrigin, foundExtent):
 * how its paper dries (stampDryingWords), its tool's local scale, painting second, water, lift (negative for none), held wetness (stampFloodHeldWetness), diameter.
 */
export const STAMP_WET_LAND = gpuUniformLayout('WetLand', [
  ['origin', 'vec2u'], ['extent', 'vec2u'], ['foundOrigin', 'vec2u'], ['foundExtent', 'vec2u'], ['drying', 'vec4f'],
  ['scale', gpuUniformStruct(STAMP_WET_SCALE)], ['tau', 'f32'], ['water', 'f32'], ['lift', 'f32'], ['held', 'f32'], ['diameter', 'f32'],
]);

/**
 * How `drying` dries paper: rate, openTime and damp, as STAMP_WET_PAPER_WGSL reads them, then shiny, the sheen a
 * reduction over the field judges shiny paper by.
 */
export const stampDryingWords = ({ rate, openTime, damp, shiny }: StampDrying): [number, number, number, number] => [rate, openTime, damp, shiny];

/**
 * Writes STAMP_WET_LAND for `deposit` landing over `box` as `landing` says, the paper found over `found` (the box
 * itself where no stage reads past it) and its tool's `scale`.
 */
export function putStampWetLand(views: GpuUniformViews, moment: {
  deposit: CompiledStampDeposit; landing: StampWetLanding; box: StampPixelBox; found: StampPixelBox; scale: StampWetScale;
}) {
  const { deposit, landing, box, found } = moment, put = gpuUniformWriter(STAMP_WET_LAND, views);
  put('origin', [box.x, box.y]);
  put('extent', [box.w, box.h]);
  put('foundOrigin', [found.x, found.y]);
  put('foundExtent', [found.w, found.h]);
  put('drying', stampDryingWords(landing.drying));
  put('scale', moment.scale);
  put('tau', landing.tau);
  put('water', landing.water);
  put('lift', deposit.action.kind === 'lift' ? deposit.action.strength : -1);
  put('held', stampFloodHeldWetness(deposit, landing));
  put('diameter', deposit.diameter);
}

/**
 * A wash's preparation as its start reads it: its `wetness` over its `region`, held off where `fluid` masks it, each
 * region (painting points) null for none on the stage.
 */
export type StampWetPreparation = { wetness: StampSeededPaintField<number>; region: StampPixelBox | null; fluid: StampPixelBox | null };

/** Writes STAMP_WET_PREPARE for a wash starting on `stage`: on dry paper (`preparation` null), or its preparation. */
export function putStampWetPrepare(views: GpuUniformViews, { stage, preparation }: { stage: StampStage; preparation: StampWetPreparation | null }) {
  const put = gpuUniformWriter(STAMP_WET_PREPARE, views);
  put('size', [stage.width, stage.height]);
  if (!preparation) return;
  const ends = stampPaintFieldEnds(preparation.wetness);
  put('region', stampRegionTexelWords(preparation.region, stage.margin));
  put('fluid', stampRegionTexelWords(preparation.fluid, stage.margin));
  put('geometry', ends.geometry);
  put('ends', [ends.first, ends.second]);
  put('kind', ends.kind);
  put('prepared', 1);
}

const prepareWgsl = (stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${STAMP_WET_PREPARE.wgsl}
${STAMP_PAINT_FIELD_SHARE.wgsl}
@group(0) @binding(0) var<uniform> u: WetPrepare;
@group(0) @binding(1) var region: texture_2d<f32>;
@group(0) @binding(2) var fluid: texture_2d<f32>;
@group(0) @binding(3) var paper: texture_storage_2d<rgba32float, write>;
${STAMP_REGION_AT_WGSL}
// An earlier pass's paint has set: the paper starts settled, as wet as its preparation lays it.
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.size)) { return; }
  var level = 0.0;
  if (u.prepared == 1u) {
    let share = paintFieldShare(stagePoint(vec2i(id.xy)), u.kind, u.geometry);
    level = regionAt(region, u.region, id.xy) * (1.0 - regionAt(fluid, u.fluid, id.xy)) * mix(u.ends.x, u.ends.y, share);
  }
  textureStore(paper, id.xy, vec4f(level, 0.0, 1.0, 0.0));
}`;

// The landing law, per pixel: what the deposit's water found and left (landingOf, from the field as it was), and the
// field advanced by it (advanced); the passes below only schedule it.
const LAW_WGSL = /* wgsl */ `
${STAMP_WET_SCALE.wgsl}
${STAMP_WET_LAND.wgsl}
${STAMP_WET_PAPER_WGSL}
${STAMP_LANDED_WETNESS_WGSL}
${STAMP_WET_CONTACT_WGSL}
@group(0) @binding(0) var<uniform> u: WetLand;
// Its contact (x, none past the box), the paper's wetness and workability as found (yz) and its wetness once the
// water landed (w).
fn landingOf(p: vec2u, field: vec4f, touch: f32, footprint: vec2f) -> vec4f {
  let found = wetPaperAt(field, u.tau, u.drying.xyz);
  let inBox = all(p >= u.origin) && all(p < u.origin + u.extent);
  let contact = select(0.0, wetContact(touch, footprint), inBox);
  return vec4f(contact, found.wetness, found.workable, landedWetness(found.wetness, contact, u.water, u.lift));
}
struct WetAdvanced { paper: vec4f, rim: vec4f }
fn advanced(field: vec4f, seen: vec4f, landed: vec4f, scale: f32) -> WetAdvanced {
  let contact = landed.x;
  let now = landed.y;
  let next = landed.w;
  // Water landing on paper that had settled starts its paint afresh; a lift, or a touch of none, leaves it as it was.
  let settled = select(select(field.z, 1.0, landed.z <= 0.0), 0.0, contact > 0.0 && u.water > 0.0 && u.lift < 0.0);
  // Looks wrong: a lift restarts its paint's open time too. Workability then reads the lifted level, never more than
  // the paper's own history would, the same once the open time has passed: blotting takes the water's mobility at once.
  let paper = select(vec4f(field.xy, settled, 0.0), vec4f(next, u.tau, settled, 0.0), next != now);
  // The drying's wettest, and its tools by touch: a lift soaks water up, its size not the water's, and paint bringing
  // none spreads in the water it found.
  var rim = seen;
  rim.x = max(rim.x, max(max(now, next), u.held * contact));
  if (contact > 0.0 && u.lift < 0.0 && (u.water > 0.0 || now > 0.0)) {
    let touched = rim.y + contact;
    rim.z = (rim.z * rim.y + contact * u.diameter * scale) / touched;
    rim.y = touched;
  }
  return WetAdvanced(paper, rim);
}`;

// Where the landing law reads the tool's touch, footprint and local scale.
const toolWgsl = (stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
@group(0) @binding(1) var<storage, read> grid: array<f32>;
${STAMP_GRID_AT_WGSL}
@group(0) @binding(2) var touch: texture_2d<f32>;
@group(0) @binding(3) var footprint: texture_2d<f32>;
fn scaleAt(p: vec2u) -> f32 { return gridAt(stagePoint(vec2i(p)), u.scale.lattice.xyz, u.scale.size, u.scale.first); }`;

// A deposit's water landed over the found box (its box, for a deposit no stage reads): the field advanced over its
// box and, for its stages, the landing over the found box and the tool's local scale over its box. Each pixel reads
// and writes only its own.
const landWgsl = (stage: StampStage, staged: boolean) => /* wgsl */ `${LAW_WGSL}${toolWgsl(stage)}
@group(0) @binding(4) var paper: texture_storage_2d<rgba32float, read_write>;
@group(0) @binding(5) var rim: texture_storage_2d<rgba16float, read_write>;
${staged ? `@group(0) @binding(6) var landing: texture_storage_2d<rgba32float, write>;
@group(0) @binding(7) var scale: texture_storage_2d<r32float, write>;` : ''}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.foundExtent)) { return; }
  let p = u.foundOrigin + id.xy;
  let field = textureLoad(paper, p);
  let landed = landingOf(p, field, textureLoad(touch, p, 0).r, textureLoad(footprint, p, 0).rg);
  ${staged ? 'textureStore(landing, p, landed);' : ''}
  if (any(p < u.origin) || any(p >= u.origin + u.extent)) { return; }
  let scaled = scaleAt(p);
  ${staged ? 'textureStore(scale, p, vec4f(scaled));' : ''}
  let next = advanced(field, textureLoad(rim, p), landed, scaled);
  textureStore(paper, p, next.paper);
  textureStore(rim, p, next.rim);
}`;

/** A wash's wet field's textures, as its readers bind them. */
export type StampWetFieldViews = { paper: GPUTextureView; rim: GPUTextureView; landing: GPUTextureView; scale: GPUTextureView };

/**
 * Where a deposit's tool's local scale is read (STAMP_GRID_AT_WGSL over a scale buffer): a flood's plan's, its narrow
 * parts laid smaller; anyone else's reads 1 everywhere.
 */
export type StampWetScale = { lattice: [number, number, number, number]; size: [number, number]; first: number };

/** Every flood's scale grid of `deposits` in one buffer, after a grid of ones for every other deposit. */
export function stampWetScales(device: StampPaintDevice, deposits: Iterable<CompiledStampDeposit>) {
  const grids = new Map<CompiledStampDeposit, StampGrid>();
  for (const deposit of deposits) if (deposit.kind === 'flood') grids.set(deposit, deposit.flood.scale);
  const ones: StampWetScale = { lattice: [0, 0, 1e9, 0], size: [2, 2], first: 0 };
  const values = new Float32Array(4 + [...grids.values()].reduce((sum, grid) => sum + grid.values.length, 0));
  values.fill(1, 0, 4);
  const at = new Map<CompiledStampDeposit, StampWetScale>();
  let first = 4;
  for (const [deposit, { x0, y0, cell, columns, rows, values: own }] of grids) {
    values.set(own, first);
    at.set(deposit, { lattice: [x0, y0, cell, 0], size: [columns, rows], first });
    first += own.length;
  }
  const buffer = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(buffer, 0, values);
  return { buffer, of: (deposit: CompiledStampDeposit) => at.get(deposit) ?? ones };
}
export type StampWetScales = ReturnType<typeof stampWetScales>;

/** One of the field's textures and its view. */
type StampWetFieldTarget = { texture: GPUTexture; view: GPUTextureView };

/**
 * The field's passes over its `targets` (STAMP_WET_FIELD_FORMATS, as big as `stage`), each given its uniform slot
 * by the caller, written by putStampWetPrepare or putStampWetLand. `blank` stands for a region of none.
 */
export function stampWetField(device: StampPaintDevice, stage: StampStage, targets: Record<keyof typeof STAMP_WET_FIELD_FORMATS, StampWetFieldTarget>, blank: GPUTextureView) {
  const { paper, rim, landing, scale } = targets;
  const compile = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'run' } });
  const record = (pass: GPUComputePassEncoder, pipeline: GPUComputePipeline, group: GPUBindGroup, w: number, h: number) => {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(w / WORKGROUP), Math.ceil(h / WORKGROUP));
  };
  const run = (encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, group: GPUBindGroup, w: number, h: number) => {
    const pass = encoder.beginComputePass();
    record(pass, pipeline, group, w, h);
    pass.end();
  };
  const prepare = compile(prepareWgsl(stage)), stagedLand = compile(landWgsl(stage, true)), unstagedLand = compile(landWgsl(stage, false));
  const groupOf = (pipeline: GPUComputePipeline, resources: GPUBindingResource[]) =>
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: resources.map((resource, binding) => ({ binding, resource })) });
  /** Forgets what the drying since the last saw. */
  const dried = (encoder: GPUCommandEncoder) => encoder.beginRenderPass({ colorAttachments: [{ view: rim.view, loadOp: 'clear', storeOp: 'store' }] }).end();
  return {
    views: { paper: paper.view, rim: rim.view, landing: landing.view, scale: scale.view } satisfies StampWetFieldViews,
    /** Starts a wash pass, its preparation's region and fluid given (blank for none), and nothing seen since a drying. */
    prepare(encoder: GPUCommandEncoder, uniform: GPUBufferBinding, region: GPUTextureView | null, fluid: GPUTextureView | null) {
      run(encoder, prepare, groupOf(prepare, [uniform, region ?? blank, fluid ?? blank, paper.view]), paper.texture.width, paper.texture.height);
      dried(encoder);
    },
    /**
     * Lands a deposit's water (its uniform, STAMP_WET_LAND's) by its touch, footprint and `scales`' buffer, over its
     * found box, into `pass` after the work that left its footprint; `staged`, leaving the landing its stages read.
     */
    land(pass: GPUComputePassEncoder, uniform: GPUBufferBinding, scales: GPUBuffer, touch: GPUTextureView, footprint: GPUTextureView, found: { w: number; h: number }, staged: boolean) {
      const pipeline = staged ? stagedLand : unstagedLand;
      const group = groupOf(pipeline, [uniform, { buffer: scales }, touch, footprint, paper.view, rim.view, ...(staged ? [landing.view, scale.view] : [])]);
      record(pass, pipeline, group, found.w, found.h);
    },
    dried,
  };
}
export type StampWetField = ReturnType<typeof stampWetField>;
