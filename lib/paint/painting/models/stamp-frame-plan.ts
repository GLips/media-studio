// stamp-frame-plan.ts: what a painting's frame at `t` draws, group by group (its marks, where it's laid, the warp
// bending it, its visibility, the time its paint reads), each group planned from its frame state
// (stamp-paint-frame-state.ts), its recipe's own merged in. A group's paint key names what its film depends on, so a
// frame held on twos draws the film it drew before.

import type { StampGroupPlacement } from './stamp-group-motion.ts';
import { STAMP_WARP_CELL, stampPlacementWarpMap, type StampWarpMap } from './stamp-group-warp.ts';
import {
  stampLiveGroupProblem, stampPaintFrameStateAt, type StampGroupFrameState, type StampGroupGlow, type StampGroupLay, type StampGroupMarks, type StampPaintFrameState,
} from './stamp-paint-frame-state.ts';
import type { CompiledStampGroup, CompiledStampPaint } from './stamp-paint-recipe-compile.ts';

/**
 * A group as a frame draws it, its frame state resolved: `lay` null where it lies as painted; `paintAt` null for paint
 * that doesn't change.
 */
export type StampGroupFrame = {
  /** What its film depends on: its marks and paint's time; 'hidden' drawn not at all. */
  paintKey: string;
  group: CompiledStampGroup;
  marks: StampGroupMarks;
  lay: StampGroupLay | null;
  warp: { map: StampWarpMap; key: string; cell: number } | null;
  visibility: number;
  paintAt: number | null;
  /** The light it gives off; null for none, as a glow of amount 0 is. */
  glow: StampGroupGlow | null;
};

const isStill = ({ x, y, rotation, scale }: StampGroupPlacement) => x === 0 && y === 0 && rotation === 0 && scale === 1;

/** `id`'s glow as drawn, checked: none, or one of amount 0, is null, so equal looks key equal. */
function stampGroupGlowChecked(id: string, glow: StampGroupGlow | undefined): StampGroupGlow | null {
  if (!glow) return null;
  const { amount, threshold } = glow;
  if (!(Number.isFinite(amount) && amount >= 0 && threshold >= 0 && threshold <= 1)) throw new Error(`stamp paint: ${id}'s glow ${JSON.stringify(glow)} needs an amount from 0 and a threshold within 0..1`);
  return amount > 0 ? { amount, threshold } : null;
}

/** `group`'s frame from its frame state, checked: throws on state it can't draw. */
function stampGroupFrame(group: CompiledStampGroup, state: StampGroupFrameState): StampGroupFrame {
  const { lay, warp, marks = { kind: 'written', epoch: 0 }, paintAt, visibility = 1 } = state;
  if (marks.kind === 'written' && !(Number.isInteger(marks.epoch) && marks.epoch >= 0 && (marks.epoch === 0 || group.boil))) {
    throw new Error(`stamp paint: ${group.id}'s frame state gives boil epoch ${marks.epoch}; an epoch is a whole number from 0, past 0 for a group compiled with a boil`);
  }
  const liveProblem = marks.kind === 'live' && stampLiveGroupProblem(group, marks.marks);
  if (liveProblem) throw new Error(`stamp paint: ${group.id} can't be drawn live: ${liveProblem}`);
  if (!(visibility >= 0 && visibility <= 1)) throw new Error(`stamp paint: ${group.id}'s visibility is ${visibility}, outside 0..1`);
  if (warp && !(warp.cell === undefined || warp.cell > 0)) throw new Error(`stamp paint: ${group.id}'s warp lattice needs a positive cell, not ${warp.cell}`);
  if (paintAt !== undefined && !Number.isFinite(paintAt)) throw new Error(`stamp paint: ${group.id}'s paint is read at ${paintAt} s`);
  if (lay) {
    const { placement: { x, y, rotation, scale }, pivot } = lay;
    if (![x, y, rotation, scale, pivot.x, pivot.y].every(Number.isFinite) || !(scale > 0)) throw new Error(`stamp paint: ${group.id}'s lay needs finite values and a positive scale`);
  }
  const moved = lay && !isStill(lay.placement) ? lay : null;
  // A hidden group draws nothing, whatever its marks or lay.
  const paintKey = visibility === 0 ? 'hidden' : `${marks.kind === 'live' ? `*${JSON.stringify(marks.key)}` : marks.epoch}${paintAt === undefined ? '' : `~${paintAt}`}`;
  return {
    paintKey, group, marks, lay: moved, warp: warp ? { map: warp.map, key: warp.key, cell: warp.cell ?? STAMP_WARP_CELL } : null, visibility,
    paintAt: paintAt ?? null, glow: stampGroupGlowChecked(group.id, state.glow),
  };
}

