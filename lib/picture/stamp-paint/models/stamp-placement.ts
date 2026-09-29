// stamp-placement.ts: where each stamp of a deposit lands, how big, turned how far and how much paint it carries.
//
// Each stamp's randomness comes from its own stream, keyed by the deposit's seed and the stamp's index, so a stamp
// never depends on how many stamps come before or after it. That is what makes a stroke's reveal a true prefix: the
// stamps shown partway through are the same stamps, in the same places, as the finished stroke's.

import { lerp } from '#lib/picture/motion/models/motion.ts';
import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampBrushColorDynamics, StampBrushStamping } from './stamp-brush.ts';

/**
 * A point a stroke passes through, in the painting's pixels. `pressure` is 0..1, and 1 when left out. `speed` is how
 * fast the hand moves here, relative to the rest of the stroke (1 when left out, and positive): a revealed stroke spends
 * its time where it's slow. `lift` lifts the brush on the way to this point: no stamp lands between it and the point
 * before, though the stroke's length, and so its reveal and taper, still counts the gap. One stroke with lifts is one
 * deposit, so its parts never build on each other as separate strokes would.
 */
export type StampStrokePoint = { x: number; y: number; pressure?: number; speed?: number; lift?: boolean };

/** A stamp the author places by hand: its own diameter and turn, or the deposit's. */
export type StampPlacement = { x: number; y: number; diameter?: number; rotation?: number; pressure?: number };

export type PlacedStamp = {
  x: number;
  y: number;
  diameter: number;
  rotation: number;
  /** The share of the brush's paint this stamp lays down, 0..1: flow after taper, pressure, falloff and jitter. */
  alpha: number;
  /** Whether it's mirrored across its width (x) and its length (y). */
  flipX: boolean;
  flipY: boolean;
  /** How blurred it is, 0..1 (1 about a sixteenth of its size). */
  blur: number;
  /** How far a rolling grain turns under it, radians: the stroke's direction times the grain's rotation. */
  grainTurn: number;
  /**
   * How its colour moves from its deposit's (StampBrushColorDynamics): hue as a share of the wheel, saturation and
   * lightness each −1..1, and the share of the deposit's secondary colour, 0..1. Zero for a brush without them.
   */
  tint: StampTint;
  /**
   * The deposit's progress, 0..1, at which this stamp appears: the fraction of the stroke's length it sits at, or of
   * the placements before it. Stamps come in this order.
   */
  reveal: number;
};

export type StampTint = { hue: number; saturation: number; lightness: number; secondary: number };

/** The stamping a placement reads: a brush's own stamps, and its colour dynamics when it's a main brush that has them. */
export type StampPlacementBrush = StampBrushStamping & { color?: StampBrushColorDynamics };

/**
 * Falloff is per this many diameters travelled: a brush's falloff is small (0.01 to 0.1), and read per diameter it
 * faded a pencil's preview stroke to nothing well before its end.
 */
const FALLOFF_SPAN = 10;

/** Spacing below this stamps faster than any brush reads. */
export const STAMP_MIN_SPACING = 0.02;

const pressured = (pressure: number | undefined, sensitivity: number) => 1 - sensitivity * (1 - (pressure ?? 1));

const NO_TINT: StampTint = { hue: 0, saturation: 0, lightness: 0, secondary: 0 };

/** A stamp's tint from its random draws (each 0..1) and pressure. */
function tintOf(color: StampBrushColorDynamics | undefined, draws: readonly number[], pressure: number | undefined): StampTint {
  if (!color) return NO_TINT;
  const { stamp, pressure: by } = color, light = 1 - (pressure ?? 1);
  return {
    hue: (draws[0] * 2 - 1) * stamp.hue + light * by.hue,
    saturation: (draws[1] * 2 - 1) * stamp.saturation - light * by.saturation,
    lightness: draws[2] * stamp.lightness - draws[3] * stamp.darkness + light * by.lightness,
    secondary: light * by.secondary,
  };
}

