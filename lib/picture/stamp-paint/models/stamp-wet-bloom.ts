// stamp-wet-bloom.ts: water landing wetter than a damp wash, and what it does to the paint there: a drop in the middle
// makes a bloom (a cauliflower), a wetter stroke along a passage's side a backrun; one event. The surplus water runs
// only where the wash's paint reaches, further into wetter paper, stalling sooner in drier, merging open where the
// paper is about as wet as the drop. Where it stalls its edge is lobed at two scales, and the paint it loosens inside
// is carried there: a dark lip, crisp outside, the middle paler, feathered and streaked along the push. WGSL, driven by
// studio/stamp-wet-bloom.ts, plus its CPU sizing.

import type { PaintMedium, PaintWetting } from '#lib/picture/paint/models/paint-medium.ts';
import type { CompiledStampDeposit } from './stamp-paint-recipe.ts';
import type { StampWetLanding } from './stamp-wetness.ts';

/**
 * The widest the spreading water's Gaussian gets, px: a drop on a big brush would otherwise walk hundreds of taps a
 * pixel, and a bloom this big already reads as a passage of its own.
 */
export const STAMP_BLOOM_MOST_SIGMA = 24;

/**
 * Surplus water (the brush's water over the paper's wetness) below `least` merges into the wash rather than blooming;
 * from `full` it blooms fully.
 */
export const STAMP_BLOOM_SURPLUS = { least: 0.08, full: 0.35 };

/** The share of a pixel's loose paint the spreading water carries away to its front, at most. */
export const STAMP_BLOOM_CARRY = 0.35;

/**
 * How far the water spreads, as a Gaussian's sigma in px: the medium's `spread` (in brush diameters) of the deposit's
 * `diameter`, as far as its most surplus drives it. The front stalls about one sigma past the drop.
 */
export function stampBloomSigma(spread: number, diameter: number, surplus: number): number {
  return Math.min(STAMP_BLOOM_MOST_SIGMA, 1.5 * spread * diameter * Math.min(1, Math.max(0, surplus)));
}

/**
 * How far past its stamps a wash deposit's bloom can reach, px, before its wetness is known: three of the widest sigma
 * its water could drive. None for a deposit carrying no water (a lift) or a medium that doesn't spread.
 */
export function stampBloomReach(deposit: CompiledStampDeposit, medium: PaintMedium): number {
  const { action } = deposit;
  const water = action.kind === 'lift' ? 0 : action.water ?? medium.wetting.brushWater;
  return water > 0 ? Math.ceil(3 * stampBloomSigma(medium.wetting.spread, deposit.diameter, 1)) : 0;
}

/**
 * How much of its surplus a landing's water pushes into paper as wet as `wettest`: all of it on damp paper, none on a
 * wash that still has its shine (as wet as a brush lays it), where water merges. A painter's "wait for the shine to go".
 */
export function stampBloomBelowShine(wettest: number, { damp, brushWater }: Pick<PaintWetting, 'damp' | 'brushWater'>): number {
  const t = Math.min(1, Math.max(0, (wettest - damp) / Math.max(1e-3, brushWater - damp)));
  return 1 - t * t * (3 - 2 * t);
}

/** How strongly a landing whose most surplus water, where paint is workable, is `surplus` blooms, 0..1. */
function stampBloomDrive(surplus: number): number {
  const { least, full } = STAMP_BLOOM_SURPLUS;
  const t = Math.min(1, Math.max(0, (surplus - least) / (full - least)));
  return t * t * (3 - 2 * t);
}

/**
 * Whether a wash deposit's `landing` blooms, and how: how strongly (`drive`, 0..1), by its most surplus water where the
 * paint is workable, and how far (`sigma`), by its most surplus there, in a medium's `wetting` and a brush `diameter`
 * wide. Null when it merges or lands on dry paper. It reads the paper as the stage's paperThroughout does.
 */
