// stamp-placement.ts: where each stamp of a deposit lands, how big, turned how far and how much paint it carries.
//
// Each stamp's randomness comes from its own stream, keyed by the deposit's seed and the stamp's index, so a stamp
// never depends on how many stamps come before or after it. That is what makes a stroke's reveal a true prefix: the
// stamps shown partway through are the same stamps, in the same places, as the finished stroke's.

import { lerp } from '#lib/picture/motion/models/motion.ts';
import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampBrushStamping } from './stamp-brush.ts';

/**
 * A point a stroke passes through, in the painting's pixels. `pressure` is 0..1, and 1 when left out. `lift` lifts the
 * brush on the way to this point: no stamp lands between it and the point before, though the stroke's length, and so
 * its reveal and taper, still counts the gap. One stroke with lifts is one deposit, so its parts never build on each
 * other as separate strokes would.
 */
export type StampStrokePoint = { x: number; y: number; pressure?: number; lift?: boolean };

/** A stamp the author places by hand: its own diameter and turn, or the deposit's. */
export type StampPlacement = { x: number; y: number; diameter?: number; rotation?: number; pressure?: number };

export type PlacedStamp = {
  x: number;
  y: number;
  diameter: number;
  rotation: number;
  /** The share of the brush's paint this stamp lays down, 0..1: flow after taper, pressure and jitter. */
  alpha: number;
  /**
   * The deposit's progress, 0..1, at which this stamp appears: the fraction of the stroke's length it sits at, or of
   * the placements before it. Stamps come in this order.
   */
  reveal: number;
};

/** Spacing below this stamps faster than any brush reads. */
export const STAMP_MIN_SPACING = 0.02;

const pressured = (pressure: number | undefined, sensitivity: number) => 1 - sensitivity * (1 - (pressure ?? 1));

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
export function placeStrokeStamps(path: readonly StampStrokePoint[], brush: StampBrushStamping, diameter: number, seed: string): PlacedStamp[] {
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const length = lengths.at(-1)!;
  const headings = segmentHeadings(path);
  const steps = length > 0 ? Math.ceil(length / (Math.max(brush.spacing, STAMP_MIN_SPACING) * diameter)) : 0;
  const count = Math.max(1, Math.round(brush.scatter.count));
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
    const ramp = Math.min(
      taper.start > 0 ? Math.min(1, along / taper.start) : 1,
      taper.end > 0 ? Math.min(1, (1 - along) / taper.end) : 1,
    );
    for (let c = 0; c < count; c++) {
      const random = seededRandom(`${seed}|${i}|${c}`);
      // Drawn in a fixed order, every one always, so adding a use for one never shifts another.
      const lateral = (random() * 2 - 1) * brush.jitter.lateral * diameter;
      const scatterTurn = random() * Math.PI * 2, scatterReach = Math.sqrt(random()) * brush.scatter.radius * diameter;
      const sizeLoss = random() * brush.jitter.size, opacityLoss = random() * brush.jitter.opacity;
      const turn = (random() * 2 - 1) * brush.rotation.jitter;
      if (lifted) continue;
      stamps.push({
        x: lerp(a.x, b.x, k) - Math.sin(heading) * lateral + Math.cos(scatterTurn) * scatterReach,
        y: lerp(a.y, b.y, k) + Math.cos(heading) * lateral + Math.sin(scatterTurn) * scatterReach,
        diameter: diameter * lerp(taper.size, 1, ramp) * pressured(pressure, brush.pressure.size) * (1 - sizeLoss),
        rotation: brush.rotation.angle + brush.rotation.follow * heading + turn,
        alpha: brush.flow * lerp(taper.opacity, 1, ramp) * pressured(pressure, brush.pressure.opacity) * (1 - opacityLoss),
        reveal: along,
      });
    }
  }
  return stamps;
}

/** The author's placements in order, each with the brush's size, opacity and turn jitter, seeded by `seed`. */
export function placeAuthoredStamps(at: readonly StampPlacement[], brush: StampBrushStamping, diameter: number, seed: string): PlacedStamp[] {
  return at.map((placement, i) => {
    const random = seededRandom(`${seed}|${i}|0`);
    const sizeLoss = random() * brush.jitter.size, opacityLoss = random() * brush.jitter.opacity;
    const turn = (random() * 2 - 1) * brush.rotation.jitter;
    return {
      x: placement.x,
      y: placement.y,
      diameter: (placement.diameter ?? diameter) * pressured(placement.pressure, brush.pressure.size) * (1 - sizeLoss),
      rotation: brush.rotation.angle + (placement.rotation ?? 0) + turn,
      alpha: brush.flow * pressured(placement.pressure, brush.pressure.opacity) * (1 - opacityLoss),
      reveal: at.length > 1 ? i / (at.length - 1) : 0,
    };
  });
}
