// stamp-sheet-reductions.ts: what the forward scheduler reads off the wet field over an application's core
// (ENGINE 3.3, 3.4), decided in f64 on the CPU (models/stamp-sheet-schedule.ts). The core is where its touch, drawn
// before wet hardening, reaches STAMP_SHEET_CORE_CONTACT; each texel weighs its touch times the share it may land
// there: off its fluid (reserves and wax, as the deposit pass weighs them), within its region, inside the clip base.
// A wash's core, for a report, adds its prewet's contact.
//
// Sums are integers, so every total is the same on every run: each 16 × 16 workgroup sums in workgroup atomics (at
// most 2²⁴), then adds into a two-word total, carrying into the high word when the low wraps.

import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { STAMP_DAMP_HISTOGRAM_BINS } from '../models/stamp-damp-histogram.ts';
import {
  STAMP_SHEET_BLOOM_SURPLUS, STAMP_SHEET_CORE_CONTACT, STAMP_SHEET_FAILURE_CELL, STAMP_SHEET_FAILURE_UNSHONE, STAMP_SHEET_TOTALS, STAMP_SHEET_WEIGHT,
} from '../models/stamp-sheet-schedule.ts';
import type { StampSheetWetness } from '../models/stamp-sheet-program.ts';
import { stampRegionTexelWords, type StampStage } from '../models/stamp-stage.ts';
import { STAMP_WET_PAPER_WGSL, type StampDrying } from '../models/stamp-wetness.ts';
import { stampBindGroup, type StampPaintDevice } from './stamp-paint-gpu.ts';
import { STAMP_REGION_AT_WGSL, type StampRegionTexture } from './stamp-region-textures.ts';
import type { StampUniformArena } from './stamp-uniform-arena.ts';
import { stampDryingWords } from './stamp-wet-field.ts';

/** A side of a reduction's workgroup, texels. */
const GROUP = 16;

/**
 * A reduction over the box at `origin`, `extent` texels: the paper's drying, the core's fluid and region boxes and a
 * wash core's prewet region and fluid (stage texels, empty for none), the probe or τ0 (`tau`, after the base), FLAGS,
 * the application's water for a bloom, a histogram's first step and bin width, a failure map's rule and columns.
 */
const REDUCE = gpuUniformLayout('SheetReduce', [
  ['origin', 'vec2u'], ['extent', 'vec2u'], ['drying', 'vec4f'], ['fluid', 'vec4f'], ['within', 'vec4f'], ['prewet', 'vec4f'], ['prewetFluid', 'vec4f'],
  ['tau', 'f32'], ['flags', 'u32'], ['water', 'f32'], ['start', 'u32'], ['width', 'u32'], ['rule', 'u32'], ['columns', 'u32'],
]);

/**
 * What bounds a core besides its touch: off its fluid, within a region, inside the clip base; a bloom check's sum; and
 * a wash core's prewet, whose contact joins its touch.
 */
const FLAGS = { masked: 1, within: 2, clipped: 4, bloom: 8, prewet: 16 } as const;

/** Each rule's word in a failure pass. */
const RULES: Readonly<Record<StampSheetWetness, number>> = { wet: 0, damp: 1, dry: 2 };

const T = STAMP_SHEET_TOTALS;

