// stamp-stroke-hand.ts: how a painter's hand moves a brush along an authored stroke, its pressure and its speed at
// every point, so a stroke written in code reads as painted rather than drawn with a mouse at constant pressure.
//
// Pieces compose into one pressure per point: a profile over the stroke's length (a taper, a flick), the path's
// shape (a hand slows and presses in a tight turn, speeds up and lightens on a straight run), and seeded wobble.
// Speed comes from the same shape plus a hand's ease-in, and a reveal spends its time where the hand is slow
// (stamp-placement.ts). Everything is a function of the path and the deposit's seed, so a frame depends only on its
// time.

import { clamp, lerp } from '#lib/picture/motion/models/motion.ts';
import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampStrokePoint } from './stamp-placement.ts';

/** Pressure, 0..1, at `along`, the share of the stroke's length behind it (0..1). */
export type StampPressureCurve = (along: number) => number;

export type StampPressureProfileName = 'taper' | 'pressFlick' | 'swell' | 'drag';

const smooth = (k: number) => {
  const x = clamp(k);
  return x * x * (3 - 2 * x);
};

/** The named profiles, exported so a custom curve can build on one. */
export const STAMP_PRESSURE_PROFILES: Record<StampPressureProfileName, StampPressureCurve> = {
  /** Light, firm, light: touches down, presses through the middle, lifts off a little slower than it landed. */
  taper: (u) => 0.2 + 0.8 * Math.min(smooth(u / 0.3), smooth((1 - u) / 0.35)),
  /** Lands heavy and fades fast, a flick off the end. */
  pressFlick: (u) => (u < 0.1 ? lerp(0.8, 1, smooth(u / 0.1)) : 0.1 + 0.9 * (1 - (u - 0.1) / 0.9) ** 2),
  /** Thin, full, thin: a leaf or a petal. */
  swell: (u) => 0.15 + 0.85 * Math.sin(Math.PI * clamp(u)),
  /** Steady and a little short of full, lifting over its last fifth. */
  drag: (u) => (u < 0.05 ? lerp(0.6, 0.85, smooth(u / 0.05)) : 0.15 + 0.7 * smooth((1 - u) / 0.2)),
};

/**
 * How the hand paints a stroke. Every part is optional; a hand with none of them leaves the path's own pressure and
 * only gives the stroke its speed.
 */
export type StampStrokeHand = {
  /** Pressure over the stroke's length, named or as a curve. Left out, the profile is flat at full pressure. */
  profile?: StampPressureProfileName | StampPressureCurve;
  /**
   * The length, in diameters, from which a stroke gets its profile's full depth: a shorter one's is shallower in
   * proportion, as a quick dab never tapers the way a long sweep does. 12 when left out; 0 always gives the full depth.
   */
  fullProfileAt?: number;
  /**
   * How far the path's shape moves pressure, 0..1: a tight turn, where the hand slows, keeps full pressure, and a long
   * straight run, where it moves fast, lightens by up to this share. The coupling of pressure to speed lives here.
   */
  curvature?: number;
  /**
   * Seeded, smoothly varying unsteadiness: `pressure` (0..1), the share by which pressure rises or falls, so a light
   * stretch trembles as little as it presses; and `position` (in diameters), moving the path sideways. No two strokes
   * along one path are then machine-identical.
   */
  wobble?: { pressure?: number; position?: number };
};

/** Points no further apart than this share of the diameter carry the pressure between them closely enough. */
const RESAMPLE_STEP = 0.25;
/** Past this many points, the step grows instead: a very long stroke still resolves its turns at a few pixels. */
const MAX_POINTS = 4000;
/** The stretch of path, in diameters either side of a point, whose turning the hand anticipates and recovers from. */
const TURN_WINDOW = 2;
/** A turn this many diameters in radius reads as about two-thirds tight. */
const TIGHT_RADIUS = 2;
/** The share of its cruising speed a hand loses in the tightest turn. */
const CORNER_SLOWING = 0.6;
/** The share of cruising speed a hand starts from, and the diameters (or share of the stroke) it takes to get going. */
const START_SPEED = 0.3;
const START_DIAMETERS = 3;
const START_SHARE = 0.3;
/** Wobble's wavelength along the stroke, in diameters: pressure trembles faster than the path drifts. */
const PRESSURE_WOBBLE_WAVE = 2.5;
const POSITION_WOBBLE_WAVE = 5;

/**
 * `path` as `hand` paints it at `diameter`: resampled finely enough to carry its pressure, each point's pressure the
 * product of what the path gives it, the profile and the path's shape, plus wobble, and each point's speed. Wobble is
 * seeded by `seed`. Lifts stay where they were: every resampled point of a lifted segment lifts.
 */
