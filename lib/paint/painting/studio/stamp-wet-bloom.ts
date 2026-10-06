// stamp-wet-bloom.ts: the wet stage for blooms and backruns (models/stamp-wet-bloom.ts). A wash deposit's surplus
// water spreads over the wet paper the wash's paint reaches, stalls at a lobed front, and the paint it loosens inside
// is carried there, over the deposit's box. Both move by the shared transport (stamp-wet-transport.ts), so neither
// crosses masking fluid, a `within`'s edge or a dry gap. The GPU sizes each bloom from the paper its water found,
// within the CPU's bound (stampBloomBound).
//
// Carrying is the normalised scatter: what a pixel gives up is exactly what the band gains, per pigment.
//
// Negative space: the spreading water isn't written back into the wash's wetness; later deposits don't see it.

import { STAMP_BLOOM_BAND_WIDTH, STAMP_BLOOM_CARRY_SPREAD, STAMP_BLOOM_LEAST_SIGMA, STAMP_WET_BLOOM_WGSL, stampBloomBound, stampBloomReach } from '../models/stamp-wet-bloom.ts';
import { STAMP_WET_LIFT_WGSL } from '../models/stamp-wet-lift.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe-compile.ts';
import { STAMP_WRAP_FROM_NONE, stampAxisWords, stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import { stampWetStageExtentOf, type StampLoadedWetStage, type StampWetDepositMoment, type StampWetStage, type StampWetStageContext, type StampWetStageExtent } from './stamp-wet-stages.ts';
import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { destroyStampTexturesOnceSubmitted } from './stamp-paint-gpu.ts';
import { encodeStampWetTransportSteps, stampWetSpreads, stampWetTransportGate, type StampWetTransportStep } from './stamp-wet-transport.ts';

const WORKGROUP = 8;

/**
 * A pixel gives its paint up fully only as near a front as `STAMP_BLOOM_SEND_FLOOR` of a straight front's reach
 * (the band spread as far as paint is carried), less further out: a pixel with a sliver of front in reach would pour
 * all it loosens into that sliver.
 */
const STAMP_BLOOM_SEND_FLOOR = 0.2;

/**
 * A bloom: its box, seed and diameter; the medium's spread, damp and shiny (PaintSheen); the widest its water could
 * spread (stampBloomBound), which its spreads are sized by; and on a wrapping stage, where its front is keyed within a
 * wrap of (its deposit's wrapFrom), so a copy past a seam blooms as it does.
 */
const BLOOM = gpuUniformLayout('Bloom', [
  ['origin', 'vec2u'], ['extent', 'vec2u'], ['seed', 'u32'], ['damp', 'f32'], ['shine', 'f32'], ['spread', 'f32'], ['diameter', 'f32'], ['bound', 'f32'],
  ['wrapFrom', 'vec2f'],
]);

/**
 * What a bloom's sizing finds, the most surplus driving it and where paint is workable (bit patterns of non-negative
 * floats, ordered as their u32s), and what it sizes from them: its drive and sigma, its sigma's share of its bound
 * (the transport's paper is that much narrower), and its send floor.
 */
const SIZING_WGSL = /* wgsl */ `
struct BloomSizing { driven: atomic<u32>, surplus: atomic<u32>, drive: f32, sigma: f32, ratio: f32, sendFloor: f32 }
struct BloomSized { driven: u32, surplus: u32, drive: f32, sigma: f32, ratio: f32, sendFloor: f32 }`;
const SIZING_BYTES = 24;

// Scratch textures are indexed from the bloom's origin, so they're only as big as the largest box.
const PRELUDE = /* wgsl */ `
${BLOOM.wgsl}
${SIZING_WGSL}
@group(0) @binding(0) var<uniform> u: Bloom;
// The scratch texel an invocation works on, or none past the bloom's extent.
fn localOf(id: vec3u) -> vec2i { return select(vec2i(-1), vec2i(id.xy), all(id.xy < u.extent)); }
`;

// Whether the bloom runs (stampWetTransportGate): the scratch texel a pass after its sizing works on, or none past its
// extent or while its sizing keeps the gate shut.
const GATE_WGSL = /* wgsl */ `
@group(0) @binding(11) var<storage, read> gate: array<u32, 1>;
fn gatedLocalOf(id: vec3u) -> vec2i { return select(vec2i(-1), localOf(id), gate[0] != 0u); }
`;

// The deposit's landing (the wet field's), which holds the paper as found ROUND.wettest round its box: the
// paper's wetness and workability as found (yz), and its wetness once the deposit's water landed (w).
const LANDING_WGSL = /* wgsl */ `
@group(0) @binding(2) var landing: texture_2d<f32>;
fn landingAt(p: vec2i) -> vec4f { return textureLoad(landing, clamp(p, vec2i(0), vec2i(textureDimensions(landing)) - 1), 0); }
fn workableAt(p: vec2i) -> f32 { return landingAt(p).z; }
fn wetnessAfterAt(p: vec2i) -> f32 { return landingAt(p).w; }
`;

/**
 * The paper round a pixel, every `step` px: the wettest within `wettest` px, the wettest within `before` and the
 * least workable within `workable`. A drop's fringe touches paper only partly; against its own pixel's paper alone it
 * would bloom along every stroke beside a wet one. Worked out once per bloom, separably, rows then columns.
 */
const ROUND = { wettest: 12, before: 8, workable: 4, step: 4 };

// Per row of the box and ROUND.wettest past it: the wettest along it within ROUND.wettest (x) and ROUND.before (y),
// the least workable within ROUND.workable (z).
const ROUND_ROWS_WGSL = /* wgsl */ `${PRELUDE}${LANDING_WGSL}
@group(0) @binding(13) var rows: texture_storage_2d<rgba32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent + vec2u(0u, ${2 * ROUND.wettest}u))) { return; }
  let p = vec2i(u.origin) + vec2i(id.xy) - vec2i(0, ${ROUND.wettest});
  var row = vec4f(0.0, 0.0, 1.0, 0.0);
  for (var i = -${ROUND.wettest}; i <= ${ROUND.wettest}; i += ${ROUND.step}) {
    let found = landingAt(p + vec2i(i, 0)).yz;
    row.x = max(row.x, found.x);
    if (abs(i) <= ${ROUND.before}) { row.y = max(row.y, found.x); }
    if (abs(i) <= ${ROUND.workable}) { row.z = min(row.z, found.y); }
  }
  textureStore(rows, id.xy, row);
}`;

// The rows' columns, into the same three per pixel of the box.
const ROUND_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(13) var rows: texture_2d<f32>;
@group(0) @binding(12) var paperRounds: texture_storage_2d<rgba32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  var rounds = vec4f(0.0, 0.0, 1.0, 0.0);
  for (var j = -${ROUND.wettest}; j <= ${ROUND.wettest}; j += ${ROUND.step}) {
    let row = textureLoad(rows, local + vec2i(0, j + ${ROUND.wettest}), 0);
    rounds.x = max(rounds.x, row.x);
    if (abs(j) <= ${ROUND.before}) { rounds.y = max(rounds.y, row.y); }
    if (abs(j) <= ${ROUND.workable}) { rounds.z = min(rounds.z, row.z); }
  }
  textureStore(paperRounds, local, rounds);
}`;

// The paper round a pixel of the box, as ROUND_WGSL found it.
const ROUND_READ_WGSL = /* wgsl */ `
@group(0) @binding(12) var paperRounds: texture_2d<f32>;
fn roundsOf(p: vec2i) -> vec4f { return textureLoad(paperRounds, p - vec2i(u.origin), 0); }
// Where the paper round \`p\` stands: the wettest within ROUND.wettest, and the least workable within ROUND.workable.
fn paperThroughout(p: vec2i) -> vec2f { return roundsOf(p).xz; }
// The paper's wetness before the deposit, read as the wettest within ROUND.before. Read plainly, a wash's wetness
// falls to none in its soft fringe, which the same wet brush laid; a bloom's water held there would dry its lip as a
// seam through the paint. So the paint's own edge (bloomContact) ends the water.
fn wetnessBeforeAt(p: vec2i) -> f32 { return roundsOf(p).y; }
`;

// The bloom's sizing: the most surplus its water drives where paint is workable, and the most where any is, over its
// box (stampBloomBound's bloom, worked out from the paper).
const SIZE_WGSL = /* wgsl */ `${PRELUDE}
${STAMP_WET_BLOOM_WGSL}
@group(0) @binding(10) var<storage, read_write> sizing: BloomSizing;
${LANDING_WGSL}${ROUND_READ_WGSL}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  let p = local + vec2i(u.origin);
  let at = paperThroughout(p);
  let after = wetnessAfterAt(p);
  let driven = bloomSurplus(at.x, after, at.y, u.damp, u.shine);
  if (driven > 0.0) { atomicMax(&sizing.driven, bitcast<u32>(driven)); }
  // Its spread, by the surplus wherever paint is workable at all, however little.
  let lands = bloomSurplus(at.x, after, 1.0, u.damp, u.shine);
  if (at.y > 0.0 && lands > 0.0) { atomicMax(&sizing.surplus, bitcast<u32>(lands)); }
}`;

// Sizes the bloom from what SIZE_WGSL found, and whether it runs at all: it opens the gate (GATE_WGSL) or keeps it shut.
const FINALIZE_WGSL = /* wgsl */ `${PRELUDE}
${STAMP_WET_BLOOM_WGSL}
@group(0) @binding(10) var<storage, read_write> sizing: BloomSizing;
@group(0) @binding(11) var<storage, read_write> gate: array<u32, 1>;
@compute @workgroup_size(1) fn run() {
  let drive = bloomDrive(bitcast<f32>(atomicLoad(&sizing.driven)));
  let sigma = bloomSigma(u.spread, u.diameter, bitcast<f32>(atomicLoad(&sizing.surplus)));
  let blooms = drive > 0.0 && sigma >= ${STAMP_BLOOM_LEAST_SIGMA.toFixed(3)};
  sizing.drive = drive;
  sizing.sigma = sigma;
  // The bound is the most sigma its water allows, so this is at most 1: no clamp, so a twin drifting past it shows.
  sizing.ratio = sigma / u.bound;
  sizing.sendFloor = ${(STAMP_BLOOM_SEND_FLOOR * STAMP_BLOOM_BAND_WIDTH / (Math.sqrt(2 * Math.PI) * STAMP_BLOOM_CARRY_SPREAD)).toFixed(6)} / max(sigma, ${STAMP_BLOOM_LEAST_SIGMA.toFixed(3)});
  gate[0] = select(0u, 1u, blooms);
}`;

// Whether the bloom's water reaches p (bloomContact), by the wash's paint over the 5 x 5 px round it: a grain-fine
// fringe would speckle the front where the wash's own edge stops it.
const CONTACT_WGSL = /* wgsl */ `
fn coverageRound(p: vec2i) -> f32 {
  var coverage = 0.0;
  for (var j = -2; j <= 2; j += 2) {
    for (var i = -2; i <= 2; i += 2) { coverage += textureLoad(layer, clamp(p + vec2i(i, j), vec2i(0), vec2i(textureDimensions(layer)) - 1), 0, 0).x; }
  }
  return coverage / 9.0;
}
fn contactAt(p: vec2i) -> f32 { return bloomContact(wetnessBeforeAt(p), coverageRound(p)); }`;

// The surplus water the deposit left, per pixel, into the transport's values; and the paper it spreads over: how
// readily the water runs there (bloomEase, where it reaches: bloomContact), narrowed to its sigma's share of its bound,
// and open where paint may land (footprint g); and (z) the contact alone, for the front.
const SURPLUS_WGSL = /* wgsl */ `${PRELUDE}${GATE_WGSL}${LANDING_WGSL}${ROUND_READ_WGSL}
${STAMP_WET_BLOOM_WGSL}
@group(0) @binding(3) var footprint: texture_2d<f32>;
@group(0) @binding(10) var<storage, read> sizing: BloomSized;
@group(0) @binding(4) var surplus: texture_storage_2d_array<rgba32float, write>;
@group(0) @binding(5) var paper: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var layer: texture_2d_array<f32>;
${CONTACT_WGSL}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = gatedLocalOf(id);
  if (local.x < 0) { return; }
  let p = local + vec2i(u.origin);
  let at = paperThroughout(p);
  let wetness = wetnessAfterAt(p);
  textureStore(surplus, local, 0, vec4f(bloomSurplus(at.x, wetness, at.y, u.damp, u.shine), 0.0, 0.0, 0.0));
  let landed = textureLoad(footprint, p, 0);
  let contact = contactAt(p);
  let ease = bloomEase(wetnessBeforeAt(p), u.damp);
  textureStore(paper, local, vec4f(contact * ease * sizing.ratio, clamp(landed.g, 0.0, 1.0), contact, 0.0));
}`;

// Where each pixel stands to the front: its band weight (x) and the share of its paint loosened (y), as free as it is
// (workable, and open), only where paint may land. The band goes to the transport too, to be spread back (Gᵀ).
const frontWgsl = (layers: number, movedWgsl: string, stage: StampStage) => /* wgsl */ `${PRELUDE}${GATE_WGSL}${LANDING_WGSL}${ROUND_READ_WGSL}
${stampStageWgsl(stage)}
${STAMP_WET_BLOOM_WGSL}
${STAMP_WET_LIFT_WGSL}
${movedWgsl}
@group(0) @binding(3) var footprint: texture_2d<f32>;
@group(0) @binding(10) var<storage, read> sizing: BloomSized;
// The water's spread at a pixel: the bloom's, at its full diameter, by the tool's local scale there (the landing's), as
// a flood's narrow parts are laid smaller. The transport's Gaussians are separable, so they spread by the deposit's
// widest.
@group(0) @binding(14) var scale: texture_2d<f32>;
fn sigmaAt(p: vec2i) -> f32 { return sizing.sigma * textureLoad(scale, p, 0).r; }
@group(0) @binding(4) var water: texture_2d_array<f32>;
@group(0) @binding(5) var front: texture_storage_2d<rg32float, write>;
@group(0) @binding(6) var layer: texture_2d_array<f32>;
${CONTACT_WGSL}
@group(0) @binding(7) var band: texture_storage_2d_array<rgba32float, write>;
@group(0) @binding(8) var paper: texture_2d<f32>;
fn waterAt(local: vec2i) -> f32 { return textureLoad(water, clamp(local, vec2i(0), vec2i(u.extent) - 1), 0, 0).r; }
fn contactOf(local: vec2i) -> f32 { return select(0.0, textureLoad(paper, local, 0).z, all(local >= vec2i(0)) && all(local < vec2i(u.extent))); }
// The water round a pixel (BloomWater), binomially smoothed over 5 x 5 taps a quarter of its sigma apart (2 px at
// least): the transport's ladder leaves steps in the water a few pixels apart, worst along a wash's edge, and a front
// and its sag read from them knot. Only taps the water reaches (bloomContact, the paper's z) count: counted as dry,
// the rest would slope the water down to the wash's edge.
fn waterRound(local: vec2i, sigma: f32) -> BloomWater {
  let even = array<f32, 5>(1.0, 4.0, 6.0, 4.0, 1.0);
  let slope = array<f32, 5>(-1.0, -2.0, 0.0, 2.0, 1.0);
  let bend = array<f32, 5>(1.0, 0.0, -2.0, 0.0, 1.0);
  let h = i32(clamp(floor(sigma / 4.0 + 0.5), 2.0, 6.0));
  // Level, x and y slopes; then xx, yy and xy curvature; each over the taps in reach, and the reach alone.
  var first = vec3f(0.0);
  var second = vec3f(0.0);
  var reachedFirst = vec3f(0.0);
  var reachedSecond = vec3f(0.0);
  for (var j = 0; j < 5; j++) {
    for (var i = 0; i < 5; i++) {
      let q = local + h * vec2i(i - 2, j - 2);
      let k1 = vec3f(even[i] * even[j], slope[i] * even[j], even[i] * slope[j]);
      let k2 = vec3f(bend[i] * even[j], even[i] * bend[j], slope[i] * slope[j]);
      let c = contactOf(q);
      let w = c * waterAt(q);
      first += w * k1;
      second += w * k2;
      reachedFirst += c * k1;
      reachedSecond += c * k2;
    }
  }
  if (reachedFirst.x <= 1e-3) { return BloomWater(0.0, vec2f(0.0), 0.0, 0.0); }
  // The wash round, on a ring a lobe and a half out.
  let ring = 1.5 * bloomLobeCell(sigma);
  var inWash = 0.0;
  for (var k = 0; k < 12; k++) {
    let a = f32(k) * 0.5235988;
    let q = clamp(vec2i(u.origin) + local + vec2i(round(ring * vec2f(cos(a), sin(a)))), vec2i(0), vec2i(textureDimensions(layer)) - 1);
    inWash += bloomLipPaint(textureLoad(layer, q, 0, 0).x) / 12.0;
  }
  // Normalised, each derivative with the reach's own taken out (to first order).
  let level = first.x / reachedFirst.x;
  let gradient = (first.yz - level * reachedFirst.yz) / reachedFirst.x * (2.0 / f32(h));
  let d2 = (second - level * reachedSecond) / reachedFirst.x * (4.0 / f32(h * h));
  let g2 = max(dot(gradient, gradient), 1e-12);
  let sag = (d2.x * gradient.x * gradient.x + 2.0 * d2.z * gradient.x * gradient.y + d2.y * gradient.y * gradient.y) / g2;
  return BloomWater(level, gradient, sag, inWash);
}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = gatedLocalOf(id);
  if (local.x < 0) { return; }
  let p = local + vec2i(u.origin);
  let sigma = sigmaAt(p);
  let water = waterRound(local, sigma);
  let before = wetnessBeforeAt(p);
  // The front is keyed where its deposit was planned (\`keyed\`); where it stalled is read back here.
  let here = stagePoint(p);
  let keyed = stageUnwrapped(here, u.wrapFrom);
  let at = bloomFront(keyed, water, bloomGrip(before, u.damp, u.shine), u.seed, sigma);
  let streak = bloomStreak(at.foot, at.d, u.seed, sigma);
  let allowed = clamp(textureLoad(footprint, p, 0).g, 0.0, 1.0);
  var paint: array<vec4f, ${layers}>;
  for (var l = 0; l < ${layers}; l++) { paint[l] = textureLoad(layer, p, l, 0); }
  let open = bloomPastFront(waterAt(vec2i(floor(at.past + here - keyed)) + STAGE_MARGIN - vec2i(u.origin)));
  let line = bloomFrontLine(at.held, bloomMerging(before, u.damp, u.shine));
  let weight = bloomBand(at.d, line, streak) * allowed * contactAt(p) * bloomLipPaint(coverageRound(p)) * open * bloomInside(water.inWash);
  let free = liftFree(workableAt(p), washOpen(paint));
  textureStore(front, local, vec4f(weight, bloomLoosened(at.d, line, free, sizing.drive, streak) * allowed, 0.0, 0.0));
  textureStore(band, local, 0, vec4f(weight, 0.0, 0.0, 0.0));
}`;

// Each pixel's send (x): the share of its paint it gives up (y), over the band its paint would reach (N, the band
// spread back), so that the band, gathering what's sent through the spread, gains exactly what's given up.
const SEND_WGSL = /* wgsl */ `${PRELUDE}${GATE_WGSL}
@group(0) @binding(1) var front: texture_2d<f32>;
@group(0) @binding(2) var reached: texture_2d_array<f32>;
@group(0) @binding(3) var send: texture_storage_2d<rg32float, write>;
@group(0) @binding(10) var<storage, read> sizing: BloomSized;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = gatedLocalOf(id);
  if (local.x < 0) { return; }
  let reach = textureLoad(reached, local, 0, 0).r;
  let given = textureLoad(front, local, 0).y * smoothstep(0.0, sizing.sendFloor, reach);
  textureStore(send, local, vec4f(select(0.0, given / reach, reach > 1e-12 && given > 0.0), given, 0.0, 0.0));
}`;

// What each pixel sends of its pigment channels, for the transport to spread.
const sentWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}${GATE_WGSL}
${movedWgsl}
@group(0) @binding(1) var layer: texture_2d_array<f32>;
@group(0) @binding(2) var send: texture_2d<f32>;
@group(0) @binding(3) var sent: texture_storage_2d_array<rgba32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = gatedLocalOf(id);
  if (local.x < 0) { return; }
  let p = local + vec2i(u.origin);
  let share = textureLoad(send, local, 0).x;
  for (var l = 0; l < ${layers}; l++) { textureStore(sent, local, l, share * textureLoad(layer, p, l, 0) * washPigmentMask(u32(l))); }
}`;