export function stampBloomSizing({ before, after }: StampWetLanding, wetting: PaintWetting, diameter: number): { drive: number; sigma: number } | null {
  const { columns, rows } = before.window, { wetness, workable } = before;
  const at = (i: number, j: number) => Math.min(rows - 1, Math.max(0, j)) * columns + Math.min(columns - 1, Math.max(0, i));
  let driven = 0, surplus = 0;
  for (let j = 0; j + 1 < rows; j++) {
    for (let i = 0; i + 1 < columns; i++) {
      let wettest = 0;
      for (let b = -1; b <= 2; b++) for (let a = -1; a <= 2; a++) wettest = Math.max(wettest, wetness[at(i + a, j + b)]);
      const corners = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)];
      const throughout = Math.min(...corners.map((k) => workable[k]));
      for (const k of corners) {
        const lands = Math.max(0, after.wetness[k] - wettest) * stampBloomBelowShine(wettest, wetting);
        driven = Math.max(driven, lands * throughout);
        if (throughout > 0) surplus = Math.max(surplus, lands);
      }
    }
  }
  const drive = stampBloomDrive(driven), sigma = stampBloomSigma(wetting.spread, diameter, surplus);
  return drive > 0 && sigma >= 0.5 ? { drive, sigma } : null;
}

/**
 * The transport's Gaussian is wider than the water's: paint from a bloom's middle reaches its front too, so the whole
 * inside pales rather than a ring by the front.
 */
export const STAMP_BLOOM_CARRY_SPREAD = 2;

/**
 * The lip carried paint dries into, inside the front: darkest for `plateau` px past its crisp outer edge, fading in
 * over `lineDecay` px (`fingers` of that more or less along the push), weighing `least` where the water crept on to
 * `most` where held back, with `lineShare` of the paint; and a paler zone over `zoneDecay` px.
 */
const STAMP_BLOOM_BAND = { least: 0.05, most: 1.8, plateau: 1, lineDecay: 4.5, fingers: 0.35, zoneDecay: 6, lineShare: 0.75 };

/**
 * About `bloomBand`'s integral across a front, px, at the line's mean weight. The studio sizes the floor below which a
 * pixel is too far from any front to give paint up against it.
 */
export const STAMP_BLOOM_BAND_WIDTH =
  STAMP_BLOOM_BAND.lineShare * (STAMP_BLOOM_BAND.plateau + STAMP_BLOOM_BAND.lineDecay) * ((STAMP_BLOOM_BAND.least + STAMP_BLOOM_BAND.most) / 2) + (1 - STAMP_BLOOM_BAND.lineShare) * STAMP_BLOOM_BAND.zoneDecay;

/**
 * The cauliflower at three scales. Big lobes: the front moves up to `held` / 2 sigmas as the paper held the water or
 * let it run, over patches `big` sigmas across. On them, scallops `share` of the sigma (`least`..`most` px), smaller
 * ones at `ratio` and `weight`, a crinkle at `fine` and `fineWeight`, at least `fineLeast` px: finer reads as pixels.
 */
const STAMP_BLOOM_LOBES = { big: 1.0, held: 0.9, share: 0.45, least: 5, most: 14, ratio: 0.35, weight: 0.7, fine: 0.12, fineWeight: 0.6, fineLeast: 4 };

