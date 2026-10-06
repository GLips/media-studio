// paint-motion-reach.ts: where a group's paint can be laid over a shot, from its motion sampled at the moments the shot
// draws (paint-span-moments.ts). Each step a point goes through (paint-motion-frame.ts's order: wobble, then each
// level's pins, flutter, sway and placement, then the recipe's own motion) moves a box's points by at most a radius:
// a value's the most any sample shows, a generator's its amplitude. So the box grown step by step holds every frame's
// lay; paintLevelPlacedHeld bounds it within. A placement scaled to 0 draws nothing.
//
// Negative space: live marks (re-placed by a poser) and re-seeded marks (re-rolled) can land anywhere, so a group
// drawing either has no bound here.

import type { StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { CompiledStampGroup } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampBoxGrown, type StampBox, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintLaneClipAt, type PaintLane } from './paint-clock.ts';
import { paintPlacementRounded } from './paint-deform.ts';
import { paintGroupPaintedBox, type CompiledPaintLevel, type PaintMotion } from './paint-motion-compile.ts';
import { paintClipMoment, paintMotionClipValueProblem, paintPinClipMoveAt, paintPlaceClipAt, type PaintMotionClip } from './paint-motion-clips.ts';
import { paintSecondsText } from './paint-span-moments.ts';

/** Where a group's paint can lie anywhere in the shot (null: it paints nothing), or why that can't be bounded. */
export type PaintGroupLaidReach = { readonly kind: 'bounded'; readonly box: StampBox | null } | { readonly kind: 'unbounded'; readonly why: string };

/** The most of each part of a placement over its samples: offset length, |scale − 1|, scale and |turn|. */
type PlacementRange = { readonly offset: number; readonly stretch: number; readonly scale: number; readonly turn: number };

const NO_RANGE: PlacementRange = { offset: 0, stretch: 0, scale: 1, turn: 0 };

const rangeWith = (range: PlacementRange, { x = 0, y = 0, rotation = 0, scale = 1 }: Partial<StampGroupPlacement>): PlacementRange => ({
  offset: Math.max(range.offset, Math.hypot(x, y)), stretch: Math.max(range.stretch, Math.abs(scale - 1)), scale: Math.max(range.scale, scale), turn: Math.max(range.turn, Math.abs(rotation)),
});

/** The farthest any point of `box` lies from `from`: at a corner, distance being convex. */
const farthest = ({ x0, x1, y0, y1 }: StampBox, from: StampPoint) => Math.max(...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => Math.hypot(x - from.x, y - from.y)));

/**
 * The most a placement in `range` about `pivot` moves a point of `box`: |t + (s·R(θ) − 1)(p − c)| ≤ |t| +
 * |p − c|·(|s − 1| + s·|θ|), since |e^{iθ} − 1| ≤ |θ|.
 */
const placementShift = (range: PlacementRange, pivot: StampPoint, box: StampBox) => range.offset + farthest(box, pivot) * (range.stretch + range.scale * range.turn);

type Extremes = { readonly low: number; readonly high: number };
const NO_EXTREMES: Extremes = { low: Infinity, high: -Infinity };
const extremesWith = (e: Extremes, value: number): Extremes => ({ low: Math.min(e.low, value), high: Math.max(e.high, value) });

/**
 * A level's values sampled at a shot's moments: its placement's range and each part's extremes (a scale of 0 among
 * them when any sample vanishes), and each pin's range.
 */
type LevelSamples = {
  readonly place: { readonly range: PlacementRange; readonly x: Extremes; readonly y: Extremes; readonly scale: Extremes; readonly turn: number } | null;
  readonly pins: ReadonlyMap<string, PlacementRange>;
};

// Keyed by the moments array, then the level: a shot samples each level once over its moments.
const sampled = new WeakMap<readonly PaintMoment[], WeakMap<CompiledPaintLevel, LevelSamples>>();

