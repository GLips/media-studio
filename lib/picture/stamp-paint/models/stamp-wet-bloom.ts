// stamp-wet-bloom.ts: water landing wetter than a damp wash, and what it does to the paint there. A drop in the middle
// makes a bloom (a cauliflower); a wetter stroke along a passage's side makes a backrun. They're one event, told apart
// only by where and when the author lays it. The surplus water spreads into the damp paint round it and stalls at a
// ragged front; the paint it loosens inside is carried to the front, so the middle dries paler and mottled, still the
// wash's tint, and the front dries as a dark lip a few pixels wide, crisp outside. WGSL, driven by
// studio/stamp-wet-bloom.ts, plus the sizing it does on the CPU.

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
 * The lip carried paint dries into, inside the front: a dark line, crisp on the outside and fading in over
 * `lineDecay` px, its weight wavering between `least` and `most` along the front and holding `lineShare` of the paint;
 * and a paler zone over `zoneDecay` px holding the rest.
 */
const STAMP_BLOOM_BAND = { least: 0.3, most: 1.6, lineDecay: 2.2, zoneDecay: 6, lineShare: 0.75 };

/**
 * About `bloomBand`'s integral across a front, px, at the line's mean weight. The studio sizes the floor below which a
 * pixel is too far from any front to give paint up against it.
 */
export const STAMP_BLOOM_BAND_WIDTH =
  STAMP_BLOOM_BAND.lineShare * STAMP_BLOOM_BAND.lineDecay * ((STAMP_BLOOM_BAND.least + STAMP_BLOOM_BAND.most) / 2) + (1 - STAMP_BLOOM_BAND.lineShare) * STAMP_BLOOM_BAND.zoneDecay;

/**
 * The cauliflower's lobes: the largest's size, px, as a share of the water's sigma, within `least`..`most`; a smaller
 * octave rides on each at `ratio` of its size and `weight` of its depth, and a fine crinkle at `fine` and `fineWeight`.
 */
const STAMP_BLOOM_LOBES = { share: 0.75, least: 6, most: 18, ratio: 0.35, weight: 0.7, fine: 0.12, fineWeight: 0.6 };

