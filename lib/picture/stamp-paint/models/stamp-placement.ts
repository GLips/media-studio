// stamp-placement.ts: where each stamp of a deposit lands, how big, turned how far and how much paint it carries.
//
// Each stamp's randomness comes from its own stream, keyed by the deposit's seed and the stamp's index, so a stamp
// never depends on how many stamps come before or after it. That is what makes a stroke's reveal a true prefix: the
// stamps shown partway through are the same stamps, in the same places, as the finished stroke's.

import { lerp } from '#lib/picture/motion/models/motion.ts';
import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampBrushColorDynamics, StampBrushStamping } from './stamp-brush.ts';
import {
  drawStampSlots, stampOwnShare, stampOwnTurn, stampResponseCurve, stampStepCount, stampStepShare, stampStepTurn, type StampContext, type StampDraws, type StampStepContext,
} from './stamp-dynamics.ts';

/**
 * A stroke's point in painting pixels. `pressure` 0..1 and `speed` (the hand's, relative, positive; a reveal lingers
 * where it's slow) default to 1. `lift`: no stamp lands since the point before, though length, reveal and taper
 * count the gap; still one deposit, so its parts never build on each other.
 */
export type StampStrokePoint = { x: number; y: number; pressure?: number; speed?: number; lift?: boolean };

/** A stamp the author places by hand: its own diameter and turn, or the deposit's. */
export type StampPlacement = { x: number; y: number; diameter?: number; rotation?: number; pressure?: number };