function levelSamples(level: CompiledPaintLevel, moments: readonly PaintMoment[], fps: number): LevelSamples {
  const byLevel = sampled.get(moments) ?? new WeakMap<CompiledPaintLevel, LevelSamples>();
  sampled.set(moments, byLevel);
  const known = byLevel.get(level);
  if (known) return known;
  let place: LevelSamples['place'] = null;
  if (level.place.length) {
    let range = NO_RANGE, x = NO_EXTREMES, y = NO_EXTREMES, scale = NO_EXTREMES, turn = 0;
    for (const moment of moments) {
      const playing = paintLaneClipAt(level.place, moment, fps)!, placement = paintPlacementRounded(paintPlaceClipAt(playing.play.clip, playing.moment));
      range = rangeWith(range, placement);
      x = extremesWith(x, placement.x); y = extremesWith(y, placement.y); scale = extremesWith(scale, placement.scale);
      turn = Math.max(turn, Math.abs(placement.rotation));
    }
    place = { range, x, y, scale, turn };
  }
  const pins = new Map<string, PlacementRange>();
  for (const [name, { lane }] of level.pins) {
    if (!lane.length) continue;
    // A breathe swings between rest and 1 + amount, whatever the samples catch of it.
    let range = lane.reduce((r, { clip }) => (clip.kind === 'breathe' ? rangeWith(r, { scale: 1 + clip.amount }) : r), NO_RANGE);
    if (lane.some(({ clip }) => clip.kind === 'poses')) {
      for (const moment of moments) {
        const playing = paintLaneClipAt(lane, moment, fps)!;
        if (playing.play.clip.kind === 'poses') range = rangeWith(range, paintPlacementRounded(paintPinClipMoveAt(playing.play.clip, name, playing.moment)));
      }
    }
    pins.set(name, range);
  }
  const samples = { place, pins };
  byLevel.set(level, samples);
  return samples;
}

/**
 * The most `level`'s own bend and placement move a point of `box` at `moments`, its pins left out for a live node's
 * own level.
 */
export function paintLevelShift(level: CompiledPaintLevel, box: StampBox, withPins: boolean, moments: readonly PaintMoment[], fps: number): number {
  const { place } = levelSamples(level, moments, fps);
  return paintLevelBendShift(level, box, withPins, moments, fps) + (place ? placementShift(place.range, level.pivot, box) : 0);
}