/** The front and the carry, in WGSL. */
export const STAMP_WET_BLOOM_WGSL = /* wgsl */ `
const BLOOM_FRONT_LEVEL = 0.08;
// How far past the water's front, px, bloomPastFront reads the water.
const BLOOM_PAST_FRONT = 2.0;
// What drives a bloom: the water a deposit's brush leaves over what the paper held, where paint there still moves and
// the paper's shine has gone (stampBloomBelowShine). On dry paper it's nothing, and the stroke keeps its hard edge.
fn bloomSurplus(before: f32, after: f32, workable: f32, damp: f32, shine: f32) -> f32 {
  return max(0.0, after - before) * clamp(workable, 0.0, 1.0) * (1.0 - bloomMerging(before, damp, shine));
}
// How far paper as wet as \`before\` still has its shine, 0 (damp) to 1 (as wet as a brush lays it): water meeting it
// merges rather than pushing.
fn bloomMerging(before: f32, damp: f32, shine: f32) -> f32 {
  return smoothstep(0.0, 1.0, clamp((before - damp) / max(1e-3, shine - damp), 0.0, 1.0));
}
// Whether a bloom's water reaches a pixel at all: where the wash had water (\`before\`) and has any paint
// (\`coverage\`). Not where the wetness lattice alone calls the paper wet: a soft brush's fringe wets cells it leaves
// bare, and a bloom pushing paint there would leave the wash, a pale halo on the paper beside it. Negative space:
// clean wet paper beside the paint takes no bloom either, as there's no paint there to push.
fn bloomContact(before: f32, coverage: f32) -> f32 {
  return smoothstep(0.002, 0.03, coverage) * step(1e-4, before);
}
// Whether a lip may dry at a pixel, by the paint round it (\`coverage\`): where the water reaches paint too faint to
// see, a lip would be a dark speck on bare paper.
fn bloomLipPaint(coverage: f32) -> f32 {
  return smoothstep(0.03, 0.12, coverage);
}
// Whether the water stalled in the wash rather than being stopped at its edge, 0..1, by the spread water a little
// past its front (BloomFront's past): stalling, it thins on past its front level; stopped by the wash's paint thinning
// out or its paper dry, none got past. No lip dries at such an edge (in a soft fringe it would be a dotted seam): it's
// the drying rim's.
fn bloomPastFront(past: f32) -> f32 {
  return smoothstep(0.2, 0.6, past / BLOOM_FRONT_LEVEL);
}
// How readily a bloom's water runs over paper as wet as \`before\` was, 0..1: freely on damp or wetter paper, stalling
// sooner as the paper's drier.
fn bloomEase(before: f32, damp: f32) -> f32 {
  return smoothstep(0.0, 1.0, clamp(before / max(damp, 1e-3), 0.0, 1.0));
}
fn bloomHash(c: vec2i, seed: u32) -> u32 {
  var h = (bitcast<u32>(c.x) * 0x8da6b343u) ^ (bitcast<u32>(c.y) * 0xd8163841u) ^ (seed * 0xcb1ab31fu);
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return h ^ (h >> 16u);
}
fn bloomHash01(c: vec2i, seed: u32) -> f32 { return f32(bloomHash(c, seed) >> 8u) / 16777216.0; }
// Smooth value noise, 0..1.
fn bloomValue(p: vec2f, seed: u32) -> f32 {
  let i = vec2i(floor(p));
  let f = p - floor(p);
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(bloomHash01(i, seed), bloomHash01(i + vec2i(1, 0), seed), s.x), mix(bloomHash01(i + vec2i(0, 1), seed), bloomHash01(i + vec2i(1, 1), seed), s.x), s.y);
}
fn bloomLobeCell(sigma: f32) -> f32 {
  return clamp(${STAMP_BLOOM_LOBES.share.toFixed(3)} * sigma, ${STAMP_BLOOM_LOBES.least.toFixed(1)}, ${STAMP_BLOOM_LOBES.most.toFixed(1)});
}
// How far a scatter of round lobes, a \`cell\` apart, stands out past the stall at \`p\`, px: the stall at \`foot\`
// (p brought onto it), running along \`tangent\`. Lobes sit on the stall, one about every cell along it, each a
// half-disk; where two meet the front folds in to a cusp. Each lobe's size fades as its centre leaves the stall, so
// one doesn't pop in or out along it, and every lobe reaching p lies in the 5x5 cells round its foot.
fn bloomLobeHeight(foot: vec2f, tangent: vec2f, normal: vec2f, cell: f32, seed: u32) -> f32 {
  let home = vec2i(floor(foot / cell));
  var height = 0.0;
  for (var j = -2; j <= 2; j++) {
    for (var i = -2; i <= 2; i++) {
      let c = home + vec2i(i, j);
      let centre = (vec2f(c) + vec2f(bloomHash01(c, seed), bloomHash01(c, seed ^ 0x27d4eb2du))) * cell;
      let off = centre - foot;
      let onStall = 1.0 - smoothstep(0.25, 0.6, abs(dot(off, normal)) / cell);
      let size = bloomHash01(c, seed ^ 0x165667b1u);
      // Some cells grow no lobe, and the front runs flatter there; the rest are half-ellipses, some squat, some tall.
      let radius = cell * (0.35 + 0.45 * size) * onStall * step(0.15, size);
      let tall = 0.8 + 0.5 * bloomHash01(c, seed ^ 0x85ebca6bu);
      let t = dot(off, tangent);
      height = max(height, tall * sqrt(max(0.0, radius * radius - t * t)));
    }
  }
  return height;
}
// How hard the paper held a bloom's water back round \`p\`, 0..1: drier paper (\`ease\` low, bloomEase) holds it,
// and over a few big patches a bloom across, the paper's sizing does. Where it's held, the front stalls short and
// dries a heavy lip; where it isn't, the water runs on and its edge is faint.
fn bloomHeld(p: vec2f, ease: f32, seed: u32, sigma: f32) -> f32 {
  let patches = bloomValue(p / (${STAMP_BLOOM_LOBES.big.toFixed(3)} * sigma + 4.0), seed ^ 0x3c6ef372u);
  return clamp(0.5 + 1.6 * (patches - 0.5) + 1.2 * (1.0 - clamp(ease, 0.0, 1.0)), 0.0, 1.0);
}
// Where a pixel stands to a bloom's front: how far inside it, px (d); the stretch of front it lies behind, as a point
// on the stall (foot), so anything keyed to it runs straight along the push, inward from the front; and how hard the
// paper held the water back there (held, bloomHeld); and a point a little past where the water's level falls to its
// front level, before any lobe (past, for bloomPastFront).
struct BloomFront { d: f32, foot: vec2f, held: f32, past: vec2f }
// From the spread water's \`level\` and its \`gradient\` (pointing in) at p, on paper as ready to let it run as
// \`ease\` (bloomEase). The water stalls where its level falls to BLOOM_FRONT_LEVEL, short of that where it was held (a
// few big lobes); the front stands out past it in scallops and smaller ones on them (cauliflower), keyed to \`seed\` in
// the painting's pixels, a slow warp keeping them from lining up. Every shift is measured from the stall along its
// normal, so the front never leaves an island of its own.
fn bloomFront(p: vec2f, level: f32, gradient: vec2f, ease: f32, seed: u32, sigma: f32) -> BloomFront {
  let slope = max(length(gradient), 1e-5);
  let stall = clamp((level - BLOOM_FRONT_LEVEL) / slope, -4.0 * sigma - 4.0, 4.0 * sigma + 4.0);
  let normal = gradient / slope;
  let tangent = vec2f(-normal.y, normal.x);
  let foot = p - normal * stall;
  // Held, the front stops short; let run, it goes on: the big lobes, as a shift along the stall's normal.
  let held = bloomHeld(foot, ease, seed, sigma);
  let cell = bloomLobeCell(sigma);
  let amount = ${STAMP_BLOOM_LOBES.held.toFixed(3)} * sigma;
  let big = amount * (0.5 - held);
  // The scallops stand on the big lobes' own edge, measured along its normal: on the stall's, they'd shear into
  // spikes where a big lobe's side runs steeply out.
  let e = 0.5 * cell;
  let steep = amount * (bloomHeld(foot - tangent * e, ease, seed, sigma) - bloomHeld(foot + tangent * e, ease, seed, sigma)) / (2.0 * e);
  let lobed = normalize(normal + tangent * steep);
  let along = vec2f(-lobed.y, lobed.x);
  let edge = stall + big;
  let base = p - lobed * edge;
  let warp = vec2f(bloomValue(base / (3.0 * cell), seed ^ 0x68e31da4u), bloomValue(base / (3.0 * cell) + 17.3, seed ^ 0xb5297a4du)) - 0.5;
  let warped = base + 1.2 * cell * warp;
  let small = ${STAMP_BLOOM_LOBES.ratio.toFixed(3)} * cell;
  let lobes = bloomLobeHeight(warped, along, lobed, cell, seed)
    + ${STAMP_BLOOM_LOBES.weight.toFixed(3)} * bloomLobeHeight(warped, along, lobed, small, seed ^ 0x9e3779b9u)
    + ${STAMP_BLOOM_LOBES.fineWeight.toFixed(3)} * bloomLobeHeight(warped, along, lobed, max(${STAMP_BLOOM_LOBES.fineLeast.toFixed(1)}, ${STAMP_BLOOM_LOBES.fine.toFixed(3)} * cell), seed ^ 0x7f4a7c15u);
  // Lobes stand out about half their size on average: held back by that, the bloom keeps the water's size.
  // Along the front the lobing comes and goes, over a few lobes: deep cauliflower in one stretch, a gentle wave in the next.
  let depth = 0.35 + 1.1 * bloomValue(warped / (4.0 * cell), seed ^ 0x1b873593u);
  let shift = depth * (lobes - 0.3 * cell * (1.0 + ${(STAMP_BLOOM_LOBES.ratio * STAMP_BLOOM_LOBES.weight + STAMP_BLOOM_LOBES.fine * STAMP_BLOOM_LOBES.fineWeight).toFixed(3)}));
  // Well outside, the lobes fade: a front reaching far past the water would leave rings of its own on the paper.
  let reach = 0.75 * sigma + 2.0;
  return BloomFront(stall + (big + shift) * smoothstep(-2.0 * reach, -reach, stall), base, held, p - normal * (stall + BLOOM_PAST_FRONT));
}
// Streaks running in from the front along the push, 0..1, \`d\` px inside it: keyed to a point of the stall (foot), fine
// across the push and slowly bending along it, so the edge of the inside feathers; they fade to an even 0.5 deeper in.
fn bloomStreak(foot: vec2f, d: f32, seed: u32, sigma: f32) -> f32 {
  let cell = bloomLobeCell(sigma);
  let bend = vec2f(max(d, 0.0) / (2.5 * cell));
  let streak = 0.6 * bloomValue(foot / (0.6 * cell) + bend, seed ^ 0x51ed270bu) + 0.4 * bloomValue(foot / (0.2 * cell + 1.0) + 2.0 * bend, seed ^ 0x5be0cd19u);
  return mix(0.5, streak, exp(-max(d, 0.0) / (2.0 * cell)));
}
// How the lip lies along the front, as (weight, softness px): heavy with a crisp outer edge where the water was
// \`held\`, faint and soft where it ran on. Crisp is still about a pixel and a half: any less and the edge is a
// threshold, stepping along every slant; none where the paper round was nearly as wet as the drop (\`merging\`, 0..1),
// which leaves the front open on that side.
fn bloomFrontLine(held: f32, merging: f32) -> vec2f {
  let stalled = smoothstep(0.3, 0.8, held);
  return vec2f(mix(${STAMP_BLOOM_BAND.least.toFixed(3)}, ${STAMP_BLOOM_BAND.most.toFixed(3)}, stalled) * (1.0 - clamp(merging, 0.0, 1.0)), mix(1.6, 0.75, stalled));
}
// Where carried paint settles at distance \`d\` inside the front: a lip a few pixels wide, darkest at its crisp outer
// edge and fingering in along the \`streak\`, as heavy and as crisp as \`line\` says, and a paler zone within.
fn bloomBand(d: f32, line: vec2f, streak: f32) -> f32 {
  let inside = max(d - line.y - ${STAMP_BLOOM_BAND.plateau.toFixed(1)}, 0.0);
  let decay = ${STAMP_BLOOM_BAND.lineDecay.toFixed(3)} * (1.0 + ${STAMP_BLOOM_BAND.fingers.toFixed(3)} * (2.0 * smoothstep(0.3, 0.8, streak) - 1.0));
  return smoothstep(-line.y, line.y, d) * (${STAMP_BLOOM_BAND.lineShare.toFixed(3)} * line.x * exp(-inside / decay) + ${(1 - STAMP_BLOOM_BAND.lineShare).toFixed(3)} * exp(-inside / ${STAMP_BLOOM_BAND.zoneDecay.toFixed(3)}));
}
// The share of a pixel's paint the water carries away, as \`free\` as it is (liftFree: workable, and never set):
// unevenly along the \`streak\`, so the inside dries paler and feathered, still the wash's tint; bloomLand is its
// amounts after, \`gathered\` having reached it.
fn bloomLoosened(d: f32, free: f32, drive: f32, streak: f32) -> f32 {
  return ${STAMP_BLOOM_CARRY.toFixed(3)} * drive * clamp(free, 0.0, 1.0) * smoothstep(0.5, 3.0, d) * mix(0.1, 1.0, smoothstep(0.25, 0.75, streak));
}
fn bloomLand(was: vec4f, loosened: f32, band: f32, gathered: vec4f) -> vec4f {
  return max(was * (1.0 - loosened) + band * gathered, vec4f(0.0));
}`;
