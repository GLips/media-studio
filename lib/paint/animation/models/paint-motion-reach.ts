// paint-motion-reach.ts: where a group's paint can be laid over a whole shot, bounded from what its motion compiles
// to rather than sampled. Each step a point goes through (paint-motion-frame.ts's order: wobble, then each level's
// pins, flutter, sway and placement, then the recipe's own motion) moves the points of a box by at most a radius read
// from its clips' keys, so the box grown step by step holds every frame's lay.
//
// Eases never overshoot a key, so a keyed offset, turn or scale stays within its keys' range. Negative space: live
// marks (re-placed by a poser) and re-seeded marks (re-rolled) can land anywhere their poser or seed says, so a group
// drawing either has no bound here.

import type { StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { CompiledStampGroup } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintGroupPaintedBox, type CompiledPaintNode, type PaintMotion } from './paint-motion-compile.ts';

/** Where a group's paint can lie anywhere in the shot (null: it paints nothing), or why that can't be bounded. */
export type PaintGroupLaidReach = { readonly kind: 'bounded'; readonly box: StampBox | null } | { readonly kind: 'unbounded'; readonly why: string };

/** The most of each part of a placement over its keys: offset length, |scale − 1|, scale and |turn|. */
type PlacementRange = { readonly offset: number; readonly stretch: number; readonly scale: number; readonly turn: number };

function placementRange(keys: readonly Partial<StampGroupPlacement>[]): PlacementRange {
  let offset = 0, stretch = 0, scale = 1, turn = 0;
  for (const { x = 0, y = 0, rotation = 0, scale: s = 1 } of keys) {
    offset = Math.max(offset, Math.hypot(x, y));
    stretch = Math.max(stretch, Math.abs(s - 1));
    scale = Math.max(scale, s);
    turn = Math.max(turn, Math.abs(rotation));
  }
  return { offset, stretch, scale, turn };
}

/** The farthest any point of `box` lies from `from`: at a corner, distance being convex. */
const farthest = ({ x0, x1, y0, y1 }: StampBox, from: StampPoint) => Math.max(...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => Math.hypot(x - from.x, y - from.y)));

/**
 * The most a placement in `range` about `pivot` moves a point of `box`: |t + (s·R(θ) − 1)(p − c)| ≤ |t| +
 * |p − c|·(|s − 1| + s·|θ|), since |e^{iθ} − 1| ≤ |θ|.
 */
const placementShift = (range: PlacementRange, pivot: StampPoint, box: StampBox) => range.offset + farthest(box, pivot) * (range.stretch + range.scale * range.turn);

const grown = ({ x0, x1, y0, y1 }: StampBox, by: number): StampBox => ({ x0: x0 - by, x1: x1 + by, y0: y0 - by, y1: y1 + by });

/** The most `level`'s own bend and placement move a point of `box`, its pins left out for a live node's own level. */
function levelShift(level: CompiledPaintNode, box: StampBox, withPins: boolean): number {
  let shift = 0;
  // Pins' displacements add, each at most its whole move (a weight is at most 1).
  if (withPins) {
    for (const [name, { pin, lane }] of level.pins) {
      const moves = lane.flatMap(({ clip }) => {
        if (clip.kind === 'breathe') return [{ scale: 1 + clip.amount }];
        return clip.keys.map((key) => key.pose[name] ?? {});
      });
      if (moves.length) shift += placementShift(placementRange(moves), pin.pivot, box);
    }
  }
  for (const { clip } of level.flutter) {
    // A point moves toward the axis by (1 − spread) of its distance across it.
    const ax = Math.cos(clip.direction), ay = Math.sin(clip.direction);
    const across = Math.max(...[[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => Math.abs((y - clip.at.y) * ax - (x - clip.at.x) * ay)));
    shift += (1 - clip.least) * across;
  }
  // A sway turns a point about its root by at most amount/length radians.
  for (const { clip } of level.sway) shift += farthest(box, clip.root) * (Math.abs(clip.amount) / clip.length);
  const places = level.place.flatMap(({ clip }) => clip.keys);
  if (places.length) shift += placementShift(placementRange(places), level.pivot, box);
  return shift;
}

/** How far a bound is grown past every step: the steps evaluation rounds moves to, and a pixel for the lay's lattice. */
const REACH_SLACK = 1;

/**
 * Where `group`'s paint can lie anywhere in a shot animated by `motion` (null for none) and its recipe's own motion:
 * its painted box grown by each step's most.
 */
export function paintGroupLaidReach(group: CompiledStampGroup, motion: PaintMotion | null): PaintGroupLaidReach {
  const node = motion?.nodes.get(group.id);
  if (node?.marks.kind === 'live' && [...node.pins.values()].some(({ lane }) => lane.length)) return { kind: 'unbounded', why: `${group.id}'s marks are live` };
  // A recipe's boil re-seeds unless a node draws its marks (as written, or re-seeded by the node's own boil).
  if (node ? node.marks.kind === 'reseed' : group.boil) return { kind: 'unbounded', why: `${group.id}'s marks are re-seeded` };
  let box = paintGroupPaintedBox(group);
  if (!box) return { kind: 'bounded', box: null };
  if (node && motion) {
    if (node.marks.kind === 'wobble') box = grown(box, node.marks.wobble.amount);
    for (const [depth, id] of node.levels.entries()) {
      const level = motion.nodes.get(id)!;
      box = grown(box, levelShift(level, box, depth > 0 || node.marks.kind !== 'live'));
    }
  }
  if (group.motion) box = grown(box, placementShift(placementRange(group.motion.keys), group.motion.pivot ?? { x: 0, y: 0 }, box));
  return { kind: 'bounded', box: grown(box, REACH_SLACK) };
}