const REDUCE_WGSL = /* wgsl */ `
${REDUCE.wgsl}
${STAMP_WET_PAPER_WGSL}
@group(0) @binding(0) var<uniform> u: SheetReduce;
@group(0) @binding(1) var core: texture_2d<f32>;
@group(0) @binding(2) var fluid: texture_2d<f32>;
@group(0) @binding(3) var within: texture_2d<f32>;
@group(0) @binding(4) var clip: texture_2d<f32>;
@group(0) @binding(5) var paper: texture_2d<f32>;
@group(0) @binding(6) var open: texture_2d<f32>;
@group(0) @binding(7) var<storage, read_write> words: array<atomic<u32>>;
@group(0) @binding(8) var prewet: texture_2d<f32>;
@group(0) @binding(9) var prewetFluid: texture_2d<f32>;
${Object.entries(FLAGS).map(([flag, bit]) => `const ${flag.toUpperCase()} = ${bit}u;`).join('\n')}
const BINS = ${STAMP_DAMP_HISTOGRAM_BINS}u;
${STAMP_REGION_AT_WGSL}
// A texel's weight in the core: none where its touch is under STAMP_SHEET_CORE_CONTACT, else its touch × the share it
// may land there, × 2¹⁶.
fn coreWeight(p: vec2u) -> u32 {
  var touch = clamp(textureLoad(core, p, 0).r, 0.0, 1.0);
  if ((u.flags & PREWET) != 0u) { touch = max(touch, regionAt(prewet, u.prewet, p) * (1.0 - regionAt(prewetFluid, u.prewetFluid, p))); }
  if (touch < ${STAMP_SHEET_CORE_CONTACT.toFixed(3)}) { return 0u; }
  var allowed = 1.0;
  if ((u.flags & MASKED) != 0u) { allowed *= 1.0 - regionAt(fluid, u.fluid, p); }
  if ((u.flags & WITHIN) != 0u) { allowed *= regionAt(within, u.within, p); }
  if ((u.flags & CLIPPED) != 0u) { allowed *= clamp(textureLoad(clip, p, 0).r, 0.0, 1.0); }
  return u32(round(touch * allowed * ${STAMP_SHEET_WEIGHT}.0));
}
fn ordered(v: f32) -> u32 {
  let bits = bitcast<u32>(v);
  return select(bits ^ 0x80000000u, ~bits, (bits & 0x80000000u) != 0u);
}
// Adds \`value\` into the two-word total at \`at\` (low, then high): the order of the adds can't change the pair.
fn addWide(at: u32, value: u32) {
  if (value == 0u) { return; }
  let old = atomicAdd(&words[at], value);
  if (old > 0xffffffffu - value) { atomicAdd(&words[at + 1u], 1u); }
}
// +∞, made at run time: a constant expression overflowing f32 doesn't compile, and WGSL leaves x / 0 undefined.
fn infinity() -> f32 {
  var bits = 0x7f800000u;
  return bitcast<f32>(bits);
}
// When a texel wetted to \`field.x\` at \`field.y\` turns matte (L) and sets (Z), after the base: stampDryingTimes'
// matteFrom and setFrom. On a sheet that never dries (rate 0) a wetted texel never sets, and is matte from the start
// if no wetter than damp, else never.
fn matteAt(field: vec4f) -> f32 {
  if (u.drying.x <= 0.0) { return select(infinity(), -infinity(), field.x <= u.drying.z); }
  return field.y + (field.x - u.drying.z) / u.drying.x;
}
fn setAt(field: vec4f) -> f32 {
  if (u.drying.x <= 0.0) { return infinity(); }
  return field.y + u.drying.y + field.x / u.drying.x;
}
fn isDamp(field: vec4f, at: WetPaper) -> bool { return field.x > 0.0 && at.wetness <= u.drying.z && at.workable > 0.0; }
fn inBox(id: vec3u) -> bool { return all(id.xy < u.extent); }

var<workgroup> sums: array<atomic<u32>, 7>;
var<workgroup> extremes: array<atomic<u32>, 2>;
// The core's totals at the probe (STAMP_SHEET_TOTALS): weight, wet, damp, workable, never wetted, able to bloom, laid
// shiny and dried past it; the least matte time kept as its complement's max, and the latest set.
@compute @workgroup_size(${GROUP}, ${GROUP}) fn totals(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) local: u32) {
  if (inBox(id)) {
    let p = u.origin + id.xy;
    let w = coreWeight(p);
    if (w > 0u) {
      let field = textureLoad(paper, p, 0);
      let at = wetPaperAt(field, u.tau, u.drying.xyz);
      atomicAdd(&sums[0], w);
      if (at.wetness > u.drying.w) { atomicAdd(&sums[1], w); }
      if (isDamp(field, at)) { atomicAdd(&sums[2], w); }
      if (at.workable > 0.0) { atomicAdd(&sums[3], w); }
      if (field.x <= 0.0) { atomicAdd(&sums[4], w); }
      let opened = (u.flags & BLOOM) != 0u && textureLoad(open, p, 0).r > 0.0;
      if (opened && at.workable > 0.0 && u.water - at.wetness > ${STAMP_SHEET_BLOOM_SURPLUS.toFixed(4)}) { atomicAdd(&sums[5], w); }
      if (field.x > u.drying.w && at.wetness <= u.drying.w) { atomicAdd(&sums[6], w); }
      if (field.x > 0.0) {
        atomicMax(&extremes[0], ~ordered(matteAt(field)));
        atomicMax(&extremes[1], ordered(setAt(field)));
      }
    }
  }
  workgroupBarrier();
  if (local < 7u) { addWide(2u * local, atomicLoad(&sums[local])); }
  if (local == 7u) { atomicMax(&words[${T.leastMatte}u], atomicLoad(&extremes[0])); }
  if (local == 8u) { atomicMax(&words[${T.latestSet}u], atomicLoad(&extremes[1])); }
}

// The latest any texel of the box sets, wetted or not by the core: when what was laid there has set.
@compute @workgroup_size(${GROUP}, ${GROUP}) fn boxLatest(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) local: u32) {
  if (inBox(id)) {
    let field = textureLoad(paper, u.origin + id.xy, 0);
    if (field.x > 0.0) { atomicMax(&extremes[1], ordered(setAt(field))); }
  }
  workgroupBarrier();
  if (local == 0u) { atomicMax(&words[${T.boxLatestSet}u], atomicLoad(&extremes[1])); }
}

// The first 1 ms step from τ0 at or past \`t\`, at least 0.
fn stepOf(t: f32) -> u32 { return u32(clamp(ceil((t - u.tau) * 1000.0 - 1e-3), 0.0, 4.0e9)); }
// Weight into bin \`base\` + its step's bin, or into \`before\` short of the first.
fn binned(step: u32, base: u32, before: u32, w: u32) {
  if (step < u.start) {
    addWide(before, w);
    return;
  }
  let bin = (step - u.start) / u.width;
  if (bin < BINS) { addWide(2u * (base + bin), w); }
}
// A damp histogram (stampDampHistogram): each wetted core texel's weight by the step it turns matte, and by its last
// workable step, one before the step it sets. Weight set by the first step goes into its \`before\` words, so a bin's
// bound subtracts every texel set by its start, those set before τ0 among them.
@compute @workgroup_size(${GROUP}, ${GROUP}) fn histogram(@builtin(global_invocation_id) id: vec3u) {
  if (!inBox(id)) { return; }
  let p = u.origin + id.xy;
  let w = coreWeight(p);
  let field = textureLoad(paper, p, 0);
  if (w == 0u || field.x <= 0.0) { return; }
  binned(stepOf(matteAt(field)), 0u, 4u * BINS, w);
  let sets = stepOf(setAt(field));
  if (sets <= u.start) {
    addWide(4u * BINS + 2u, w);
    return;
  }
  binned(sets - 1u, BINS, 4u * BINS + 2u, w);
}

// A failure map: each ${STAMP_SHEET_FAILURE_CELL} px cell of the box holding a core texel its rule fails at the probe,
// its bits why (STAMP_SHEET_FAILURE_UNSHONE for a \`wet\` texel never laid shiny, else 1).
@compute @workgroup_size(${GROUP}, ${GROUP}) fn failure(@builtin(global_invocation_id) id: vec3u) {
  if (!inBox(id)) { return; }
  let p = u.origin + id.xy;
  if (coreWeight(p) == 0u) { return; }
  let field = textureLoad(paper, p, 0);
  let at = wetPaperAt(field, u.tau, u.drying.xyz);
  let holds = select(select(at.workable <= 0.0, isDamp(field, at), u.rule == 1u), at.wetness > u.drying.w, u.rule == 0u);
  let why = select(1u, ${STAMP_SHEET_FAILURE_UNSHONE}u, u.rule == 0u && field.x <= u.drying.w);
  if (!holds) { atomicOr(&words[(id.y / ${STAMP_SHEET_FAILURE_CELL}u) * u.columns + id.x / ${STAMP_SHEET_FAILURE_CELL}u], why); }
}`;

