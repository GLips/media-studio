// stamp-placement.ts: where each stamp of a deposit lands, how big, turned how far and how much paint it carries,
// written into its rows as it's placed (stamp-mark-rows.ts).
//
// Each stamp's randomness comes from its own stream, keyed by numbers: the deposit's seed, the stamp's step and its place
// in the step (stampStreamKey). So a stamp never depends on how many stamps come before or after it: a boil's epoch or
// a live pose re-places a stroke's stamps without one moving another. Nothing a stamp allocates: its draws, its context
// and its stream are one record each, filled again.

import { lerp } from '#lib/picture/motion/models/motion.ts';
import { randomSeedFromKey } from '#lib/picture/motion/models/random.ts';
import type { StampBrushColorDynamics, StampBrushStamping, StampBrushTip } from './stamp-brush.ts';
import {
  drawStampSlots, stampDrawsRecord, stampFadeShare, stampOwnShare, stampOwnSize, stampOwnTurn, stampPressureShare, stampResponseCurve, stampStepCount, stampStepShare, stampStepTurn, type StampContext,
} from './stamp-dynamics.ts';
import { createStampMarksWriter, STAMP_MARK_FIELDS, STAMP_TINT_FIELDS, type FrozenStampMarks, type StampMarksWriter } from './stamp-mark-rows.ts';

/**
 * A stroke's point in painting pixels. `pressure` 0..1 defaults to 1. `lift`: no stamp lands since the point
 * before, though length and taper count the gap; still one deposit, so its parts never build on each other.
 */
export type StampStrokePoint = {
  x: number; y: number; pressure?: number; lift?: boolean;
  /** The share of the deposit's diameter the stroke is here, default 1. */
  scale?: number;
};

/** A stamp the author places by hand: its own diameter and turn, or the deposit's. */
export type StampPlacement = { x: number; y: number; diameter?: number; rotation?: number; pressure?: number };

/** The stamping a placement reads: a brush's own stamps, and its colour dynamics when it's a main brush that has them. */
// Placement reads no image, so a brush places alike whatever its images are bound to, a bristle tip bound or not.
export type StampPlacementBrush = Omit<StampBrushStamping<unknown>, 'tip'> & { tip: Pick<StampBrushTip<unknown>, 'roundness' | 'sampling' | 'pixels'>; color?: StampBrushColorDynamics };

/** A placement's seed: the 32-bit root its stamps' streams are keyed from (stampPlacementSeed, stampSeedPart). */
export type StampPlacementSeed = number;

/** What each stream under a seed is for, so no two share one. */
const STAMP_STREAMS = { stamp: 1, count: 2, depositTurn: 3, run: 4, dual: 5 } as const;

/** A step of murmur3's body: `h` carried on over `value`. */
function keyed(h: number, value: number): number {
  let k = Math.imul(value | 0, 0xcc9e2d51);
  k = Math.imul((k << 15) | (k >>> 17), 0x1b873593);
  const mixed = h ^ k;
  return (Math.imul((mixed << 13) | (mixed >>> 19), 5) + 0xe6546b64) | 0;
}

/** murmur3's finish: every bit of `h` reaching every other. */
function finished(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The stream key of `seed`'s stream `stream`, at `a` and `b` (a stamp's step and its place in it). */
const stampStreamKey = (seed: StampPlacementSeed, stream: number, a = 0, b = 0) => finished(keyed(keyed(keyed(seed, stream), a), b));

/** A placement's seed from its text. */
export const stampPlacementSeed = (seed: string): StampPlacementSeed => randomSeedFromKey(seed);

/** The seed of a part placed apart under `seed`: a flood's run `index`, or a dual's stamps. */
export const stampSeedPart = (seed: StampPlacementSeed, part: 'run' | 'dual', index = 0): StampPlacementSeed => stampStreamKey(seed, STAMP_STREAMS[part], index);

/** A stream of numbers in [0, 1) (seededRandom's mulberry32), started again at a key rather than made anew. */
function createStampStream() {
  let a = 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, from: (key: number) => { a = key; } };
}

/**
 * Falloff is per this many diameters travelled: a brush's falloff is small (0.01 to 0.1), and read per diameter it
 * faded a pencil's preview stroke to nothing well before its end.
 */
const FALLOFF_SPAN = 10;

/** Spacing below this stamps faster than any brush reads. */
export const STAMP_MIN_SPACING = 0.02;

/**
 * What a whole deposit draws once, from its own stream: the turn `randomStart` gives every stamp. Seeded apart from
 * any stamp's stream, so it never shifts one.
 */
