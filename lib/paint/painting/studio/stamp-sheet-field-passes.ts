// stamp-sheet-field-passes.ts: the sheet solver's passes over its one wet field and its films beside the deposit
// pass's own: a prewet's clean water landing at its wash's start, a film's paint settling where the paper has, which
// films hold open paint (the bloom check's), moving the field's time base, and keeping a wash's clip base for a later
// wash clipped to it.
//
// Warning: settle a film before water lands over it. Water landing on settled paper clears the field's settled flag,
// and a film's open share is only zeroed where the flag still stands.

import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { STAMP_PAINT_FIELD_SHARE, stampPaintFieldEnds, type StampSeededPaintField } from '../models/stamp-paint-field.ts';
import { stampRegionTexelWords, stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import { STAMP_LANDED_WETNESS_WGSL, STAMP_WET_PAPER_WGSL, type StampDrying } from '../models/stamp-wetness.ts';
import { stampBindGroup, type StampPaintDevice } from './stamp-paint-gpu.ts';
import { STAMP_REGION_AT_WGSL, type StampRegionTexture } from './stamp-region-textures.ts';
import type { StampWashGroupLayer } from './stamp-paint-compositor.ts';
import type { StampUniformArena } from './stamp-uniform-arena.ts';
import { stampDryingWords } from './stamp-wet-field.ts';

const WORKGROUP = 8;

/** A pass over the box at `origin`, `extent` texels: the paper's drying, the time after the base, a rebase's shift, a clip base's channel. */
const SHEET_FIELD = gpuUniformLayout('SheetField', [['origin', 'vec2u'], ['extent', 'vec2u'], ['drying', 'vec4f'], ['tau', 'f32'], ['shift', 'f32'], ['channel', 'u32']]);

/** A prewet over the box: its region's and fluid's boxes (stage texels), its water's field (STAMP_PAINT_FIELD_SHARE's). */
const SHEET_PREWET = gpuUniformLayout('SheetPrewet', [
  ['origin', 'vec2u'], ['extent', 'vec2u'], ['drying', 'vec4f'], ['region', 'vec4f'], ['fluid', 'vec4f'], ['geometry', 'vec4f'], ['ends', 'vec2f'],
  ['tau', 'f32'], ['kind', 'i32'],
]);

const header = (layout: { wgsl: string; name: string }) => /* wgsl */ `
${layout.wgsl}
@group(0) @binding(0) var<uniform> u: ${layout.name};
fn boxed(id: vec3u) -> bool { return all(id.xy < u.extent); }`;

// Each texel's paint set where the paper has settled since water last came (or everywhere, as a painting finishes):
// its open share none, as a landing would leave it (landDeposit's settled).
const settleWgsl = (moved: string, layers: number, everywhere: boolean) => /* wgsl */ `${header(SHEET_FIELD)}
${STAMP_WET_PAPER_WGSL}
${moved}
@group(0) @binding(1) var paper: texture_2d<f32>;
@group(0) @binding(2) var film: texture_storage_2d_array<rgba16float, read_write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  if (!boxed(id)) { return; }
  let p = u.origin + id.xy;
${everywhere ? '' : `  if (wetPaperAt(textureLoad(paper, p, 0), u.tau, u.drying.xyz).settled < ${(1 - 1e-4).toFixed(5)}) { return; }`}
  var v: array<vec4f, ${layers}>;
  for (var l = 0u; l < ${layers}u; l++) { v[l] = textureLoad(film, p, l); }
  let settled = washSettled(v);
  for (var l = 0u; l < ${layers}u; l++) { textureStore(film, p, l, settled[l]); }
}`;

// Where a film holds open paint: its pigment and its open share both above none, marked in \`open\`.
const openWgsl = (moved: string, layers: number) => /* wgsl */ `${header(SHEET_FIELD)}
${moved}
@group(0) @binding(1) var film: texture_2d_array<f32>;
@group(0) @binding(2) var open: texture_storage_2d<r32float, read_write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  if (!boxed(id)) { return; }
  let p = u.origin + id.xy;
  var v: array<vec4f, ${layers}>;
  for (var l = 0u; l < ${layers}u; l++) { v[l] = textureLoad(film, p, l, 0); }
  if (washPigmentTotal(v) > 0.0 && washOpen(v) > 0.0) { textureStore(open, p, vec4f(1.0)); }
}`;

// Every stored time moved back by the shift, as the base moves forward by it.
const rebaseWgsl = /* wgsl */ `${header(SHEET_FIELD)}
@group(0) @binding(1) var paper: texture_storage_2d<rgba32float, read_write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  if (!boxed(id)) { return; }
  let p = u.origin + id.xy;
  let field = textureLoad(paper, p);
  textureStore(paper, p, vec4f(field.x, field.y - u.shift, field.zw));
}`;

// A clip base copied: its one channel of \`base\` into r of \`into\`, nothing laid on it yet (g).
const clipBaseWgsl = /* wgsl */ `${header(SHEET_FIELD)}
@group(0) @binding(1) var base: texture_2d<f32>;
@group(0) @binding(2) var into: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  if (!boxed(id)) { return; }
  let p = u.origin + id.xy;
  textureStore(into, p, vec4f(textureLoad(base, p, 0)[u.channel], 0.0, 0.0, 0.0));
}`;

// A prewet's clean water landed by the landing law (the wet field's \`advanced\`) where its region lies off its fluid:
// it raises the drying's wettest and touches no tool's.
const prewetWgsl = (stage: StampStage) => /* wgsl */ `${header(SHEET_PREWET)}
${stampStageWgsl(stage)}
${STAMP_WET_PAPER_WGSL}
${STAMP_LANDED_WETNESS_WGSL}
${STAMP_PAINT_FIELD_SHARE.wgsl}
@group(0) @binding(1) var region: texture_2d<f32>;
@group(0) @binding(2) var fluid: texture_2d<f32>;
@group(0) @binding(3) var paper: texture_storage_2d<rgba32float, read_write>;
@group(0) @binding(4) var rim: texture_storage_2d<rgba16float, read_write>;
${STAMP_REGION_AT_WGSL}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  if (!boxed(id)) { return; }
  let p = u.origin + id.xy;
  let field = textureLoad(paper, p);
  let found = wetPaperAt(field, u.tau, u.drying.xyz);
  let contact = regionAt(region, u.region, p) * (1.0 - regionAt(fluid, u.fluid, p));
  let water = mix(u.ends.x, u.ends.y, paintFieldShare(stagePoint(vec2i(p)), u.kind, u.geometry));
  let now = found.wetness;
  let next = landedWetness(now, contact, water, -1.0);
  let settled = select(select(field.z, 1.0, found.workable <= 0.0), 0.0, contact > 0.0 && water > 0.0);
  textureStore(paper, p, select(vec4f(field.xy, settled, 0.0), vec4f(next, u.tau, settled, 0.0), next != now));
  var seen = textureLoad(rim, p);
  seen.x = max(seen.x, max(now, next));
  textureStore(rim, p, seen);
}`;

/** A prewet as its pass lands it: its region (null for none on the stage), the fluid holding it off, its water. */
export type StampSheetPrewetLanding = { region: StampRegionTexture; fluid: StampRegionTexture | null; water: StampSeededPaintField<number> };

/** What the passes write: the field's paper and rim, the open-paint mask; `blank` for a fluid of none. */
export type StampSheetFieldTargets = { paper: GPUTextureView; rim: GPUTextureView; open: GPUTextureView; blank: GPUTextureView };

/** The passes on `device` over a field on `stage`, uniforms from `arena`. */
export function stampSheetFieldPasses(device: StampPaintDevice, stage: StampStage, arena: StampUniformArena, targets: StampSheetFieldTargets) {
  const compile = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'run' } });
  const rebase = compile(rebaseWgsl), prewet = compile(prewetWgsl(stage)), clipBase = compile(clipBaseWgsl);
  const perLayout = new Map<string, { settle: GPUComputePipeline; settleAll: GPUComputePipeline; open: GPUComputePipeline }>();
  /** A film's pipelines, by how its paint lies (its group's moved WGSL and layer count): films alike share them. */
  const filmPipelines = ({ movedWgsl, layers }: StampWashGroupLayer) => {
    const key = `${layers}|${movedWgsl}`;
    if (!perLayout.has(key)) {
      perLayout.set(key, { settle: compile(settleWgsl(movedWgsl, layers, false)), settleAll: compile(settleWgsl(movedWgsl, layers, true)), open: compile(openWgsl(movedWgsl, layers)) });
    }
    return perLayout.get(key)!;
  };
  const run = (encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, resources: (GPUBindingResource | null)[], box: StampPixelBox) => {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, stampBindGroup(device, pipeline, resources));
    pass.dispatchWorkgroups(Math.ceil(box.w / WORKGROUP), Math.ceil(box.h / WORKGROUP));
    pass.end();
  };
  const whole = { x: 0, y: 0, w: stage.width, h: stage.height };
  const fieldSlot = (box: StampPixelBox, { tau = 0, drying, shift = 0, channel = 0 }: { tau?: number; drying?: StampDrying; shift?: number; channel?: number }) => arena.slot((views) => {
    const put = gpuUniformWriter(SHEET_FIELD, views);
    put('origin', [box.x, box.y]);
    put('extent', [box.w, box.h]);
    if (drying) put('drying', stampDryingWords(drying));
    put('tau', tau);
    put('shift', shift);
    put('channel', channel);
  });
  return {
    /** Settles `film`'s paint (laid out as `layout`) over `box` where the paper has, at `tau` after the base. */
    settle(encoder: GPUCommandEncoder, film: GPUTextureView, layout: StampWashGroupLayer, box: StampPixelBox, tau: number, drying: StampDrying) {
      run(encoder, filmPipelines(layout).settle, [fieldSlot(box, { tau, drying }), targets.paper, film], box);
    },
    /** Settles all of `film`'s paint over `box`, as its painting finishes (ENGINE 4.4). */
    settleAll(encoder: GPUCommandEncoder, film: GPUTextureView, layout: StampWashGroupLayer, box: StampPixelBox) {
      // The paper isn't read, so it's not in this pipeline's layout.
      run(encoder, filmPipelines(layout).settleAll, [fieldSlot(box, {}), null, film], box);
    },
    /** Marks in the open mask where `film` (laid out as `layout`) holds open paint over `box`. */
    markOpen(encoder: GPUCommandEncoder, film: GPUTextureView, layout: StampWashGroupLayer, box: StampPixelBox) {
      run(encoder, filmPipelines(layout).open, [fieldSlot(box, {}), film, targets.open], box);
    },
    /** Moves every stored time back `shift` s over the whole stage. */
    rebase(encoder: GPUCommandEncoder, shift: number) {
      run(encoder, rebase, [fieldSlot(whole, { shift }), targets.paper], whole);
    },
    /**
     * Copies a clip base over the stage: channel `channel` of `from` (r for an unclipped pass's paint, g for a
     * clipped one's) into r of `to`, its g cleared for the paint a pass clipped to it lays.
     */
    clipBase(encoder: GPUCommandEncoder, from: GPUTextureView, to: GPUTextureView, channel: 0 | 1) {
      run(encoder, clipBase, [fieldSlot(whole, { channel }), from, to], whole);
    },
    /** Lands `landing`'s clean water at `tau` after the base, the paper drying as `drying` says. */
    prewet(encoder: GPUCommandEncoder, landing: StampSheetPrewetLanding, tau: number, drying: StampDrying) {
      const { region, fluid, water } = landing, box = region.box, ends = stampPaintFieldEnds(water);
      const uniform = arena.slot((views) => {
        const put = gpuUniformWriter(SHEET_PREWET, views);
        put('origin', [box.x, box.y]);
        put('extent', [box.w, box.h]);
        put('drying', stampDryingWords(drying));
        put('region', stampRegionTexelWords(region.box, 0));
        put('fluid', stampRegionTexelWords(fluid?.box, 0));
        put('geometry', ends.geometry);
        put('ends', [ends.first, ends.second]);
        put('tau', tau);
        put('kind', ends.kind);
      });
      run(encoder, prewet, [uniform, region.view, fluid?.view ?? targets.blank, targets.paper, targets.rim], box);
    },
  };
}

export type StampSheetFieldPasses = ReturnType<typeof stampSheetFieldPasses>;