/** The most `level`'s bend (its pins, flutter and sway, all before its placement) moves a point of `box` at `moments`. */
export function paintLevelBendShift(level: CompiledPaintLevel, box: StampBox, withPins: boolean, moments: readonly PaintMoment[], fps: number): number {
  let shift = 0;
  // Pins' displacements add, each at most its whole move (a weight is at most 1).
  if (withPins) for (const [name, range] of levelSamples(level, moments, fps).pins) shift += placementShift(range, level.pins.get(name)!.pin.pivot, box);
  for (const { clip } of level.flutter) {
    // A point moves toward the axis by (1 − spread) of its distance across it.
    const ax = Math.cos(clip.direction), ay = Math.sin(clip.direction);
    const across = Math.max(...[[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => Math.abs((y - clip.at.y) * ax - (x - clip.at.x) * ay)));
    shift += (1 - clip.least) * across;
  }
  // A sway turns a point about its root by at most amount/length radians.
  for (const { clip } of level.sway) shift += farthest(box, clip.root) * (Math.abs(clip.amount) / clip.length);
  return shift;
}

/**
 * What every placement `level`'s place plays show at `moments` lays `box` over: each side as far in as any sample's
 * offset and scale bring it, then in by the most a turn moves a point. Null where that leaves nothing, or a sample
 * scales it to 0. A scale growing the box brings no side in.
 */
export function paintLevelPlacedHeld(level: CompiledPaintLevel, box: StampBox, moments: readonly PaintMoment[], fps: number): StampBox | null {
  const { place } = levelSamples(level, moments, fps);
  if (!place) return box;
  const { pivot } = level, { x, y, scale: s } = place;
  if (!(s.low > 0)) return null;
  const turned = s.high * place.turn * farthest(box, pivot);
  // A side at c + d goes to c + t + s·d: innermost at the far offset, and the least scale where d points outward.
  const low = (side: number, c: number, t: number) => c + t + (side < c ? s.low : s.high) * (side - c) + turned;
  const high = (side: number, c: number, t: number) => c + t + (side > c ? s.low : s.high) * (side - c) - turned;
  const held = { x0: low(box.x0, pivot.x, x.high), x1: high(box.x1, pivot.x, x.low), y0: low(box.y0, pivot.y, y.high), y1: high(box.y1, pivot.y, y.low) };
  return held.x0 < held.x1 && held.y0 < held.y1 ? held : null;
}

/**
 * How far a bound is grown past every step: the steps evaluation rounds moves to, a pixel for the lay's lattice, and a
 * pixel for what moves between a frame's samples.
 */
const REACH_SLACK = 2;

/**
 * Where `group`'s paint can lie at `moments` of a shot animated by `motion` (null for none) and its recipe's own
 * motion: its painted box grown by each step's most.
 */
export function paintGroupLaidReach(group: CompiledStampGroup, motion: PaintMotion | null, moments: readonly PaintMoment[]): PaintGroupLaidReach {
  const node = motion?.nodes.get(group.id);
  if (node?.marks.kind === 'live' && [...node.pins.values()].some(({ lane }) => lane.length)) return { kind: 'unbounded', why: `${group.id}'s marks are live` };
  // A recipe's boil re-seeds unless a node draws its marks (as written, or re-seeded by the node's own boil).
  if (node ? node.marks.kind === 'reseed' : group.boil) return { kind: 'unbounded', why: `${group.id}'s marks are re-seeded` };
  let box = paintGroupPaintedBox(group);
  if (!box) return { kind: 'bounded', box: null };
  if (node && motion) {
    if (node.marks.kind === 'wobble') box = stampBoxGrown(box, node.marks.wobble.amount);
    for (const [depth, id] of node.levels.entries()) {
      const level = motion.nodes.get(id)!;
      box = stampBoxGrown(box, paintLevelShift(level, box, depth > 0 || node.marks.kind !== 'live', moments, motion.animationFps));
    }
  }
  if (group.motion) box = stampBoxGrown(box, placementShift(group.motion.keys.reduce(rangeWith, NO_RANGE), group.motion.pivot ?? { x: 0, y: 0 }, box));
  return { kind: 'bounded', box: stampBoxGrown(box, REACH_SLACK) };
}

const hasFunctionValue = (clip: PaintMotionClip<string>) => (clip.kind === 'poses' || clip.kind === 'place') && typeof clip.value === 'function';

/**
 * The first problem each of `lane`'s plays' values has at any of `moments` where it plays, named by its origin and
 * the second: a function's, which no build can check as written.
 */
function laneValueProblems(lane: PaintLane<PaintMotionClip<string>>, moments: readonly PaintMoment[], fps: number, problems: string[]) {
  if (!lane.some(({ clip }) => hasFunctionValue(clip))) return;
  const said = new Set<string>();
  for (const moment of moments) {
    const playing = paintLaneClipAt(lane, moment, fps)!, { clip, origin } = playing.play;
    if (said.has(origin) || !hasFunctionValue(clip)) continue;
    const problem = paintMotionClipValueProblem(clip, paintClipMoment(playing.moment));
    if (!problem) continue;
    said.add(origin);
    problems.push(`${origin}: at ${paintSecondsText(moment.at)} ${problem}`);
  }
}

/** Every problem `level`'s values (its pins' poses and its placement) have at `moments`, each once. */
export function paintLevelValueProblems(level: CompiledPaintLevel, moments: readonly PaintMoment[], fps: number): string[] {
  const problems: string[] = [];
  laneValueProblems(level.place, moments, fps, problems);
  for (const { lane } of level.pins.values()) laneValueProblems(lane, moments, fps, problems);
  return [...new Set(problems)];
}

/** Every problem `motion`'s values have at `moments` (paintLevelValueProblems). */
export const paintMotionValueProblems = (motion: PaintMotion, moments: readonly PaintMoment[]): string[] =>
  [...motion.nodes.values()].flatMap((node) => paintLevelValueProblems(node, moments, motion.animationFps));
