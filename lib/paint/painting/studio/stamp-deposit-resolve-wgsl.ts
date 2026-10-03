// stamp-deposit-resolve-wgsl.ts: the WGSL resolving a deposit's mask onto its group's layer (stamp-deposit-drawing.ts):
// its builds, edges, grains, dual and pooling in its plan's order, then the paper's tooth, the fluid, its `within`, a
// flood's load and the clip, laid by its compositor; a wash deposit hardening on drier paper and leaving its footprint.

import { STAMP_ACCUMULATION_RESOLVE_WGSL, STAMP_RESOLVE_PLANS, stampResolveOrdersWgsl } from '../models/stamp-deposit-stages.ts';
import { STAMP_PAINT_FIELD_SHARE } from '../models/stamp-paint-field.ts';
import { STAMP_WET_PAPER_WGSL } from '../models/stamp-wetness.ts';
import { STAMP_WET_LAND_WGSL } from '../models/stamp-wet-landing.ts';
import { stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import { gpuUniformLayout, gpuUniformStruct } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { stampPaintTargetWgsl, type StampPaintCompositor, type StampPaintTarget } from './stamp-paint-compositor.ts';
import { STAMP_WORKGROUP } from './stamp-paint-gpu.ts';
import { STAMP_GRAIN, STAMP_GRAIN_WGSL } from './stamp-deposit-stamp-wgsl.ts';

/** A deposit's resolve uniform. Its compositor's PaintDeposit has a slot of its own, `paint`, as this one is full. */
export const STAMP_DEPOSIT = gpuUniformLayout('Deposit', [
  ['view', 'vec4f'], ['edges', 'vec4f'], ['dualEdges', 'vec4f'],
  ['grain', gpuUniformStruct(STAMP_GRAIN)], ['dualGrain', gpuUniformStruct(STAMP_GRAIN)], ['paperDepth', 'f32'], ['paperLod', 'f32'], ['opacity', 'f32'],
  ['dualBlend', 'i32'], ['flags', 'u32'], ['resolveOrder', 'i32'], ['origin', 'vec2u'], ['extent', 'vec2u'],
  ['build', 'vec2f'], ['accumulation', 'vec2u'], ['pooling', 'vec4f'], ['press', 'f32'], ['beforeReach', 'f32'],
]);

/** What a deposit's resolve does, a bit each in its `flags`, and a WGSL constant each of the same name in capitals. */
export const STAMP_DEPOSIT_FLAGS = {
  canvasGrain: 1, dual: 2, dualCanvasGrain: 4, paper: 8, masked: 16, clipped: 32, clips: 64,
  pooled: 128, dualPooled: 256, dualLayer: 512, within: 1024, flood: 2048,
} as const;

/**
 * Where a deposit's paint is kept, beside its Deposit (whose slot is full): its fluid's and `within`'s boxes (x, y,
 * width, height), and a fill's load field (STAMP_PAINT_FIELD_SHARE); how far round a pixel its stroke's body is
 * looked for, where its coverage hardens (strokeBodyAt).
 */
export const STAMP_DEPOSIT_KEEP = gpuUniformLayout('Keep', [
  ['fluid', 'vec4f'], ['within', 'vec4f'], ['load', 'vec4f'], ['loadEnds', 'vec2f'], ['loadKind', 'i32'], ['bodyReach', 'f32'],
]);
/**
 * A wash deposit's landing (StampWetLanding): how its paper dries (stampDryingWords), its painting second, its
 * brush's water, a lift's strength, and what it does. The paper it finds is the wash's wet field's (stamp-wet-field.ts).
 */
export const STAMP_DEPOSIT_WET_OP = gpuUniformLayout('WetOp', [
  ['drying', 'vec4f'], ['tau', 'f32'], ['water', 'f32'], ['strength', 'f32'], ['action', 'u32'],
]);
/**
 * How far round a pixel a wash's resolve looks for its stroke's body (strokeBodyAt), as a share of its diameter: across
 * a soft shoulder. Not the tip's whole reach: that reaches along the stroke too, lifting a thinner run (a pooled end,
 * darkest at half coverage) to denser build nearby. Follow-up: the stroke's measured fringe width.
 */
export const STAMP_WET_BODY_REACH = 0.2;
export const STAMP_WET_ACTIONS = { paint: 0, water: 1, lift: 2 } as const;
const WET_WGSL = /* wgsl */ `
${STAMP_DEPOSIT_WET_OP.wgsl}
${STAMP_WET_PAPER_WGSL}
@group(0) @binding(18) var wetField: texture_2d<f32>;
@group(0) @binding(19) var<uniform> wet: WetOp;
@group(0) @binding(20) var footprint: texture_storage_2d<rgba16float, write>;
${Object.entries(STAMP_WET_ACTIONS).map(([action, index]) => `const WET_${action.toUpperCase()} = ${index}u;`).join('\n')}
struct WetLanding { wetness: f32, workable: f32, settled: f32, tau: f32, water: f32, strength: f32, action: u32 }
// The paper under stage texel \`pixel\` as the wash's wet field holds it.
fn wetLandingAt(pixel: vec2u) -> WetLanding {
  let paper = wetPaperAt(textureLoad(wetField, pixel, 0), wet.tau, wet.drying.xyz);
  return WetLanding(paper.wetness, paper.workable, paper.settled, wet.tau, wet.water, wet.strength, wet.action);
}
`;
// On paper drier than its water a wash brush's stroke stops at a hard edge (wetLandCover), before its grain and the
// paper's tooth, which break the hardened stroke as they would any.
const WET_HARDEN_COVER_WGSL = /* wgsl */ `let landing = wetLandingAt(pixel);
  raw.x = wetLandCover(raw.x, strokeBodyAt(pixel, raw.x, k.bodyReach), landing.water, landing.wetness);`;
// A wash deposit lands, leaving its footprint for later stages (StampWetDepositMoment): the share of its
// stroke its landing (hardening, dual, grain, tooth) kept, before opacity, load and colour; where paint may land; the
// paper's tooth. The flow lands its water by that share, so grain holes stay dry; a stroke faded to no
// pigment still wets the paper.
const WET_LAND_WGSL = /* wgsl */ `landDeposit(pixel, coverage, rims, tooth, at, reserved, landing);
  let landedPaint = clamp(m, 0.0, 1.0);
  let strokeMost = max(max(strokeBuilt, raw.r), landedPaint);
  let landedShare = select(0.0, landedPaint * toothKept / strokeMost, strokeMost > 0.0);
  var allowed = 1.0;
  if ((u.flags & MASKED) != 0u) { allowed *= 1.0 - regionAt(fluid, k.fluid, pixel); }
  if ((u.flags & WITHIN) != 0u) { allowed *= regionAt(within, k.within, pixel); }
  if ((u.flags & CLIPPED) != 0u) { allowed *= clamp(clipped.r, 0.0, 1.0); }
  textureStore(footprint, pixel, vec4f(landedShare, allowed, tooth));`;
export const STAMP_DEPOSIT_FLAGS_WGSL = Object.entries(STAMP_DEPOSIT_FLAGS).map(([flag, bit]) => `const ${flag.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()} = ${bit}u;`).join('\n');

// The layer as the deposit found it (StampPaintCompositor's reads.before), read round each pixel.
const beforeWgsl = (layer: StampPaintTarget) => `@group(0) @binding(23) var before: ${layer.kind === 'array' ? 'texture_2d_array<f32>' : 'texture_2d<f32>'};`;
// How hard a deposit pressed at a pixel: its stamps' pressure there (pressOf), firm where none laid it, and
// \`u.press\` harder for a burnish, so a burnishing hand still eases where it turns.
const PRESS_AT_WGSL = /* wgsl */ `@group(0) @binding(22) var pressed: texture_2d<f32>;
fn pressAt(pixel: vec2u) -> f32 {
  let p = textureLoad(pressed, pixel, 0).r;
  return select(1.0, p - 1.0, p > 0.0) + u.press;
}`;

/**
 * Each resolve stage on the main layer's coverage `m`: `d` is the dual's, cut and pooled already, `at` the pixel. A
 * traced resolve records `m` after each (traced), so what a diagnosis reads is what the frame lays.
 */
export const STAMP_RESOLVE_STAGES_WGSL = stampResolveOrdersWgsl('resolveStages', 'd: f32, at: vec2f', {
  grain: 'if ((u.flags & CANVAS_GRAIN) != 0u) { m = texturized(grain, at, m, u.grain); }',
  dual: 'if ((u.flags & DUAL) != 0u) { m = dualCombine(m, d, u.dualBlend, (u.flags & DUAL_LAYER) != 0u); }',
  pooling: 'if ((u.flags & POOLED) != 0u) { m = pooled(m, u.pooling.x, u.pooling.y); }',
}, (position) => `traced(${position}u, m);`);

// A canvas grain cutting coverage `a` at `at`, its tile repeating or mirrored; after STAMP_GRAIN_WGSL, with `tile` and
// `mirrorTile` bound.
export const STAMP_TEXTURIZED_WGSL = /* wgsl */ `
fn texturized(g: texture_2d<f32>, at: vec2f, a: f32, p: Grain) -> f32 {
  let uv = at / p.place.xy + p.place.zw;
  let raw = select(textureSampleLevel(g, tile, uv, p.shape.y).r, textureSampleLevel(g, mirrorTile, uv, p.shape.y).r, p.mirror == 1u);
  return grained(a, raw, grainMean(g, tile), p, 1.0);
}`;

/**
 * Values a traced resolve records per pixel: the build as its accumulation resolves it, after each stage, the
 * accumulator as its stamps left it (build, then densest stamp), and the coverage laid.
 */
export const STAMP_TRACE_SLOTS = STAMP_RESOLVE_PLANS.grainFirst.length + 4;
/** Where the accumulator's build and densest stamp sit among a pixel's trace slots. */
export const STAMP_TRACE_ACCUMULATOR = STAMP_TRACE_SLOTS - 3;

/** A traced deposit's crop (its origin and size in the painting's pixels) and where in the trace buffer its slots start, in floats. */
export const STAMP_TRACE_CROP = gpuUniformLayout('TraceCrop', [['origin', 'vec2u'], ['extent', 'vec2u'], ['offset', 'u32']]);

// A compute pass has no derivatives, so each grain's mip level is worked out on the CPU. A wash's resolve (`wet`) is
// a module of its own: WGSL counts a binding read under a false override as used, and a dry resolve mustn't hold
// the wet bindings.
export const stampDepositResolveWgsl = (compositor: StampPaintCompositor, wet: boolean, stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${STAMP_DEPOSIT.wgsl}
${compositor.deposit.layout.wgsl}
${stampPaintTargetWgsl('layer', 8, compositor.targets.layer, 'read_write')}
${compositor.deposit.wgsl}
${STAMP_GRAIN_WGSL}
${STAMP_DEPOSIT_FLAGS_WGSL}
${STAMP_ACCUMULATION_RESOLVE_WGSL}
${STAMP_RESOLVE_STAGES_WGSL}
${STAMP_DEPOSIT_KEEP.wgsl}
${STAMP_TRACE_CROP.wgsl}
${STAMP_PAINT_FIELD_SHARE.wgsl}
${STAMP_WET_LAND_WGSL}
${wet ? `${WET_WGSL}\n${stampPaintTargetWgsl('fresh', 21, compositor.targets.layer, 'write')}\n${compositor.deposit.wet}` : ''}
${compositor.reads.press ? PRESS_AT_WGSL : ''}
${compositor.reads.before ? beforeWgsl(compositor.targets.layer) : ''}
// The diagnostic variant (StampPaintRenderer's trace): the same resolve, recording each stage's coverage as it goes.
override TRACE: bool = false;
var<private> tracedPixel: vec2u;
// Records \`value\` as the pixel's \`slot\` (STAMP_TRACE_SLOTS a pixel, each a plane of the crop), within the traced crop.
fn traced(slot: u32, value: f32) {
  if (!TRACE) { return; }
  let q = tracedPixel - tracing.origin;
  if (any(tracedPixel < tracing.origin) || any(q >= tracing.extent)) { return; }
  traces[tracing.offset + (slot * tracing.extent.y + q.y) * tracing.extent.x + q.x] = value;
}
@group(0) @binding(0) var<uniform> u: Deposit;
@group(0) @binding(1) var mask: texture_2d<f32>;
@group(0) @binding(2) var blurred: texture_2d<f32>;
@group(0) @binding(3) var grain: texture_2d<f32>;
@group(0) @binding(4) var dualGrain: texture_2d<f32>;
@group(0) @binding(5) var paperGrain: texture_2d<f32>;
@group(0) @binding(6) var fluid: texture_2d<f32>;
@group(0) @binding(7) var clip: texture_storage_2d<rgba16float, read_write>;
@group(0) @binding(9) var linearClamp: sampler;
@group(0) @binding(10) var tile: sampler;
@group(0) @binding(11) var<storage, read_write> traces: array<f32>;
@group(0) @binding(12) var<uniform> tracing: TraceCrop;
@group(0) @binding(13) var cap: texture_2d<f32>;
@group(0) @binding(14) var mirrorTile: sampler;
@group(0) @binding(15) var<uniform> k: Keep;
@group(0) @binding(16) var within: texture_2d<f32>;
@group(0) @binding(17) var<uniform> paint: ${compositor.deposit.layout.name};
// A region texture's value at a texel, its box's x, y, width and height in the stage's texels: none outside it.
fn regionAt(region: texture_2d<f32>, box: vec4f, pixel: vec2u) -> f32 {
  let q = vec2f(pixel) - box.xy;
  if (any(q < vec2f(0.0)) || any(q >= box.zw)) { return 0.0; }
  return textureLoad(region, vec2u(q), 0).r;
}
${STAMP_TEXTURIZED_WGSL}

// Where the mask stands above its blur, as steeply as the edge's sharpness says.
fn rimOf(a: f32, soft: f32, sharpness: f32) -> f32 { return clamp((a - soft) * sharpness, 0.0, 1.0); }
// The stroke's body near \`pixel\`: the most its build reaches within \`reach\`, in the deposit's box, so a hardened edge
// keeps the stroke's own density.
fn strokeBodyAt(pixel: vec2u, here: f32, reach: f32) -> f32 {
  var body = here;
  let lo = vec2f(u.origin);
  let hi = vec2f(u.origin + u.extent) - 1.0;
  for (var i = 0; i < 12; i++) {
    let outer = i < 8;
    let angle = select(f32(i - 8) * 1.5708 + 0.3927, f32(i) * 0.7854, outer);
    let q = vec2u(clamp(vec2f(pixel) + select(0.5, 1.0, outer) * reach * vec2f(cos(angle), sin(angle)), lo, hi));
    let kept = textureLoad(cap, q, 0);
    body = max(body, accumulationResolve(textureLoad(mask, q, 0).r, kept.b, kept.r, u.build.x, i32(u.accumulation.x)));
  }
  return body;
}

@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn deposit(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  // \`pixel\` is the stage's texel, \`at\` its centre as a painting point: what every grain, field and noise reads.
  let pixel = u.origin + id.xy;
  let at = stagePoint(vec2i(pixel));
  tracedPixel = pixel;
  // Each layer's stroke as its accumulation resolves it: a glaze's from its densest stamp (the cap's blue or alpha)
  // toward the build held under its cap (red or green).
  let built = textureLoad(mask, pixel, 0).rg;
  let kept = textureLoad(cap, pixel, 0);
  traced(${STAMP_TRACE_ACCUMULATOR}u, built.x);
  traced(${STAMP_TRACE_ACCUMULATOR + 1}u, kept.b);
  var raw = vec2f(
    accumulationResolve(built.x, kept.b, kept.r, u.build.x, i32(u.accumulation.x)),
    accumulationResolve(built.y, kept.a, kept.g, u.build.y, i32(u.accumulation.y)),
  );
  let soft = textureSampleLevel(blurred, linearClamp, (vec2f(pixel) + 0.5) / u.view.xy, 0.0);
  var burnt = rimOf(raw.r, soft.r, u.edges.w) * u.edges.z;
  var dualBurnt = 0.0;
  // The dual's own grain and pooling come before it combines, wherever its plan puts the combine.
  var d = 0.0;
  if ((u.flags & DUAL) != 0u) {
    d = raw.g;
    if ((u.flags & DUAL_CANVAS_GRAIN) != 0u) { d = texturized(dualGrain, at, d, u.dualGrain); }
    if ((u.flags & DUAL_POOLED) != 0u) { d = pooled(d, u.pooling.z, u.pooling.w); }
    dualBurnt = rimOf(raw.g, soft.g, u.dualEdges.w) * u.dualEdges.z * step(0.0001, raw.r);
  }
  let strokeBuilt = raw.r;
  ${wet ? WET_HARDEN_COVER_WGSL : ''}
  // The stages in the order of the brush's plan (STAMP_RESOLVE_PLANS), or a diagnosis's.
  traced(0u, raw.r);
  var m = resolveStages(raw.r, d, at, u.resolveOrder);
  // A wet rim is laid after the dual combines, as the whole stroke's pigment gathers there, but through the grain: a
  // grain that breaks the body into flecks breaks its rim too.
  var wet = rimOf(raw.r, soft.r, u.edges.y) * u.edges.x;
  if ((u.flags & CANVAS_GRAIN) != 0u) { wet = texturized(grain, at, wet, u.grain); }
  m += wet;
  var keep = 1.0;
  // What \`keep\` would be without the fluid, and how much the fluid held off (\`held\`), for reserved below.
  var reach = 1.0;
  var held = 0.0;
  // No tooth reads as an even paper: its paint and mean alike.
  var tooth = vec2f(0.5);
  // A paper's tooth tiles mirrored, a photograph not being seamless; its mean is its smallest mip.
  var toothKept = 1.0;
  if ((u.flags & PAPER) != 0u) {
    tooth = vec2f(1.0 - textureSampleLevel(paperGrain, mirrorTile, at / u.view.zw, u.paperLod).r, 1.0 - textureSampleLevel(paperGrain, tile, vec2f(0.5), 16.0).r);
    toothKept = paperKept(tooth.x, tooth.y, u.paperDepth);
    keep *= toothKept;
    reach = keep;
  }
  if ((u.flags & MASKED) != 0u) {
    held = regionAt(fluid, k.fluid, pixel);
    keep *= 1.0 - held;
  }
  if ((u.flags & WITHIN) != 0u) {
    let inside = regionAt(within, k.within, pixel);
    keep *= inside;
    reach *= inside;
  }
  // A fill's load is how much paint it lays: burnt edges and a clip base alike.
  if ((u.flags & FLOOD) != 0u) {
    let load = clamp(mix(k.loadEnds.x, k.loadEnds.y, paintFieldShare(at, k.loadKind, k.load)), 0.0, 1.0);
    keep *= load;
    reach *= load;
  }
  let clipped = textureLoad(clip, pixel);
  if ((u.flags & CLIPPED) != 0u) {
    let inClip = clamp(clipped.r, 0.0, 1.0);
    keep *= inClip;
    reach *= inClip;
  }
  let coverage = clamp(m, 0.0, 1.0) * keep * u.opacity;
  // In a knockout, its reserve: the fluid within the deposit's reach, however its brush's marks cover, as the paint
  // behind is whole and only the fluid kept it off.
  let reserved = reach * held * u.opacity;
  traced(${STAMP_TRACE_SLOTS - 1}u, coverage);
  // A burnt rim burns into paint already there, the group's or the deposit's own (its stamps laid over one another).
  let burnable = max(layerCoverage(pixel), clamp(m, 0.0, 1.0)) * keep * u.opacity;
  let rims = vec2f(clamp(burnt, 0.0, 1.0) * burnable, clamp(dualBurnt, 0.0, 1.0) * burnable);
  ${wet ? WET_LAND_WGSL : `layDeposit(pixel, coverage, rims, tooth, at, ${compositor.reads.press ? 'pressAt(pixel)' : '1.0'});`}
  // The clip base is r. A clipped pass reads it and lays its own paint's in g, a base for a wash clipping to it.
  if ((u.flags & CLIPS) != 0u) {
    let laid = vec4f(coverage) + clipped * (1.0 - coverage);
    textureStore(clip, pixel, select(laid, vec4f(clipped.r, laid.g, clipped.ba), (u.flags & CLIPPED) != 0u));
  }
}`;
