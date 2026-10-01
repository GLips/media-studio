// stamp-wet-bloom.ts: water landing wetter than a damp wash, and what it does to the paint there. A drop in the middle
// makes a bloom (a cauliflower); a wetter stroke along a passage's side makes a backrun. They're one event, told apart
// only by where and when the author lays it. The surplus water spreads into the damp paint round it and stalls at a
// ragged front; the paint it loosens inside is carried to the front, so the middle pales and the front dries as a
// crisp, dark line. WGSL, driven by studio/stamp-wet-bloom.ts, plus the sizing it does on the CPU.

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
export const STAMP_BLOOM_CARRY = 0.3;

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
 * The band the carried paint settles in, integrated across the front, px: `bloomBand`'s integral. The studio sizes the
 * floor below which a pixel is too far from any front to give paint up against it.
 */
export const STAMP_BLOOM_BAND_WIDTH = 0.5 * 1.6 + 0.5 * 7;

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
fn bloomGradient(c: vec2i, seed: u32, f: vec2f) -> f32 {
  let angle = f32(bloomHash(c, seed) >> 8u) * (6.28318530718 / 16777216.0);
  return dot(vec2f(cos(angle), sin(angle)), f);
}
// Gradient noise, about -1..1, smooth, with no lattice-aligned creases of its own.
fn bloomNoise(p: vec2f, seed: u32) -> f32 {
  let i = vec2i(floor(p));
  let f = p - floor(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = bloomGradient(i, seed, f);
  let b = bloomGradient(i + vec2i(1, 0), seed, f - vec2f(1.0, 0.0));
  let c = bloomGradient(i + vec2i(0, 1), seed, f - vec2f(0.0, 1.0));
  let d = bloomGradient(i + vec2i(1, 1), seed, f - vec2f(1.0, 1.0));
  return 1.4 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// How far the front stands out past where the water alone stalls, px, negative for in. Each octave's |noise| is round at its crests and creased where it crosses zero, so lobes bulge out and meet in cusps
// pointing in; the octaves nest smaller lobes on larger ones, none finer than a few pixels (finer only aliases). A slow
// warp keeps the lobes from lining up.
fn bloomFrontShift(p: vec2f, seed: u32, sigma: f32) -> f32 {
  let base = max(4.0, 2.0 * sigma);
  let q = p / base;
  let warp = vec2f(bloomNoise(q * 0.5, seed ^ 0x68e31da4u), bloomNoise(q * 0.5 + 17.3, seed ^ 0xb5297a4du));
  let w = q + 1.2 * warp;
  var lobes = 0.0;
  var total = 0.0;
  var amplitude = 1.0;
  var scale = 1.0;
  for (var octave = 0u; octave < 5u; octave++) {
    let shown = smoothstep(2.0, 4.0, base / scale);
    lobes += shown * amplitude * (abs(bloomNoise(w * scale, seed + octave * 0x9e3779b9u)) - 0.35);
    total += amplitude;
    amplitude *= 0.55;
    scale *= 2.1;
  }
  return (1.5 * sigma + 3.0) * lobes / total;
}
// How the front's line lies along it, as (weight, softness px): where the water stalled hard it dries a crisp, heavy
// line; where it slowed and crept on, a faint, soft one.
fn bloomFrontLine(p: vec2f, seed: u32, sigma: f32) -> vec2f {
  let stall = smoothstep(-0.45, 0.45, bloomNoise(p / max(4.0, 1.2 * sigma), seed ^ 0x2545f491u));
  return vec2f(0.1 + 1.6 * stall, mix(3.5, 0.6, stall));
}
// How far inside the front a pixel is, px, from the spread water's level and slope there.
fn bloomFrontDistance(level: f32, slope: f32, shift: f32, sigma: f32) -> f32 {
  let d = (level - BLOOM_FRONT_LEVEL) / max(slope, 1e-5);
  // Well outside, the lobes fade: a front reaching far past the water would leave rings of its own on the paper.
  let reach = 0.75 * sigma + 2.0;
  return clamp(d, -4.0 * sigma - 4.0, 4.0 * sigma + 4.0) + shift * smoothstep(-2.0 * reach, -reach, d);
}
// Where carried paint settles at distance \`d\` inside the front: a thin dark line on the damp side, as heavy and as
// crisp as \`line\` says, and a paler zone within.
fn bloomBand(d: f32, line: vec2f) -> f32 {
  let inside = max(d, 0.0);
  return smoothstep(-line.y, line.y, d) * (0.5 * line.x * exp(-inside / 1.6) + 0.5 * exp(-inside / 7.0));
}
// The share of a pixel's paint the water carries away, as \`free\` as it is (liftFree: workable, and never set);
// bloomLand is its amounts after, \`gathered\` having reached it.
fn bloomLoosened(d: f32, free: f32, drive: f32) -> f32 {
  return ${STAMP_BLOOM_CARRY.toFixed(3)} * drive * clamp(free, 0.0, 1.0) * smoothstep(0.5, 4.0, d);
}
fn bloomLand(was: vec4f, loosened: f32, band: f32, gathered: vec4f) -> vec4f {
  return max(was * (1.0 - loosened) + band * gathered, vec4f(0.0));
}`;