export function handStampStroke(path: readonly StampStrokePoint[], hand: StampStrokeHand, diameter: number, seed: string): StampStrokePoint[] {
  const points = resample(path, diameter);
  const arcs = [0];
  for (let i = 1; i < points.length; i++) arcs.push(arcs[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const length = arcs.at(-1)!;
  const tightness = pathTightness(points, arcs, diameter);
  const profile = typeof hand.profile === 'string' ? STAMP_PRESSURE_PROFILES[hand.profile] : hand.profile;
  const fullAt = hand.fullProfileAt ?? 12;
  const depth = fullAt > 0 ? Math.min(1, length / (fullAt * diameter)) : 1;
  const curvature = hand.curvature ?? 0;
  const pressureWobble = smoothNoise(`${seed}|pressure`, length, PRESSURE_WOBBLE_WAVE * diameter);
  const positionWobble = smoothNoise(`${seed}|position`, length, POSITION_WOBBLE_WAVE * diameter);
  const startRun = Math.min(START_DIAMETERS * diameter, START_SHARE * length);
  return points.map((point, i) => {
    const along = length > 0 ? arcs[i] / length : 0;
    const shaped = profile ? 1 - depth * (1 - clamp(profile(along))) : 1;
    const tremble = 1 + (hand.wobble?.pressure ?? 0) * (2 * pressureWobble(arcs[i]) - 1);
    const pressure = clamp((point.pressure ?? 1) * shaped * (1 - curvature * (1 - tightness[i])) * tremble);
    const speed = (point.speed ?? 1) * lerp(START_SPEED, 1, startRun > 0 ? smooth(arcs[i] / startRun) : 1) * (1 - CORNER_SLOWING * tightness[i]);
    const reach = (hand.wobble?.position ?? 0) * diameter * (2 * positionWobble(arcs[i]) - 1);
    const [nx, ny] = normalAt(points, i);
    return { ...point, x: point.x + nx * reach, y: point.y + ny * reach, pressure, speed };
  });
}

/**
 * `path` with points added along each segment, the path's own kept, each carrying its segment's interpolated pressure
 * and speed. A repeated point is dropped, since it would read as a turn; a lifted segment isn't split, since nothing
 * lands on it and its inner points would give a stamp step places to land.
 */
function resample(path: readonly StampStrokePoint[], diameter: number): StampStrokePoint[] {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  const step = Math.max(RESAMPLE_STEP * diameter, total / MAX_POINTS);
  const points: StampStrokePoint[] = [{ x: path[0].x, y: path[0].y, pressure: path[0].pressure ?? 1, speed: path[0].speed ?? 1 }];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], span = Math.hypot(b.x - a.x, b.y - a.y);
    if (span === 0 && !b.lift) continue;
    const pieces = b.lift ? 1 : Math.ceil(span / step);
    for (let k = 1; k <= pieces; k++) {
      const t = k / pieces;
      points.push({
        x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), pressure: lerp(a.pressure ?? 1, b.pressure ?? 1, t), speed: lerp(a.speed ?? 1, b.speed ?? 1, t),
        ...(b.lift && { lift: true }),
      });
    }
  }
  return points;
}

/**
 * How tightly the path turns at each point, 0 (straight) to near 1: its turning per length, averaged over a window
 * either side so a polyline's sharp vertex reads as the rounded turn a hand makes. A lift's jump turns nothing.
 */
function pathTightness(points: readonly StampStrokePoint[], arcs: readonly number[], diameter: number): number[] {
  const turns = points.map((point, i) => {
    if (i === 0 || i === points.length - 1 || point.lift || points[i + 1].lift) return 0;
    const inward = Math.atan2(point.y - points[i - 1].y, point.x - points[i - 1].x);
    const outward = Math.atan2(points[i + 1].y - point.y, points[i + 1].x - point.x);
    const turn = outward - inward;
    return Math.abs(turn - 2 * Math.PI * Math.round(turn / (2 * Math.PI)));
  });
  const turnReach = TURN_WINDOW * diameter;
  return points.map((_, i) => {
    let weighted = turns[i];
    for (let j = i - 1; j >= 0 && arcs[i] - arcs[j] < turnReach; j--) weighted += turns[j] * (1 - (arcs[i] - arcs[j]) / turnReach);
    for (let j = i + 1; j < points.length && arcs[j] - arcs[i] < turnReach; j++) weighted += turns[j] * (1 - (arcs[j] - arcs[i]) / turnReach);
    return 1 - Math.exp(-(weighted / turnReach) * TIGHT_RADIUS * diameter);
  });
}

/** The unit normal to the path at point `i`, from its neighbours but never across a lift; (0, 0) where none differ. */
function normalAt(points: readonly StampStrokePoint[], i: number): [number, number] {
  const a = points[i > 0 && !points[i].lift ? i - 1 : i], b = points[i + 1 < points.length && !points[i + 1].lift ? i + 1 : i];
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  return d > 0 ? [-dy / d, dx / d] : [0, 0];
}

/** Value noise over 0..`length`, 0..1, one seeded value every `wave` and eased between, so it varies smoothly. */
function smoothNoise(seed: string, length: number, wave: number): (arc: number) => number {
  const random = seededRandom(seed);
  const knots = Array.from({ length: Math.ceil(length / wave) + 2 }, () => random());
  return (arc) => {
    const at = arc / wave, k = Math.floor(at);
    return lerp(knots[k], knots[k + 1], smooth(at - k));
  };
}