/**
 * What a whole deposit draws once, from its own stream: the turn `randomStart` gives every stamp. Seeded apart from
 * any stamp's stream, so it never shifts one.
 */
const depositTurn = (brush: StampBrushStamping, seed: string) => (brush.rotation.randomStart ? seededRandom(`${seed}|deposit`)() * Math.PI * 2 : 0);

/**
 * The draws every stamp makes after its placement's own, in a fixed order: flips, blur, flow and its tint's four.
 */
function laterDraws(random: () => number) {
  const flipX = random() < 0.5, flipY = random() < 0.5, blurLoss = random(), flowLoss = random();
  return { flipX, flipY, blurLoss, flowLoss, tint: [random(), random(), random(), random()] };
}

/**
 * Each segment's direction, unwrapped along the path so a partial `rotation.follow` never jumps at ±π. A segment of no
 * length (a repeated point) takes its neighbour's direction.
 */
function segmentHeadings(path: readonly StampStrokePoint[]): number[] {
  const raw = path.slice(1).map((b, i) => (b.x === path[i].x && b.y === path[i].y ? undefined : Math.atan2(b.y - path[i].y, b.x - path[i].x)));
  let previous = raw.find((heading) => heading !== undefined) ?? 0;
  return raw.map((heading) => {
    if (heading === undefined) return previous;
    const turn = heading - previous;
    previous += turn - 2 * Math.PI * Math.round(turn / (2 * Math.PI));
    return previous;
  });
}

/**
 * Stamps along a polyline, the whole stroke's worth, seeded by `seed`. Steps are the brush's spacing or a little less,
 * spread evenly so a stamp lands on each end and a short stroke tapers at both.
 */
export function placeStrokeStamps(path: readonly StampStrokePoint[], brush: StampPlacementBrush, diameter: number, seed: string): PlacedStamp[] {
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const length = lengths.at(-1)!;
  const reveal = revealAlong(path, lengths);
  const headings = segmentHeadings(path);
  const steps = length > 0 ? Math.ceil(length / (Math.max(brush.spacing, STAMP_MIN_SPACING) * diameter)) : 0;
  const count = Math.max(1, Math.round(brush.scatter.count));
  const startTurn = depositTurn(brush, seed);
  const stamps: PlacedStamp[] = [];
  let segment = 0;
  for (let i = 0; i <= steps; i++) {
    const along = steps ? i / steps : 0, arc = along * length;
    while (segment < path.length - 2 && lengths[segment + 1] < arc) segment++;
    const a = path[segment], b = path[Math.min(segment + 1, path.length - 1)];
    const span = lengths[Math.min(segment + 1, path.length - 1)] - lengths[segment];
    const k = span > 0 ? (arc - lengths[segment]) / span : 0;
    const heading = headings[Math.min(segment, headings.length - 1)] ?? 0;
    const lifted = b.lift === true && k > 0 && k < 1;
    const pressure = a.pressure === undefined && b.pressure === undefined ? undefined : lerp(a.pressure ?? 1, b.pressure ?? 1, k);
    const { taper } = brush;
    const linear = Math.min(
      taper.start > 0 ? Math.min(1, along / taper.start) : 1,
      taper.end > 0 ? Math.min(1, (1 - along) / taper.end) : 1,
    );
    const ramp = 1 - (1 - linear) ** (1 + 3 * taper.shape);
    // Within a taper, the taper stands in for the stroke's pressure as far as its pressure link says.
    const through = lerp(1 - taper.pressure, 1, ramp);
    const fade = (1 - brush.falloff) ** (arc / diameter / FALLOFF_SPAN);
    // Count jitter keeps a step's first stamps, from the step's own stream, so it never moves the stamps it keeps.
    const kept = brush.scatter.countJitter > 0 ? Math.max(1, Math.round(count * (1 - brush.scatter.countJitter * seededRandom(`${seed}|${i}|count`)()))) : count;
    for (let c = 0; c < count; c++) {
      const random = seededRandom(`${seed}|${i}|${c}`);
      // Drawn in a fixed order, every one always, so adding a use for one never shifts another.
      const lateral = (random() * 2 - 1) * brush.jitter.lateral * diameter;
      const scatterTurn = random() * Math.PI * 2, scatterReach = Math.sqrt(random()) * brush.scatter.radius * diameter;
      const sizeLoss = random() * brush.jitter.size, opacityLoss = random() * brush.jitter.opacity;
      const turn = (random() * 2 - 1) * brush.rotation.jitter;
      const later = laterDraws(random);
      if (lifted || c >= kept) continue;
      stamps.push({
        x: lerp(a.x, b.x, k) - Math.sin(heading) * lateral + Math.cos(scatterTurn) * scatterReach,
        y: lerp(a.y, b.y, k) + Math.cos(heading) * lateral + Math.sin(scatterTurn) * scatterReach,
        diameter: diameter * lerp(taper.size, 1, ramp) * pressured(pressure, brush.pressure.size * through) * (1 - sizeLoss),
        rotation: brush.rotation.angle + brush.rotation.follow * heading + turn + startTurn,
        alpha: brush.flow * lerp(taper.opacity, 1, ramp) * pressured(pressure, brush.pressure.opacity * through) * pressured(pressure, brush.pressure.flow * through)
          * fade * (1 - opacityLoss) * (1 - later.flowLoss * brush.jitter.flow),
        flipX: brush.flip.x && later.flipX,
        flipY: brush.flip.y && later.flipY,
        blur: brush.blur.amount * (1 - later.blurLoss * brush.blur.jitter),
        grainTurn: heading * (brush.grain?.rotation ?? 0),
        tint: tintOf(brush.color, later.tint, pressure),
        reveal: reveal(segment, k, along),
      });
    }
  }
  return stamps;
}