/** The front and the carry, in WGSL. */
export const STAMP_WET_BLOOM_WGSL = /* wgsl */ `
const BLOOM_FRONT_LEVEL = 0.08;
// What drives a bloom: the water a deposit's brush leaves over what the paper held, where paint there still moves and
// the paper's shine has gone (stampBloomBelowShine). On dry paper it's nothing, and the stroke keeps its hard edge.
fn bloomSurplus(before: f32, after: f32, workable: f32, damp: f32, shine: f32) -> f32 {
  let belowShine = 1.0 - smoothstep(0.0, 1.0, clamp((before - damp) / max(1e-3, shine - damp), 0.0, 1.0));
  return max(0.0, after - before) * clamp(workable, 0.0, 1.0) * belowShine;
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
      let radius = cell * (0.3 + 0.5 * size) * onStall * step(0.25, size);
      let tall = 0.45 + 0.55 * bloomHash01(c, seed ^ 0x85ebca6bu);
      let t = dot(off, tangent);
      height = max(height, tall * sqrt(max(0.0, radius * radius - t * t)));
    }
  }
  return height;
}
// How far inside the front a pixel is, px, from the spread water's \`level\` and its \`gradient\` (pointing in) there.
// The water stalls where its level falls to BLOOM_FRONT_LEVEL; the front stands out past that in round lobes and
// smaller lobes on those (cauliflower), keyed to \`seed\` in the painting's pixels, a slow warp keeping them from lining
// up. Each lobe is measured along the stall, so the front never leaves an island of its own.
fn bloomFrontDistance(p: vec2f, level: f32, gradient: vec2f, seed: u32, sigma: f32) -> f32 {
  let slope = max(length(gradient), 1e-5);
  let stall = clamp((level - BLOOM_FRONT_LEVEL) / slope, -4.0 * sigma - 4.0, 4.0 * sigma + 4.0);
  let normal = gradient / slope;
  let tangent = vec2f(-normal.y, normal.x);
  let foot = p - normal * stall;
  let cell = bloomLobeCell(sigma);
  let warp = vec2f(bloomValue(foot / (3.0 * cell), seed ^ 0x68e31da4u), bloomValue(foot / (3.0 * cell) + 17.3, seed ^ 0xb5297a4du)) - 0.5;
  let warped = foot + 1.2 * cell * warp;
  let small = ${STAMP_BLOOM_LOBES.ratio.toFixed(3)} * cell;
  let lobes = bloomLobeHeight(warped, tangent, normal, cell, seed)
    + ${STAMP_BLOOM_LOBES.weight.toFixed(3)} * bloomLobeHeight(warped, tangent, normal, small, seed ^ 0x9e3779b9u)
    + ${STAMP_BLOOM_LOBES.fineWeight.toFixed(3)} * bloomLobeHeight(warped, tangent, normal, max(2.5, ${STAMP_BLOOM_LOBES.fine.toFixed(3)} * cell), seed ^ 0x7f4a7c15u);
  // Lobes stand out about half their size on average: held back by that, the bloom keeps the water's size.
  // Along the front the lobing comes and goes, over a few lobes: deep cauliflower in one stretch, a gentle wave in the next.
  let depth = 0.35 + 1.1 * bloomValue(warped / (4.0 * cell), seed ^ 0x1b873593u);
  let shift = depth * (lobes - 0.3 * cell * (1.0 + ${(STAMP_BLOOM_LOBES.ratio * STAMP_BLOOM_LOBES.weight + STAMP_BLOOM_LOBES.fine * STAMP_BLOOM_LOBES.fineWeight).toFixed(3)}));
  // Well outside, the lobes fade: a front reaching far past the water would leave rings of its own on the paper.
  let reach = 0.75 * sigma + 2.0;
  return stall + shift * smoothstep(-2.0 * reach, -reach, stall);
}
// How the lip lies along the front, as (weight, softness px): where the water stalled hard it dries a heavy line with
// a crisp outer edge; where it slowed and crept on, a fainter, softer one. It changes over a lobe or two.
fn bloomFrontLine(p: vec2f, seed: u32, sigma: f32) -> vec2f {
  let stall = smoothstep(0.25, 0.75, bloomValue(p / (1.7 * bloomLobeCell(sigma)), seed ^ 0x2545f491u));
  return vec2f(mix(${STAMP_BLOOM_BAND.least.toFixed(3)}, ${STAMP_BLOOM_BAND.most.toFixed(3)}, stall), mix(1.0, 0.4, stall));
}
// Where carried paint settles at distance \`d\` inside the front: a lip, darkest at its crisp outer edge and fading
// in, as heavy and as crisp as \`line\` says, and a paler zone within.
fn bloomBand(d: f32, line: vec2f) -> f32 {
  let inside = max(d, 0.0);
  return smoothstep(-line.y, line.y, d) * (${STAMP_BLOOM_BAND.lineShare.toFixed(3)} * line.x * exp(-inside / ${STAMP_BLOOM_BAND.lineDecay.toFixed(3)}) + ${(1 - STAMP_BLOOM_BAND.lineShare).toFixed(3)} * exp(-inside / ${STAMP_BLOOM_BAND.zoneDecay.toFixed(3)}));
}
// The share of a pixel's paint the water carries away, as \`free\` as it is (liftFree: workable, and never set):
// unevenly, so the inside dries paler and mottled, still the wash's tint; bloomLand is its amounts after, \`gathered\`
// having reached it.
fn bloomLoosened(p: vec2f, d: f32, free: f32, drive: f32, seed: u32, sigma: f32) -> f32 {
  let cell = bloomLobeCell(sigma);
  let mottle = 0.6 * bloomValue(p / (1.3 * cell), seed ^ 0x51ed270bu) + 0.4 * bloomValue(p / (0.45 * cell), seed ^ 0x3c6ef372u);
  return ${STAMP_BLOOM_CARRY.toFixed(3)} * drive * clamp(free, 0.0, 1.0) * smoothstep(0.5, 3.0, d) * mix(0.25, 1.0, mottle);
}
fn bloomLand(was: vec4f, loosened: f32, band: f32, gathered: vec4f) -> vec4f {
  return max(was * (1.0 - loosened) + band * gathered, vec4f(0.0));
}`;