export type PlacedStamp = {
  x: number;
  y: number;
  diameter: number;
  rotation: number;
  /** The share of its tip's roundness it keeps, 0..1: below 1 only under roundness pressure or jitter. */
  roundness: number;
  /** The share of the brush's paint this stamp lays down, 0..1: its flow after pressure and jitter. */
  alpha: number;
  /**
   * How far its paint may build, 0..1: its opacity after taper, pressure, falloff and jitter. A `buildToOpacity` brush
   * builds toward it; a `glaze` or a `build` lays alpha × opacity.
   */
  opacity: number;
  /** Whether it's mirrored across its width (x) and its length (y). */
  flipX: boolean;
  flipY: boolean;
  /** How blurred it is, 0..1 (1 about a sixteenth of its size). */
  blur: number;
  /** How far a rolling grain turns under it, radians: the stroke's direction times the grain's rotation. */
  grainTurn: number;
  /**
   * How much of a rolling grain's cut it takes, 0..1, mixed toward its uncut paint: below 1 only under grain depth
   * dynamics. A mix, not a shallower depth, since a height grain's depth is a relief's, which paints nothing at 0.
   */
  grainDepth: number;
  /** The pen's pressure at it, 0..1, as its taper lets it through: what a pressed tip touches by. */
  pressure: number;
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
// Placement reads no image, so a brush places alike whatever its images are bound to.
export type StampPlacementBrush = StampBrushStamping<unknown> & { color?: StampBrushColorDynamics };

/**
 * Falloff is per this many diameters travelled: a brush's falloff is small (0.01 to 0.1), and read per diameter it
 * faded a pencil's preview stroke to nothing well before its end.
 */
const FALLOFF_SPAN = 10;

/** Spacing below this stamps faster than any brush reads. */
export const STAMP_MIN_SPACING = 0.02;

const NO_TINT: StampTint = { hue: 0, saturation: 0, lightness: 0, secondary: 0 };

/** A stamp's tint from its draws and pressure. */
function tintOf(color: StampBrushColorDynamics | undefined, draws: StampDraws, pressure: number): StampTint {
  if (!color) return NO_TINT;
  const { stamp, pressure: by } = color, light = 1 - pressure;
  return {
    hue: (draws.hue * 2 - 1) * stamp.hue + light * by.hue,
    saturation: (draws.saturation * 2 - 1) * stamp.saturation - light * by.saturation,
    lightness: draws.lightness * stamp.lightness - draws.darkness * stamp.darkness + light * by.lightness,
    secondary: light * by.secondary,
  };
}

/**
 * What a whole deposit draws once, from its own stream: the turn `randomStart` gives every stamp. Seeded apart from
 * any stamp's stream, so it never shifts one.
 */
const depositTurn = (brush: StampBrushStamping<unknown>, seed: string) => (brush.rotation.randomStart ? seededRandom(`${seed}|deposit`)() * Math.PI * 2 : 0);

/**
 * Where a stamp lands and what the deposit does there, before the stamp's own chance: its `size` after taper and its
 * step's dynamics, the author's own `turn` (0 along a stroke), the taper's opacity and the stroke's `fade` (1 for an
 * authored stamp).
 */
type StampPlace = { x: number; y: number; size: number; turn: number; taperOpacity: number; fade: number; grainTurn: number; reveal: number };

/** The one rule a stamp is built by, placed along a stroke or by the author: its place, then its context's dynamics. */
function buildStamp(place: StampPlace, stamp: StampContext, brush: StampPlacementBrush, startTurn: number): PlacedStamp {
  const { dynamics } = brush, { draws } = stamp;
  return {
    x: place.x,
    y: place.y,
    diameter: brush.tip.pixels ?? place.size * stampOwnShare(dynamics, 'size', stamp),
    rotation: brush.rotation.angle + place.turn + stampStepTurn(dynamics, stamp) + stampOwnTurn(dynamics, stamp) + startTurn,
    roundness: stampStepShare(dynamics, 'roundness', stamp) * stampOwnShare(dynamics, 'roundness', stamp),
    alpha: brush.flow * stampStepShare(dynamics, 'flow', stamp) * stampOwnShare(dynamics, 'flow', stamp),
    opacity: place.taperOpacity * stampStepShare(dynamics, 'opacity', stamp) * place.fade * stampOwnShare(dynamics, 'opacity', stamp),
    flipX: brush.flip.x && draws.flipX < 0.5,
    flipY: brush.flip.y && draws.flipY < 0.5,
    blur: brush.blur.amount * (1 - draws.blur * brush.blur.jitter),
    grainTurn: place.grainTurn,
    grainDepth: stampStepShare(dynamics, 'grainDepth', stamp) * stampOwnShare(dynamics, 'grainDepth', stamp),
    pressure: 1 - stamp.pressureThrough * (1 - stamp.pressure),
    tint: tintOf(brush.color, draws, stamp.pressure),
    reveal: place.reveal,
  };
}

/**
 * Each segment's direction, unwrapped along the path so a partial follow never jumps at ±π. A segment of no length (a
 * repeated point) takes its neighbour's direction.
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
 * Stamps along a polyline, the whole stroke's worth, seeded by `seed`, stepped as the brush's `stepping` says: spread
 * evenly so a stamp lands on each end and a short stroke tapers at both, or each stamp's own spacing from the start.
 */
export function placeStrokeStamps(path: readonly StampStrokePoint[], brush: StampPlacementBrush, diameter: number, seed: string): PlacedStamp[] {
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const length = lengths.at(-1)!;
  const reveal = revealAlong(path, lengths);
  const headings = segmentHeadings(path), initialHeading = headings[0] ?? 0;
  const { countGrowth, distribution } = brush.scatter;
  const count = Math.max(1, Math.round(brush.scatter.count * (countGrowth ? (diameter / countGrowth.diameter) ** countGrowth.exponent : 1)));
  const startTurn = depositTurn(brush, seed);
  const { taper, dynamics } = brush;
  /** Where on the path `arc` falls, as step `index`, and what the stroke is doing there, before any stamp's randomness. */
  const at = (arc: number, index: number) => {
    const along = length > 0 ? arc / length : 0;
    let segment = 0;
    while (segment < path.length - 2 && lengths[segment + 1] < arc) segment++;
    const a = path[segment], b = path[Math.min(segment + 1, path.length - 1)];
    const span = lengths[Math.min(segment + 1, path.length - 1)] - lengths[segment];
    const k = span > 0 ? (arc - lengths[segment]) / span : 0;
    const linear = Math.min(
      taper.start > 0 ? Math.min(1, along / taper.start) : 1,
      taper.end > 0 ? Math.min(1, (1 - along) / taper.end) : 1,
    );
    const ramp = 1 - (1 - linear) ** (1 + 3 * taper.shape);
    // `countDraw` is the step's own, drawn once the steps are laid; nothing a step's size reads.
    const step: StampStepContext = {
      pressure: lerp(a.pressure ?? 1, b.pressure ?? 1, k), pressureThrough: lerp(1 - taper.pressure, 1, ramp),
      heading: headings[Math.min(segment, headings.length - 1)] ?? 0, initialHeading, step: index, distance: arc, countDraw: 0,
    };
    const size = diameter * lerp(taper.size, 1, ramp) * stampStepShare(dynamics, 'size', step);
    return { along, segment, k, a, b, ramp, size, step, lifted: b.lift === true && k > 0 && k < 1 };
  };
  const places: ReturnType<typeof at>[] = [];
  if (brush.stepping === 'spread') {
    const steps = length > 0 ? Math.ceil(length / (Math.max(brush.spacing, STAMP_MIN_SPACING) * diameter)) : 0;
    for (let i = 0; i <= steps; i++) places.push(at(steps ? (i / steps) * length : 0, i));
  } else {
    // Each step is the spacing of the stamp it leaves, at that stamp's size before its random loss. A step landing on
    // the end paints nothing there: steps summed in floating point fall a hair short of it, hence the tolerance.
    for (let arc = 0, first = true; first || arc < length - 1e-6; first = false) {
      const place = at(arc, places.length);
      places.push(place);
      arc += Math.max(1, brush.spacing * place.size);
    }
  }
  const stamps: PlacedStamp[] = [];
  places.forEach(({ along, segment, k, a, b, ramp, size, step: where, lifted }, i) => {
    const fade = (1 - brush.falloff) ** (where.distance / diameter / FALLOFF_SPAN);
    // The count draw is the step's own stream's, drawn only for a brush whose count reads it.
    const step: StampStepContext = { ...where, countDraw: dynamics.count?.random ? seededRandom(`${seed}|${i}|count`)() : 0 };
    const kept = stampStepCount(dynamics, count, step), reach = stampStepShare(dynamics, 'scatter', step);
    for (let c = 0; c < count; c++) {
      const draws = drawStampSlots(seededRandom(`${seed}|${i}|${c}`), 'stroke');
      if (lifted || c >= kept) continue;
      const lateral = (draws.lateral * 2 - 1) * brush.scatter.lateral * reach * diameter;
      // A uniform distance, not a uniform spot in the disc, so stamps crowd the stroke: Photoshop's both-axes scatter
      // (vid-97's scatter probe fits it at 0.009 rms; uniform over the disc's area, 0.022).
      const strays = distribution ? stampResponseCurve(distribution, draws.scatterReach) : draws.scatterReach;
      const scatterTurn = draws.scatterTurn * Math.PI * 2, scatterReach = strays * brush.scatter.radius * reach * diameter;
      stamps.push(buildStamp({
        x: lerp(a.x, b.x, k) - Math.sin(step.heading) * lateral + Math.cos(scatterTurn) * scatterReach,
        y: lerp(a.y, b.y, k) + Math.cos(step.heading) * lateral + Math.sin(scatterTurn) * scatterReach,
        size, turn: 0, taperOpacity: lerp(taper.opacity, 1, ramp), fade,
        grainTurn: brush.grain?.kind === 'rolling' ? step.heading * brush.grain.rotation : 0,
        reveal: reveal(segment, k, along),
      }, { ...step, stamp: c, draws }, brush, startTurn));
    }
  });
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

/** The author's placements in order, each a step of its own under the brush's dynamics, seeded by `seed`. */
export function placeAuthoredStamps(at: readonly StampPlacement[], brush: StampPlacementBrush, diameter: number, seed: string): PlacedStamp[] {
  const startTurn = depositTurn(brush, seed);
  return at.map((placement, i) => {
    const step: StampStepContext = { pressure: placement.pressure ?? 1, pressureThrough: 1, heading: 0, initialHeading: 0, step: i, distance: 0, countDraw: 0 };
    return buildStamp({
      x: placement.x,
      y: placement.y,
      size: (placement.diameter ?? diameter) * stampStepShare(brush.dynamics, 'size', step),
      turn: placement.rotation ?? 0, taperOpacity: 1, fade: 1, grainTurn: 0,
      reveal: at.length > 1 ? i / (at.length - 1) : 0,
    }, { ...step, stamp: 0, draws: drawStampSlots(seededRandom(`${seed}|${i}|0`), 'authored') }, brush, startTurn);
  });
}
