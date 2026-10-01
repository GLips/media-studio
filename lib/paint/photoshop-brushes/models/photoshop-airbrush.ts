// photoshop-airbrush.ts: Photoshop's airbrush tip (dTips, dtipsType 1) as stamps, fitted to the vid-105 probes (run
// 20260930-075734) and Legacy's references, which paint these presets at 100 px.
//
// Pressure is the nozzle's distance: the spray is a disc of radius R(p) = D(1 − p)/2 + 1 px, whatever the pose's size,
// its paint landing uniformly at hardness 100 and with a soft rim at 1. Granularity 0 sprays smoothly; granularity 100
// throws 2×1 px grains, or at a splat size past 1, soft drops. Cutoff angle and streakiness show in no capture.

import type { StampBrushLayer, StampBrushTip, StampResponseCurve, StampScaleResponse } from '#lib/paint/brush/models/stamp-brush.ts';
import { STAMP_MIN_SPACING } from '#lib/paint/brush/models/stamp-placement.ts';
import { photoshopComputedTipSpan } from './photoshop-computed-tip.ts';
import type { PhotoshopKnownTip } from './photoshop-preset.ts';

export type PhotoshopAirbrushTip = Extract<PhotoshopKnownTip, { kind: 'airbrush' }>;
type SprayFalloff = { core: number; fall: number };

/** The spray's rim in pixels: a pose at 1 still paints a 2 px line. */
const RIM = 1;
/** The soft spray: flat to 0.75 R, then exp(−((r − 0.75R)/0.4R)²), fitted to the grainy lines' moments. */
const SOFT_CORE = 0.75, SOFT_FALL = 0.4;
/** Smooth spray flow per stamp, min(1, K·step/R): the line saturates alike at every pressure (flow 0.08 to 0.18 fit). */
const SMOOTH_K = 4;
/** A grain's paint, laid as flow: a falling triangle from 0 to this, mean a third of it. */
const GRAIN_PEAK = 0.65;
/** Grains' paint per step and splat count at 100 px, hard and soft; it grows as the diameter^1.2. */
const GRAIN_MASS = { hard: 0.31, soft: 0.46, exponent: 1.2 };
/**
 * Splats: drops 3 + splatSize·D·0.8·u³ px across, a quarter of the splat count kept: Photoshop paints far fewer drops
 * than its count. Two probes fit these, so they're loose.
 */
const SPLAT = { min: 3, scale: 0.8, power: 3, keep: 0.25 };

/** 1 at hardness 1, 0 at 100 (`hardness` 0..1). */
const softnessAt = (hardness: number) => 1 - Math.min(1, Math.max(0, (hardness * 100 - 1) / 99));
const softness = (tip: PhotoshopAirbrushTip) => softnessAt(tip.simulatedHardness / 100);

/** The spray's density by hardness 0..1: only hardness 1% and 100% are probed, so between them it's interpolated. */
function sprayFalloffAt(hardness: number): SprayFalloff {
  const soft = softnessAt(hardness);
  return { core: 1 - (1 - SOFT_CORE) * soft, fall: SOFT_FALL * soft };
}
const sprayFalloff = (tip: PhotoshopAirbrushTip) => sprayFalloffAt(tip.simulatedHardness / 100);

/** The density at r, in shares of R: 1 in the core. */
function sprayDensity(r: number, { core, fall }: SprayFalloff) {
  if (r <= core) return 1;
  if (fall < 1e-3) return r <= 1 ? 1 : 0;
  return Math.exp(-(((r - core) / fall) ** 2));
}

/** Where the density falls under 1e-3, in shares of R. */
const sprayReach = ({ core, fall }: SprayFalloff) => core + fall * 2.63;

/** The spray's quantiles: a uniform draw to the share of R a drop strays, so drops land as the density says. */
function sprayDistribution(falloff: SprayFalloff): StampResponseCurve {
  const n = 2000, top = sprayReach(falloff), cdf = [0];
  for (let i = 1; i <= n; i++) cdf.push(cdf[i - 1] + sprayDensity(((i - 0.5) / n) * top, falloff) * ((i - 0.5) / n) * top);
  const points: [number, number][] = [];
  for (let k = 0, i = 0; k <= 32; k++) {
    while (i < n && cdf[i + 1] / cdf[n] < k / 32) i++;
    points.push([k / 32, (i / n) * top]);
  }
  return points;
}

export type PhotoshopAirbrushMode = 'smooth' | 'grain' | 'splat';
/** Granularity under 50 sprays smoothly; else grains, or drops past splat size 1. Granularity between is unprobed. */
export function photoshopAirbrushMode(tip: PhotoshopAirbrushTip): PhotoshopAirbrushMode {
  if (tip.granularity < 50) return 'smooth';
  return tip.splatSize > 1 ? 'splat' : 'grain';
}

const splatDiameter = (tip: PhotoshopAirbrushTip, u: number) => SPLAT.min + (tip.splatSize / 100) * tip.geometry.diameter * SPLAT.scale * u ** SPLAT.power;