/**
 * The frame of `painting` at `t` seconds into its scene, each group in its recipe's own state with `given` over it
 * (stampPaintFrameStateAt), in the painting's order. Throws on state for a group the painting doesn't have, or state
 * it can't draw.
 */
export function stampFramePlan(painting: CompiledStampPaint, t: number, given?: StampPaintFrameState): readonly StampGroupFrame[] {
  const state = stampPaintFrameStateAt(painting, t, given);
  return painting.groups.map((group) => stampGroupFrame(group, state.get(group.id) ?? {}));
}

/**
 * One exposure of a reference frame of `painting` (lens-mode.ts): each group's paint as at the frame's own time `held`
 * (its marks, boil epoch and paintAt: paint doesn't change within a shutter, and its films are drawn once a frame),
 * and where it lies, bends, shows and glows as at the exposure's moment `exposed`.
 */
export function stampFramePlanExposed(
  painting: CompiledStampPaint, held: { t: number; state?: StampPaintFrameState }, exposed: { t: number; state?: StampPaintFrameState },
): readonly StampGroupFrame[] {
  const paint = stampPaintFrameStateAt(painting, held.t, held.state), seen = stampPaintFrameStateAt(painting, exposed.t, exposed.state);
  return painting.groups.map((group) => {
    const { marks, paintAt } = paint.get(group.id) ?? {};
    return stampGroupFrame(group, { ...seen.get(group.id), marks, paintAt });
  });
}

/** Where a group lies and bends, as a frame draws it: all a group's travel reads of a frame. */
export type StampGroupPose = Pick<StampGroupFrame, 'lay' | 'warp'>;

/** Where `frame` lays a point of its group's layer (rest space) in the scene: its warp, then its placement; null where it lies as painted. */
export function stampGroupSceneMap({ lay, warp }: StampGroupPose): StampWarpMap | null {
  const placed = lay && stampPlacementWarpMap(lay.placement, lay.pivot);
  if (!warp) return placed;
  return placed ? (rest) => placed(warp.map(rest)) : warp.map;
}

/** A moment a frame's groups are posed at: `at` seconds, each group in `state` (stampPaintFrameStateAt). */
export type StampPosedMoment = { readonly at: number; readonly state?: StampPaintFrameState };

/**
 * What a plane's motion runs between, as the one who reads it asks. `shutter`: its frame's shutter opening and
 * closing, a displacement the lens gathers along, where paint lies. `transport`: the frame before to this one, which
 * carries paper with its group (vid-151), over the group's whole laid region.
 */
export type StampMotionSpan =
  | { readonly kind: 'shutter'; readonly open: StampPosedMoment; readonly close: StampPosedMoment }
  | { readonly kind: 'transport'; readonly from: StampPosedMoment; readonly to: StampPosedMoment };

/**
 * A group's motion over a span: `travel` takes a point of its layer to how far it moves, scene px, where it ends less
 * where it starts. `key` names it, as a picture's cache key needs.
 */
export type StampGroupTravel = { readonly travel: StampWarpMap; readonly key: string };

const groupPoseKey = ({ lay, warp }: StampGroupPose) => JSON.stringify([lay, warp && [warp.key, warp.cell]]);

/**
 * A group's motion from lying as `from` to lying as `to` (stampGroupSceneMap at each); null for one posed alike at both.
 * A plane's motion layer reads it per group, an old painting's and a shot's occurrence's alike.
 */
export function stampGroupTravel(from: StampGroupPose, to: StampGroupPose): StampGroupTravel | null {
  const fromKey = groupPoseKey(from), toKey = groupPoseKey(to);
  if (fromKey === toKey) return null;
  const mapFrom = stampGroupSceneMap(from), mapTo = stampGroupSceneMap(to);
  return {
    key: `${fromKey}>${toKey}`,
    travel: (rest) => {
      const a = mapFrom?.(rest) ?? rest, b = mapTo?.(rest) ?? rest;
      return { x: b.x - a.x, y: b.y - a.y };
    },
  };
}

/**
 * Each of `painting`'s groups' motion over `span`, null for one posed alike at both ends: the one producer of a
 * plane's motion layer. Its paint is held at `held` (stampFramePlanExposed): a shutter's paint doesn't change, and
 * paper is carried by where a group lies, not what it paints.
 */
export function stampFramePlanMotion(painting: CompiledStampPaint, held: { t: number; state?: StampPaintFrameState }, span: StampMotionSpan): readonly (StampGroupTravel | null)[] {
  const [start, end] = span.kind === 'shutter' ? [span.open, span.close] : [span.from, span.to];
  const started = stampFramePlanExposed(painting, held, { t: start.at, state: start.state });
  const ended = stampFramePlanExposed(painting, held, { t: end.at, state: end.state });
  return started.map((from, index) => stampGroupTravel(from, ended[index]));
}