function depositTurn(brush: StampPlacementBrush, seed: StampPlacementSeed): number {
  if (!brush.rotation.randomStart) return 0;
  const stream = createStampStream();
  stream.from(stampStreamKey(seed, STAMP_STREAMS.depositTurn));
  return stream.next() * Math.PI * 2;
}

/**
 * Where a stamp lands and what the deposit does there, before the stamp's own chance: its `size` after taper and its
 * step's dynamics, `full` (the size a spread of it folds back under), the author's own `turn` (0 along a stroke), the
 * taper's opacity and the stroke's `fade` (1 for an authored stamp).
 */
type StampPlace = { x: number; y: number; size: number; full: number; turn: number; taperOpacity: number; fade: number; grainTurn: number };

/** The one rule a stamp is built by, placed along a stroke or by the author: its place, then its context's dynamics, into a new row of `into`. */
function writeStamp(into: StampMarksWriter, place: StampPlace, stamp: StampContext, brush: StampPlacementBrush, startTurn: number): void {
  const { dynamics } = brush, { draws } = stamp, o = into.next(), r = into.rows;
  r[o] = place.x;
  r[o + 1] = place.y;
  r[o + 2] = brush.tip.pixels ?? stampOwnSize(dynamics, place.size, place.full, stamp);
  r[o + 3] = brush.rotation.angle + place.turn + stampStepTurn(dynamics, stamp) + stampOwnTurn(dynamics, stamp) + startTurn;
  r[o + 4] = stampStepShare(dynamics, 'roundness', stamp) * stampOwnShare(dynamics, 'roundness', stamp);
  r[o + 5] = brush.flow * stampStepShare(dynamics, 'flow', stamp) * stampOwnShare(dynamics, 'flow', stamp);
  r[o + 6] = place.taperOpacity * stampStepShare(dynamics, 'opacity', stamp) * place.fade * stampOwnShare(dynamics, 'opacity', stamp);
  r[o + 7] = (brush.flip.x && draws.flipX < 0.5 ? 1 : 0) + (brush.flip.y && draws.flipY < 0.5 ? 2 : 0);
  r[o + 8] = brush.blur.amount * (1 - draws.blur * brush.blur.jitter);
  r[o + 9] = place.grainTurn;
  r[o + 10] = stampFadeShare(dynamics, 'grainDepth', stamp) * stampOwnShare(dynamics, 'grainDepth', stamp);
  r[o + 11] = stampPressureShare(dynamics, 'grainDepth', stamp);
  r[o + 12] = 1 - stamp.pressureThrough * (1 - stamp.pressure);
  r[o + 13] = place.x;
  r[o + 14] = place.y;
  const { color } = brush, tints = into.tints;
  if (color && tints) {
    // Linear in the draws, so their mean gives the mean tint.
    const { stamp: jitter, pressure: by } = color, light = 1 - stamp.pressure, t = (o / STAMP_MARK_FIELDS) * STAMP_TINT_FIELDS;
    tints[t] = (draws.hue * 2 - 1) * jitter.hue + light * by.hue;
    tints[t + 1] = (draws.saturation * 2 - 1) * jitter.saturation - light * by.saturation;
    tints[t + 2] = draws.lightness * jitter.lightness - draws.darkness * jitter.darkness + light * by.lightness;
    tints[t + 3] = light * by.secondary;
  }
}

/** A writer for `brush`'s stamps: tinted when it has colour dynamics. */
export const stampMarksWriterFor = (brush: StampPlacementBrush): StampMarksWriter => createStampMarksWriter(brush.color !== undefined);

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
 * Writes into `into` the stamps along a polyline, stepped as the brush's `stepping` says: spread evenly so a stamp
 * lands on each end, or each stamp's own spacing from the start. A scaled stretch stamps as a stroke that share of
 * `diameter` wide does. `deposit` seeds the deposit's one start turn: a flood passes its own to each run.
 */