/** A wash's prewet as its core takes it: the region its water lands in, and the fluid holding it off (null for none). */
export type StampSheetPrewetCore = { region: StampRegionTexture; fluid: StampRegionTexture | null };

/**
 * A core as the reductions bound it: the texels of its box, its fluid and region (null for none), whether it's
 * clipped; for a wash's core, its prewet (null for an application's, or a wash without one).
 */
export type StampSheetCore = {
  box: StampPixelBox; fluid: StampRegionTexture | null; within: { region: StampRegionTexture | null } | null; clipped: boolean; prewet: StampSheetPrewetCore | null;
};

/** A probe of a core: at `tau` after the field's base, the paper drying as `drying` says. */
export type StampSheetProbe = { core: StampSheetCore; tau: number; drying: StampDrying };

/** What the reductions read: the core's touch (r16float), the clip base, the field's paper, the open-paint mask; `blank` for a region of none. */
export type StampSheetReduceTextures = { core: GPUTextureView; clip: GPUTextureView; paper: GPUTextureView; open: GPUTextureView; blank: GPUTextureView };

/** A failure map's columns and rows over `box`. */
export const stampSheetFailureGrid = (box: StampPixelBox) => ({ columns: Math.ceil(box.w / STAMP_SHEET_FAILURE_CELL), rows: Math.ceil(box.h / STAMP_SHEET_FAILURE_CELL) });

