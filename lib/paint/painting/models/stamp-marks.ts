// stamp-marks.ts: marks, where a painter's touches go and what a brush places for each.
//
// The scatter core lays out candidate marks over an area or along a path, each candidate drawn from its own key, so
// asking for more keeps the ones already there. A mark (StampMark) is a brush's geometry with its own placement key:
// paint built from it is placed from that key, not from its deposit's ID, so anything else built from the same mark
// (a mask, later) lands the same footprint.

import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampBrush, StampBrushLayer } from '#lib/paint/brush/models/stamp-brush.ts';
import {
  placeAuthoredStamps, placeStrokeStamps, stampMarksWriterFor, stampPlacementSeed, stampSeedPart, type StampPlacementBrush, type StampPlacementSeed, type StampStrokePoint,
} from '#lib/paint/brush/models/stamp-placement.ts';
import { NO_STAMP_MARKS, type FrozenStampMarks } from '#lib/paint/brush/models/stamp-mark-rows.ts';
import { handStampStroke } from '#lib/paint/brush/models/stamp-stroke-hand.ts';
import { stampPaintFieldAt, stampPaintFieldProblem, stampSeededPaintField, type StampPaintField } from './stamp-paint-field.ts';
import { stampPolygonBox, stampPolygonDistance, stampRegionPolygon, type StampPoint, type StampRegion } from './stamp-region.ts';
import type { StampPlacementGeometry, StampStrokeGeometry } from './stamp-paint-recipe-types.ts';

/**
 * Where scattered marks go: inside `region`, or along `path`, up to `spread` px either side of it. Either way more
 * where `weight` (0..1, 1 when left out), read at a mark's place, is higher, a noise weight seeded by the scatter's
 * key unless it names its own.
 */
export type StampScatterPlacement =
  | { kind: 'area'; region: StampRegion; weight?: StampPaintField<number> }
  | { kind: 'along'; path: readonly StampPoint[]; spread: number; weight?: StampPaintField<number> };

/**
 * Which way a mark runs: radians, `'along'` its path where it sits (only along one), or drawn from [min, max].
 * Left out: along a path, `'along'`; over an area, any way, [0, π].
 */
export type StampScatterAngle = number | 'along' | readonly [number, number];

/**
 * `count` marks, each `length` and `diameter` px drawn from [min, max]. Candidate k is drawn from `${key}|${k}`
 * alone, so changing `count` keeps candidates 0..count-1 where they were.
 */
export type StampScatterOptions = { count: number; length: readonly [number, number]; diameter: readonly [number, number]; angle?: StampScatterAngle; key: string };

/** A scattered mark: `key` is `${options.key}-${k}`, its centre, the way it runs (radians), its length and diameter, px. */
export type StampScatteredMark = { key: string; center: StampPoint; angle: number; length: number; diameter: number };

/** Draws an area tries before it decides its weight leaves nowhere to put a mark. */
const AREA_TRIES = 10_000;

/** Whether [min, max] is finite and in order, from `least`. */
const stampScatterRanged = ([min, max]: readonly [number, number], least: number) => Number.isFinite(min) && Number.isFinite(max) && min >= least && max >= min;