export function placeStrokeStamps(path: readonly StampStrokePoint[], brush: StampPlacementBrush, diameter: number, seed: StampPlacementSeed, into: StampMarksWriter, deposit = seed): void {
  // `travel`: diameters travelled to each point, each segment at its ends' harmonic mean scale, so an even scale s
  // travels exactly as a stroke s × the diameter wide.
  const lengths = [0], travel = [0];
  for (let i = 1; i < path.length; i++) {
    const span = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    lengths.push(lengths[i - 1] + span);
    travel.push(travel[i - 1] + (span * (1 / (path[i - 1].scale ?? 1) + 1 / (path[i].scale ?? 1))) / 2 / diameter);
  }
  const length = lengths.at(-1)!, travelled = travel.at(-1)!;
  const headings = segmentHeadings(path), initialHeading = headings[0] ?? 0;
  const { countGrowth, distribution } = brush.scatter;
  const startTurn = depositTurn(brush, deposit), stream = createStampStream();
  const { taper, dynamics } = brush, last = path.length - 1;
  // The step's and its stamp's context, and the stamp's place: one record each, filled again for every stamp.
  const context: StampContext = { pressure: 1, pressureThrough: 1, heading: 0, initialHeading, step: 0, distance: 0, countDraw: 0, stamp: 0, draws: stampDrawsRecord() };
  const place: StampPlace = { x: 0, y: 0, size: 0, full: 0, turn: 0, taperOpacity: 1, fade: 1, grainTurn: 0 };
  // The step being laid: where it falls between `a` and `b` (k), its taper's `ramp`, the diameter its scale makes
  // there (`unit`), its size and the diameters travelled to it.
  let a = path[0], b = path[0], k = 0, ramp = 1, unit = diameter, size = diameter, diameters = 0;
  // Steps only go forward along the path, so the segment a step falls in is sought on from the last one's.
  let reached = 0;
  /** Takes the step at `arc` along the path, step `index`, before any stamp's randomness. `arc` never falls below the last step's. */
  const at = (arc: number, index: number) => {
    const along = length > 0 ? arc / length : 0;
    while (reached < path.length - 2 && lengths[reached + 1] < arc) reached++;
    const segment = reached, next = Math.min(segment + 1, last);
    a = path[segment];
    b = path[next];
    const span = lengths[next] - lengths[segment];
    k = span > 0 ? (arc - lengths[segment]) / span : 0;
    const linear = Math.min(
      taper.start > 0 ? Math.min(1, along / taper.start) : 1,
      taper.end > 0 ? Math.min(1, (1 - along) / taper.end) : 1,
    );
    ramp = 1 - (1 - linear) ** (1 + 3 * taper.shape);
    context.pressure = lerp(a.pressure ?? 1, b.pressure ?? 1, k);
    context.pressureThrough = lerp(1 - taper.pressure, 1, ramp);
    context.heading = headings[Math.min(segment, headings.length - 1)] ?? 0;
    context.step = index;
    context.distance = arc;
    // `countDraw` is the step's own, drawn once the step is laid; nothing a step's size reads.
    context.countDraw = 0;
    unit = diameter * lerp(a.scale ?? 1, b.scale ?? 1, k);
    size = unit * lerp(taper.size, 1, ramp) * stampStepShare(dynamics, 'size', context);
    diameters = lerp(travel[segment], travel[next], k);
  };
  /** Draws stamp `c` of step `index` into the context. */
  const drawn = (index: number, c: number) => {
    stream.from(stampStreamKey(seed, STAMP_STREAMS.stamp, index, c));
    drawStampSlots(stream.next, 'stroke', context.draws);
    context.stamp = c;
  };
  /** Lays the step taken (`at`), step `index`, its first stamp's draws already drawn when `first`. */
  const lay = (index: number, first: boolean) => {
    // A lifted step lays nothing, and every stamp's draws are its own stream's, so none is drawn.
    if (b.lift === true && k > 0 && k < 1) return;
    const fade = (1 - brush.falloff) ** (diameters / FALLOFF_SPAN);
    const count = Math.max(1, Math.round(brush.scatter.count * (countGrowth ? (unit / countGrowth.diameter) ** countGrowth.exponent : 1)));
    // The count draw is the step's own stream's, drawn only for a brush whose count reads it.
    if (dynamics.count?.random) {
      stream.from(stampStreamKey(seed, STAMP_STREAMS.count, index));
      context.countDraw = stream.next();
    }
    const kept = stampStepCount(dynamics, count, context), reach = stampStepShare(dynamics, 'scatter', context);
    const sin = Math.sin(context.heading), cos = Math.cos(context.heading);
    const x = lerp(a.x, b.x, k), y = lerp(a.y, b.y, k), taperOpacity = lerp(taper.opacity, 1, ramp);
    const grainTurn = brush.grain?.kind === 'rolling' ? context.heading * brush.grain.rotation : 0;
    for (let c = 0; c < kept; c++) {
      if (c > 0 || !first) drawn(index, c);
      const { draws } = context;
      const scatterUnit = brush.scatter.reachIn === 'stamp' ? stampOwnSize(dynamics, size, unit, context) : unit;
      const lateral = (draws.lateral * 2 - 1) * brush.scatter.lateral * reach * scatterUnit;
      // A uniform distance, not a uniform spot in the disc, so stamps crowd the stroke: Photoshop's both-axes scatter
      // (vid-97's scatter probe fits it at 0.009 rms; uniform over the disc's area, 0.022).
      const strays = distribution ? stampResponseCurve(distribution, draws.scatterReach) : draws.scatterReach;
      const scatterTurn = draws.scatterTurn * Math.PI * 2, scatterReach = strays * brush.scatter.radius * reach * scatterUnit;
      place.x = x - sin * lateral + Math.cos(scatterTurn) * scatterReach;
      place.y = y + cos * lateral + Math.sin(scatterTurn) * scatterReach;
      place.size = size;
      place.full = unit;
      place.taperOpacity = taperOpacity;
      place.fade = fade;
      place.grainTurn = grainTurn;
      writeStamp(into, place, context, brush, startTurn);
    }
  };
  if (brush.stepping === 'spread') {
    // Even in diameters travelled, so a scaled-down stretch steps as closely as its smaller stamps want.
    const steps = length > 0 ? Math.ceil(travelled / Math.max(brush.spacing, STAMP_MIN_SPACING)) : 0;
    let segment = 0;
    for (let i = 0; i <= steps; i++) {
      const goal = steps ? (i / steps) * travelled : 0;
      while (segment < path.length - 2 && travel[segment + 1] < goal) segment++;
      const across = travel[segment + 1] - travel[segment];
      const arc = across > 0 ? lengths[segment] + ((goal - travel[segment]) / across) * (lengths[segment + 1] - lengths[segment]) : lengths[segment];
      at(Math.min(arc, length), i);
      lay(i, false);
    }
  } else {
    // Each step is the spacing of its first stamp, at that stamp's size after its random loss: Spatter Spread's
    // jittered dots close up. A step landing on the end paints nothing there: steps summed in floating point fall a
    // hair short of it, hence the tolerance.
    for (let arc = 0, index = 0; index === 0 || arc < length - 1e-6; index++) {
      at(arc, index);
      drawn(index, 0);
      const spacing = Math.max(1, brush.spacing * stampOwnSize(dynamics, size, unit, context));
      lay(index, true);
      arc += spacing;
    }
  }
}