/** What an airbrush's stamps are drawn from: a spray's density, a grain, or a computed round drop. */
export type PhotoshopAirbrushImage = { kind: 'spray'; hardness: number } | { kind: 'grain' } | { kind: 'round'; hardness: number; diameter: number };

export function photoshopAirbrushImage(tip: PhotoshopAirbrushTip): PhotoshopAirbrushImage {
  const mode = photoshopAirbrushMode(tip), hardness = Math.round(tip.simulatedHardness) / 100;
  if (mode === 'smooth') return { kind: 'spray', hardness };
  return mode === 'grain' ? { kind: 'grain' } : { kind: 'round', hardness, diameter: splatDiameter(tip, 1) };
}

/** A spray image, 64 texels, dark is paint, spanning its reach; the stamp's diameter is the spray's at p = 0. */
export function drawPhotoshopAirbrushSpray(hardness: number): { size: number; pixels: Uint8Array } {
  const falloff = sprayFalloffAt(hardness), size = 64, half = size / 2, top = sprayReach(falloff);
  const pixels = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) pixels[y * size + x] = Math.round(255 * (1 - sprayDensity((Math.hypot(x + 0.5 - half, y + 0.5 - half) / half) * top, falloff)));
  }
  return { size, pixels };
}

/** A grain, 2×2 texels of paint in a blank border so the sampler never repeats its edge: 4 texels spanning 2. */
export function drawPhotoshopAirbrushGrain(): { size: number; pixels: Uint8Array } {
  return { size: 4, pixels: Uint8Array.from({ length: 16 }, (_, i) => ((i >> 2) % 3 && (i & 3) % 3 ? 0 : 255)) };
}

/**
 * Pressure's share of a spray's radius over signal s = 1 − p: R(p)/R(0), at the preset's diameter (the rim is a
 * share of it, so a brush painted at another size has its rim scaled).
 */
const sprayByPressure = (D: number): StampScaleResponse => ({ kind: 'curve', points: [[0, (2 * RIM) / (D + 2 * RIM)], [1, 1]] });

/** An airbrush as the studio reads it: what it sets of the tip and the layer, and its bindings, which win their sensor. */
export type PhotoshopAirbrushReading = {
  tip: Pick<StampBrushTip, 'span'> & Partial<Pick<StampBrushTip, 'roundness' | 'pixels'>>;
  spacing: number;
  flow: number;
  scatter?: StampBrushLayer['scatter'];
  dynamics: { size?: StampBindingsOf; flow?: StampBindingsOf; scatter?: StampBindingsOf };
};
type StampBindingsOf = { pressure?: StampScaleResponse; random?: StampScaleResponse };

const curve = (f: (s: number) => number): StampScaleResponse => ({ kind: 'curve', points: Array.from({ length: 17 }, (_, i) => [i / 16, f(i / 16)] as const) });

/**
 * The airbrush's reading. Spacing goes by the preset's diameter, not the spray's (the layer steps `spread`), and a
 * smooth spray's flow keeps its line as dark at every pressure. A grain's count is its paint per step at 100 px over a
 * grain's paint, growing with the diameter.
 */
export function photoshopAirbrushReading(tip: PhotoshopAirbrushTip): PhotoshopAirbrushReading {
  const D = tip.geometry.diameter, mode = photoshopAirbrushMode(tip), falloff = sprayFalloff(tip);
  const spacing = Math.max(STAMP_MIN_SPACING, tip.geometry.spacing / 100), narrowing = sprayByPressure(D);
  if (mode === 'smooth') {
    return {
      tip: { span: (sprayReach(falloff) * (D + 2 * RIM)) / D }, spacing, flow: 1,
      dynamics: { size: { pressure: narrowing }, flow: { pressure: curve((s) => Math.min(1, (SMOOTH_K * spacing * D) / ((D * s) / 2 + RIM))) } },
    };
  }
  const spray = { radius: (D / 2 + RIM) / D, lateral: 0, distribution: sprayDistribution(falloff) };
  if (mode === 'grain') {
    const mass = GRAIN_MASS.hard + (GRAIN_MASS.soft - GRAIN_MASS.hard) * softness(tip);
    const stepsMerged = spacing / (tip.geometry.spacing / 100);
    return {
      tip: { span: 2, pixels: 2, roundness: 0.5 }, spacing, flow: GRAIN_PEAK,
      scatter: { ...spray, count: (tip.splatCount * mass * stepsMerged) / ((2 * GRAIN_PEAK) / 3), countGrowth: { diameter: 100, exponent: GRAIN_MASS.exponent } },
      dynamics: { scatter: { pressure: narrowing }, flow: { random: curve((u) => 1 - Math.sqrt(u)) } },
    };
  }
  const largest = splatDiameter(tip, 1);
  return {
    tip: { span: photoshopComputedTipSpan(largest, tip.simulatedHardness / 100) }, spacing, flow: 1,
    scatter: { ...spray, count: Math.max(1, Math.round(tip.splatCount * SPLAT.keep)) },
    dynamics: { scatter: { pressure: narrowing }, size: { random: curve((u) => splatDiameter(tip, u) / D) } },
  };
}