// The carry, written back: each pixel keeps what it didn't give up and gains what its band weight gathers of what was
// sent and spread, in its pigment channels; the rest of it is the compositor's washMoved.
const landWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}${GATE_WGSL}
${STAMP_WET_BLOOM_WGSL}
${movedWgsl}
@group(0) @binding(1) var layer: texture_storage_2d_array<rgba16float, read_write>;
@group(0) @binding(2) var front: texture_2d<f32>;
@group(0) @binding(3) var send: texture_2d<f32>;
@group(0) @binding(4) var gathered: texture_2d_array<f32>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = gatedLocalOf(id);
  if (local.x < 0) { return; }
  let band = textureLoad(front, local, 0).x;
  let given = textureLoad(send, local, 0).y;
  if (band <= 0.0 && given <= 0.0) { return; }
  let p = local + vec2i(u.origin);
  var was: array<vec4f, ${layers}>;
  var now: array<vec4f, ${layers}>;
  for (var l = 0; l < ${layers}; l++) {
    was[l] = textureLoad(layer, p, l);
    now[l] = mix(was[l], bloomLand(was[l], given, band, textureLoad(gathered, local, l, 0)), washPigmentMask(u32(l)));
  }
  let moved = washMoved(now, washPigmentTotal(was));
  for (var l = 0; l < ${layers}; l++) { textureStore(layer, p, l, moved[l]); }
}`;

type BloomPipelines = Record<'rows' | 'rounds' | 'size' | 'finalize' | 'surplus' | 'front' | 'send' | 'sent' | 'land', GPUComputePipeline>;
/** The transport's three spreads a bloom runs: its water, the band spread back (N), what's sent. */
const WATER = 0, REACHED = 1, SENT = 2;
/** A landing's bloom, bounded as its bank loads. */
type BloomPlan = { bound: number; pipelines: BloomPipelines; uniform: GPUBuffer; spreads: ReturnType<typeof stampWetSpreads> };
/** A pipeline and what it's bound to, as one dispatch of a bloom runs it. */
type BloomStep = StampWetTransportStep;
/**
 * The scratch textures, as big as the largest box planned, and each plan's steps bound to them: a new set of textures
 * binds afresh, and a plan given up with its bank lets its steps go.
 */
type BloomScratch = {
  w: number; h: number; textures: GPUTexture[]; steps: WeakMap<BloomPlan, { rows: BloomStep[]; sizing: BloomStep[]; bloom: BloomStep[] }>;
  rows: GPUTextureView; rounds: GPUTextureView; paper: GPUTextureView; paths: [GPUTextureView, GPUTextureView]; values: [GPUTextureView, GPUTextureView]; front: GPUTextureView; send: GPUTextureView;
};

function loadBloom({ device, layer, footprint, field, wash, stage }: StampWetStageContext): StampLoadedWetStage<StampWetDepositMoment> {
  // Compiled per group's wash layer WGSL (its layer count and medium): groups alike share one.
  const pipelinesFor = new Map<string, BloomPipelines>();
  const pipeline = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'run' } });
  const pipelinesOf = (deposit: CompiledStampDeposit) => {
    const layers = wash.layersOf(deposit), moved = wash.movedWgsl(deposit);
    let found = pipelinesFor.get(moved);
    if (!found) {
      found = {
        rows: pipeline(ROUND_ROWS_WGSL), rounds: pipeline(ROUND_WGSL), size: pipeline(SIZE_WGSL), finalize: pipeline(FINALIZE_WGSL),
        surplus: pipeline(SURPLUS_WGSL), front: pipeline(frontWgsl(layers, moved, stage)), send: pipeline(SEND_WGSL), sent: pipeline(sentWgsl(layers, moved)), land: pipeline(landWgsl(layers, moved)),
      };
      pipelinesFor.set(moved, found);
    }
    return found;
  };
  // Every bloom sizes itself in these, cleared first: a frame's blooms run one after another.
  const sizing = device.createBuffer({ size: SIZING_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const gate = stampWetTransportGate(device);

  let scratch: BloomScratch | null = null, layers = 1;
  /** Grows the scratch to hold a box as big as `extent`'s and its layers. */
  const reserve = ({ w, h, layers: atLeast }: StampWetStageExtent) => {
    if (scratch && w <= scratch.w && h <= scratch.h && atLeast <= layers) return;
    const size = { w: Math.max(w, scratch?.w ?? 0), h: Math.max(h, scratch?.h ?? 0) };
    layers = Math.max(layers, atLeast);
    // Work already encoded with the old set keeps it until its submit.
    destroyStampTexturesOnceSubmitted(scratch?.textures ?? []);
    const textures: GPUTexture[] = [];
    const view = (format: GPUTextureFormat, depth?: number, taller = 0) => {
      const texture = device.createTexture({ size: [size.w, size.h + taller, depth ?? 1], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
      textures.push(texture);
      return texture.createView({ dimension: depth === undefined ? '2d' : '2d-array' });
    };
    scratch = {
      ...size, textures, steps: new WeakMap(), rows: view('rgba32float', undefined, 2 * ROUND.wettest), rounds: view('rgba32float'), paper: view('rgba16float'),
      paths: [view('rgba16float'), view('rgba16float')], values: [view('rgba32float', layers), view('rgba32float', layers)], front: view('rg32float'), send: view('rg32float'),
    };
  };

  const encode = (encoder: GPUCommandEncoder, plan: BloomPlan, { deposit, landing, box, seed }: StampWetDepositMoment): StampPixelBox => {
    const { wetting } = landing.medium;
    if (!scratch || box.w > scratch.w || box.h > scratch.h) throw new Error(`stamp paint: the bloom stage was given ${deposit.id}'s box, past the scratch reserved for it`);
    const words = new ArrayBuffer(BLOOM.words * 4);
    const put = gpuUniformWriter(BLOOM, { floats: new Float32Array(words), ints: new Int32Array(words), words: new Uint32Array(words) });
    put('origin', [box.x, box.y]);
    put('extent', [box.w, box.h]);
    put('seed', seed);
    put('damp', wetting.sheen.damp);
    put('shine', wetting.sheen.shiny);
    put('spread', wetting.spread);
    put('diameter', deposit.diameter);
    put('bound', plan.bound);
    put('wrapFrom', stampAxisWords(deposit.wrapFrom ?? STAMP_WRAP_FROM_NONE));
    device.queue.writeBuffer(plan.uniform, 0, words);
    plan.spreads.write(box);

    let steps = scratch.steps.get(plan);
    if (!steps) {
      steps = bloomSteps(plan, scratch);
      scratch.steps.set(plan, steps);
    }
    encoder.clearBuffer(sizing);
    encodeStampWetTransportSteps(encoder, steps.rows, { w: box.w, h: box.h + 2 * ROUND.wettest });
    encodeStampWetTransportSteps(encoder, steps.sizing, box);
    const finalize = encoder.beginComputePass();
    finalize.setPipeline(plan.pipelines.finalize);
    finalize.setBindGroup(0, device.createBindGroup({
      layout: plan.pipelines.finalize.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: plan.uniform } }, { binding: 10, resource: { buffer: sizing } }, { binding: 11, resource: { buffer: gate } }],
    }));
    finalize.dispatchWorkgroups(1);
    finalize.end();
    encodeStampWetTransportSteps(encoder, steps.bloom, box);
    return box;
  };
  // A plan's dispatches, in order, bound to one generation of scratch textures.
  const bloomSteps = (plan: BloomPlan, textures: BloomScratch) => {
    const { rows, rounds, paper, values, front, send } = textures;
    const { pipelines, spreads } = plan, u = { buffer: plan.uniform }, s = { buffer: sizing }, open = { buffer: gate };
    // By binding, only those its shader reads: an 'auto' layout holds no others.
    const step = (run: GPUComputePipeline, resources: Record<number, GPUBindingResource>): BloomStep => ({
      pipeline: run, bindGroup: device.createBindGroup({ layout: run.getBindGroupLayout(0), entries: Object.entries(resources).map(([binding, resource]) => ({ binding: Number(binding), resource })) }),
    });
    return {
      rows: [step(pipelines.rows, { 0: u, 2: field.landing, 13: rows })],
      sizing: [
        step(pipelines.rounds, { 0: u, 12: rounds, 13: rows }),
        step(pipelines.size, { 0: u, 2: field.landing, 10: s, 12: rounds }),
      ],
      bloom: [
        step(pipelines.surplus, { 0: u, 2: field.landing, 3: footprint.view, 4: values[0], 5: paper, 6: layer.view, 10: s, 11: open, 12: rounds }),
        ...spreads.steps(WATER, textures),
        step(pipelines.front, { 0: u, 2: field.landing, 3: footprint.view, 4: values[0], 5: front, 6: layer.view, 7: values[1], 8: paper, 10: s, 11: open, 12: rounds, 14: field.scale }),
        ...spreads.steps(REACHED, textures),
        step(pipelines.send, { 0: u, 1: front, 2: values[1], 3: send, 10: s, 11: open }),
        step(pipelines.sent, { 0: u, 1: layer.view, 2: send, 3: values[0], 11: open }),
        ...spreads.steps(SENT, textures),
        step(pipelines.land, { 0: u, 1: layer.view, 2: front, 3: send, 4: values[0], 11: open }),
      ],
    };
  };
  return {
    reserve,
    plan: ({ device: on, landings, boxOf }) => {
      const extents: StampWetStageExtent[] = [];
      const plans = new Map([...landings].flatMap(([deposit, landing]): [CompiledStampDeposit, BloomPlan][] => {
        const { sigma } = stampBloomBound(deposit, landing), box = boxOf(deposit);
        if (sigma === null || !box) return [];
        const layered = wash.layersOf(deposit), carry = STAMP_BLOOM_CARRY_SPREAD * sigma;
        extents.push({ w: box.w, h: box.h, layers: layered });
        const uniform = on.createBuffer({ size: BLOOM.words * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        // Sized for the widest its water could spread: its paper is narrowed to its own (BloomSizing's ratio).
        // The water spreads from values[0]; the band, laid in values[1], spreads back there; what's sent spreads in values[0].
        const spreads = stampWetSpreads(on, [
          { sigma, order: 'forward', layers: 1, from: 0 }, { sigma: carry, order: 'transposed', layers: 1, from: 1 }, { sigma: carry, order: 'forward', layers: layered, from: 0 },
        ], gate);
        return [[deposit, { bound: sigma, pipelines: pipelinesOf(deposit), uniform, spreads }]];
      }));
      return {
        extent: stampWetStageExtentOf(extents),
        encode: (encoder, moment) => {
          const plan = plans.get(moment.deposit);
          return plan ? encode(encoder, plan, moment) : null;
        },
        landingReach: (deposit) => (plans.has(deposit) ? ROUND.wettest : null),
      };
    },
  };
}

/**
 * Blooms and backruns, after each wash deposit that lands wetter than the damp, workable paint round it: once wholly
 * shown, as its front is worked out from the whole landing's water.
 */
export const STAMP_BLOOM_STAGE = { id: 'bloom', after: 'deposit', reach: stampBloomReach, load: loadBloom } satisfies StampWetStage;