/** The author's placements in order, each a step of its own under the brush's dynamics, seeded by `seed`, written into `into`. */
export function placeAuthoredStamps(at: readonly StampPlacement[], brush: StampPlacementBrush, diameter: number, seed: StampPlacementSeed, into: StampMarksWriter): void {
  const startTurn = depositTurn(brush, seed), stream = createStampStream();
  const context: StampContext = { pressure: 1, pressureThrough: 1, heading: 0, initialHeading: 0, step: 0, distance: 0, countDraw: 0, stamp: 0, draws: stampDrawsRecord() };
  const place: StampPlace = { x: 0, y: 0, size: 0, full: 0, turn: 0, taperOpacity: 1, fade: 1, grainTurn: 0 };
  at.forEach((placement, i) => {
    context.pressure = placement.pressure ?? 1;
    context.step = i;
    stream.from(stampStreamKey(seed, STAMP_STREAMS.stamp, i, 0));
    drawStampSlots(stream.next, 'authored', context.draws);
    place.x = placement.x;
    place.y = placement.y;
    place.size = (placement.diameter ?? diameter) * stampStepShare(brush.dynamics, 'size', context);
    place.full = placement.diameter ?? diameter;
    place.turn = placement.rotation ?? 0;
    writeStamp(into, place, context, brush, startTurn);
  });
}

/** A stroke's stamps alone, as marks: for a probe or a test. */
export function placedStrokeMarks(path: readonly StampStrokePoint[], brush: StampPlacementBrush, diameter: number, seed: string): FrozenStampMarks {
  const into = stampMarksWriterFor(brush);
  placeStrokeStamps(path, brush, diameter, stampPlacementSeed(seed), into);
  return into.finish();
}

/** An author's placements alone, as marks: for a probe or a test. */
export function placedAuthoredMarks(at: readonly StampPlacement[], brush: StampPlacementBrush, diameter: number, seed: string): FrozenStampMarks {
  const into = stampMarksWriterFor(brush);
  placeAuthoredStamps(at, brush, diameter, stampPlacementSeed(seed), into);
  return into.finish();
}