/** Marks laid out over `placement` (StampScatterPlacement), deterministic by `options.key`. Throws on a range out of order or a placement with no room. */
export function stampScatterMarks(placement: StampScatterPlacement, options: StampScatterOptions): StampScatteredMark[] {
  const { count, length, diameter, key } = options;
  const what = `stamp paint: scattering ${key}`;
  if (!(Number.isInteger(count) && count >= 0)) throw new Error(`${what}: ${count} marks, and a count is a whole number from 0`);
  if (!stampScatterRanged(length, 0)) throw new Error(`${what}: a length of [${length.join(', ')}] px, and a length runs [min, max] from 0`);
  if (!stampScatterRanged(diameter, Number.MIN_VALUE)) throw new Error(`${what}: a diameter of [${diameter.join(', ')}] px, and a diameter runs [min, max] above 0`);
  const angle = options.angle ?? (placement.kind === 'along' ? 'along' : [0, Math.PI]);
  if (angle === 'along' && placement.kind !== 'along') throw new Error(`${what}: an angle 'along' an area, and only a path has a way along it`);
  if (typeof angle === 'object' && !stampScatterRanged(angle, -Infinity)) throw new Error(`${what}: an angle of [${angle.join(', ')}], and an angle range runs [min, max]`);
  const place = placement.kind === 'area' ? areaPlacer(placement, key, what) : alongPlacer(placement, key, what);
  return Array.from({ length: count }, (_, k) => {
    const random = seededRandom(`${key}|${k}`);
    // Size first, then place: a mark keeps its size when only where it may go changes.
    const between = ([min, max]: readonly [number, number]) => min + (max - min) * random();
    const markLength = between(length), markDiameter = between(diameter);
    const drawn = typeof angle === 'object' ? between(angle) : null;
    const { center, heading } = place(random);
    let way = drawn ?? heading;
    if (typeof angle === 'number') way = angle;
    return { key: `${key}-${k}`, center, angle: way, length: markLength, diameter: markDiameter };
  });
}

/** A placement's weight seeded by `key`, or null when it has none. Throws on one that can't be read as 0..1. */
function scatterWeight(written: StampPaintField<number> | undefined, key: string, what: string) {
  if (!written) return null;
  const weight = stampSeededPaintField(written, key);
  const problem = stampPaintFieldProblem(weight, (value) => (value >= 0 && value <= 1 ? null : `a weight of ${value}, outside 0..1`));
  if (problem) throw new Error(`${what}: its weight can't be read: ${problem}`);
  return weight;
}

/** A place inside the area, by rejection: a point of its box, kept as its weight's chance where it's inside. */
function areaPlacer({ region, weight: written }: Extract<StampScatterPlacement, { kind: 'area' }>, key: string, what: string) {
  const weight = scatterWeight(written, key, what);
  const polygon = stampRegionPolygon(region);
  if (polygon.length < 3 || !polygon.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))) throw new Error(`${what}: its region isn't a shape`);
  const box = stampPolygonBox(polygon);
  return (random: () => number) => {
    for (let tries = 0; tries < AREA_TRIES; tries++) {
      const x = box.x0 + (box.x1 - box.x0) * random(), y = box.y0 + (box.y1 - box.y0) * random(), chance = random();
      if (stampPolygonDistance(polygon, x, y) > 0 && chance < (weight ? stampPaintFieldAt(weight, x, y) : 1)) return { center: { x, y }, heading: 0 };
    }
    throw new Error(`${what}: no place found in its region in ${AREA_TRIES} tries; its weight is about 0 everywhere in it`);
  };
}

/**
 * A place along the path, by arc length, and the path's heading there; with a weight, kept as its chance there, by
 * rejection. Unweighted, it draws only the place, so a weight added later leaves no other scatter's marks moved.
 */
function alongPlacer({ path, spread, weight: written }: Extract<StampScatterPlacement, { kind: 'along' }>, key: string, what: string) {
  const weight = scatterWeight(written, key, what);
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const total = lengths.at(-1) ?? 0;
  if (!(total > 0) || !Number.isFinite(total)) throw new Error(`${what}: its path has no length to scatter along`);
  if (!(spread >= 0) || !Number.isFinite(spread)) throw new Error(`${what}: a spread of ${spread} px, and a spread is finite from 0`);
  const placeAt = (random: () => number) => {
    const arc = random() * total, side = (random() * 2 - 1) * spread;
    let i = 1;
    while (i < path.length - 1 && lengths[i] < arc) i++;
    const a = path[i - 1], b = path[i], span = lengths[i] - lengths[i - 1], t = span > 0 ? (arc - lengths[i - 1]) / span : 0;
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    return { center: { x: a.x + (b.x - a.x) * t - Math.sin(heading) * side, y: a.y + (b.y - a.y) * t + Math.cos(heading) * side }, heading };
  };
  if (!weight) return placeAt;
  return (random: () => number) => {
    for (let tries = 0; tries < AREA_TRIES; tries++) {
      const placed = placeAt(random);
      if (random() < stampPaintFieldAt(weight, placed.center.x, placed.center.y)) return placed;
    }
    throw new Error(`${what}: no place found along its path in ${AREA_TRIES} tries; its weight is about 0 all along it`);
  };
}