/**
 * A stroke's reveal at a place on it (segment `segment`, `k` of the way along it, `along` of the whole length): the
 * share of the hand's travel time spent reaching it, from its points' speeds. Without speeds that's `along` itself.
 */
function revealAlong(path: readonly StampStrokePoint[], lengths: readonly number[]): (segment: number, k: number, along: number) => number {
  if (!path.some((point) => point.speed !== undefined)) return (_segment, _k, along) => along;
  const times = [0];
  for (let i = 1; i < path.length; i++) times.push(times[i - 1] + (lengths[i] - lengths[i - 1]) / (((path[i - 1].speed ?? 1) + (path[i].speed ?? 1)) / 2));
  const total = times.at(-1)!;
  return (segment, k) => (total > 0 ? lerp(times[segment], times[Math.min(segment + 1, path.length - 1)], k) / total : 0);
}

/** The author's placements in order, each with the brush's size, opacity and turn jitter, seeded by `seed`. */
export function placeAuthoredStamps(at: readonly StampPlacement[], brush: StampPlacementBrush, diameter: number, seed: string): PlacedStamp[] {
  const startTurn = depositTurn(brush, seed);
  return at.map((placement, i) => {
    const random = seededRandom(`${seed}|${i}|0`);
    const sizeLoss = random() * brush.jitter.size, opacityLoss = random() * brush.jitter.opacity;
    const turn = (random() * 2 - 1) * brush.rotation.jitter;
    const later = laterDraws(random);
    return {
      x: placement.x,
      y: placement.y,
      diameter: (placement.diameter ?? diameter) * pressured(placement.pressure, brush.pressure.size) * (1 - sizeLoss),
      rotation: brush.rotation.angle + (placement.rotation ?? 0) + turn + startTurn,
      alpha: brush.flow * pressured(placement.pressure, brush.pressure.opacity) * pressured(placement.pressure, brush.pressure.flow) * (1 - opacityLoss)
        * (1 - later.flowLoss * brush.jitter.flow),
      flipX: brush.flip.x && later.flipX,
      flipY: brush.flip.y && later.flipY,
      blur: brush.blur.amount * (1 - later.blurLoss * brush.blur.jitter),
      grainTurn: 0,
      tint: tintOf(brush.color, later.tint, placement.pressure),
      reveal: at.length > 1 ? i / (at.length - 1) : 0,
    };
  });
}