/** Which of FLAGS bound `core`. */
const coreFlags = ({ fluid, within, clipped, prewet }: StampSheetCore) =>
  (fluid ? FLAGS.masked : 0) | (within ? FLAGS.within : 0) | (clipped ? FLAGS.clipped : 0) | (prewet ? FLAGS.prewet : 0);

type StampSheetReduceWriter = ReturnType<typeof gpuUniformWriter<typeof REDUCE.fields>>;

/** The reductions on `device` over `stage`'s texels (its regions' boxes in painting points), each pass's uniform from `arena`, reading `textures`. */
export function stampSheetReductions(device: StampPaintDevice, stage: StampStage, arena: StampUniformArena, textures: StampSheetReduceTextures) {
  const module = device.createShaderModule({ code: REDUCE_WGSL });
  const pipeline = (entryPoint: string) => device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } });
  const pipelines = { totals: pipeline('totals'), boxLatest: pipeline('boxLatest'), histogram: pipeline('histogram'), failure: pipeline('failure') };
  /** Dispatches `kind` over the probe's core into `words`, its uniform's common fields written, then `more`. */
  const reduce = (encoder: GPUCommandEncoder, kind: keyof typeof pipelines, words: GPUBuffer, { core, tau, drying }: StampSheetProbe, more: (put: StampSheetReduceWriter) => void = () => {}) => {
    const { box, fluid, within, prewet } = core, chosen = pipelines[kind];
    const uniform = arena.slot((views) => {
      const put = gpuUniformWriter(REDUCE, views);
      put('origin', [box.x, box.y]);
      put('extent', [box.w, box.h]);
      put('drying', stampDryingWords(drying));
      put('fluid', stampRegionTexelWords(fluid?.box, stage));
      put('within', stampRegionTexelWords(within?.region?.box, stage));
      put('prewet', stampRegionTexelWords(prewet?.region.box, stage));
      put('prewetFluid', stampRegionTexelWords(prewet?.fluid?.box, stage));
      put('tau', tau);
      put('flags', coreFlags(core));
      more(put);
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(chosen);
    // An automatic layout holds only the bindings its entry point reads: the box's latest reads no core, and only the totals read the open mask.
    const cored = kind !== 'boxLatest', opened = kind === 'totals';
    pass.setBindGroup(0, stampBindGroup(device, chosen, [
      uniform, cored ? textures.core : null, cored ? fluid?.view ?? textures.blank : null, cored ? within?.region?.view ?? textures.blank : null, cored ? textures.clip : null,
      textures.paper, opened ? textures.open : null, { buffer: words },
      cored ? prewet?.region.view ?? textures.blank : null, cored ? prewet?.fluid?.view ?? textures.blank : null,
    ]));
    pass.dispatchWorkgroups(Math.ceil(box.w / GROUP), Math.ceil(box.h / GROUP));
    pass.end();
  };
  return {
    /** The core's totals at the probe into `words` (STAMP_SHEET_TOTALS), able to bloom by water `bloom` (null to sum none). */
    totals: (encoder: GPUCommandEncoder, words: GPUBuffer, probe: StampSheetProbe, bloom: number | null) => reduce(encoder, 'totals', words, probe, (put) => {
      if (bloom === null) return;
      put('flags', coreFlags(probe.core) | FLAGS.bloom);
      put('water', bloom);
    }),
    /** The latest any texel of `box` sets, into `words`' boxLatestSet. */
    boxLatest: (encoder: GPUCommandEncoder, words: GPUBuffer, box: StampPixelBox, drying: StampDrying) =>
      reduce(encoder, 'boxLatest', words, { core: { box, fluid: null, within: null, clipped: false, prewet: null }, tau: 0, drying }),
    /** A damp histogram of the core from τ0 (the probe's `tau`), its bins `width` steps wide from step `start`. */
    histogram: (encoder: GPUCommandEncoder, words: GPUBuffer, probe: StampSheetProbe, start: number, width: number) => reduce(encoder, 'histogram', words, probe, (put) => {
      put('start', start);
      put('width', width);
    }),
    /** The cells of the core's box where `on` fails at the probe (stampSheetFailureGrid's). */
    failure: (encoder: GPUCommandEncoder, words: GPUBuffer, probe: StampSheetProbe, on: StampSheetWetness) => reduce(encoder, 'failure', words, probe, (put) => {
      put('rule', RULES[on]);
      put('columns', stampSheetFailureGrid(probe.core.box).columns);
    }),
  };
}

export type StampSheetReductions = ReturnType<typeof stampSheetReductions>;