/**
 * Where a scattered mark's stroke sits on its place: through it (`centre`), or starting from it (`start`), so marks
 * hang from their guide, as reflections hang from a waterline.
 */
export type StampMarkAnchor = 'centre' | 'start';

/** A scattered mark as a short straight stroke the way it runs, anchored on its place by `anchor` (`centre`). */
export function stampScatteredStrokePath({ center, angle, length }: StampScatteredMark, anchor: StampMarkAnchor = 'centre'): StampStrokePoint[] {
  const dx = (Math.cos(angle) * length) / 2, dy = (Math.sin(angle) * length) / 2;
  if (anchor === 'start') return [{ x: center.x, y: center.y }, { x: center.x + dx, y: center.y + dy }, { x: center.x + 2 * dx, y: center.y + 2 * dy }];
  return [{ x: center.x - dx, y: center.y - dy }, { x: center.x, y: center.y }, { x: center.x + dx, y: center.y + dy }];
}

/** Where a mark's brush goes: along a stroke, or at placements. */
export type StampMarkGeometry = ({ kind: 'stroke' } & StampStrokeGeometry) | ({ kind: 'stamps' } & StampPlacementGeometry);

/**
 * A mark: a brush, its diameter and where it goes, placed from `key`. Keys are unique in a painting, hold no "|"
 * (a seed's separator), and one mark may be used more than once: each use lands the same stamps.
 */
export type StampMark = { key: string; brush: StampBrush; diameter: number; geometry: StampMarkGeometry };

/** A deposit's eight draws from `seed`: its grains' offsets, then its colour jitter. */
export function stampDepositDraws(seed: string) {
  const random = seededRandom(`${seed}|deposit|paint`);
  return Array.from({ length: 8 }, () => random());
}

/** Where a brush's grain and its dual's start, as shares of their tiles, from the first four of a seed's draws. */
export function stampGrainOffsets(brush: StampBrush, seed: string) {
  const draws = stampDepositDraws(seed);
  const offset = (layer: StampBrushLayer | undefined, at: number): [number, number] => {
    const reach = layer?.grain?.offsetJitter ?? 0;
    return [draws[at] * reach, draws[at + 1] * reach];
  };
  return { main: offset(brush, 0), dual: offset(brush.dual, 2) };
}

/**
 * Everything a mark places, from `seed`: its stamps, its brush's dual's, and its grains' offsets. The one path a
 * stroke or a placement deposit is placed by, so a deposit and anything else built from one mark agree.
 */
export function stampMarkStamps({ brush, diameter, geometry }: Omit<StampMark, 'key'>, seed: string): { stamps: FrozenStampMarks; dualStamps: FrozenStampMarks; grainOffset: ReturnType<typeof stampGrainOffsets> } {
  // The hand's path is worked out once, so the main stamps and the dual's follow the same wobble.
  let path: readonly StampStrokePoint[] = [];
  if (geometry.kind === 'stroke') path = geometry.hand ? handStampStroke(geometry.path, geometry.hand, diameter, `${seed}|hand`) : geometry.path;
  const place = (stamping: StampPlacementBrush, scale: number, placing: StampPlacementSeed) => {
    const into = stampMarksWriterFor(stamping);
    if (geometry.kind === 'stroke') placeStrokeStamps(path, stamping, diameter * scale, placing, into);
    else placeAuthoredStamps(geometry.at.map((at) => (at.diameter === undefined ? at : { ...at, diameter: at.diameter * scale })), stamping, diameter * scale, placing, into);
    return into.finish();
  };
  const root = stampPlacementSeed(seed);
  return { stamps: place(brush, 1, root), dualStamps: brush.dual ? place(brush.dual, brush.dual.scale, stampSeedPart(root, 'dual')) : NO_STAMP_MARKS, grainOffset: stampGrainOffsets(brush, seed) };
}
