// stamp-frame-plan.ts: what a painting's frame at `t` draws, group by group (its marks, where it's moved to, the warp
// bending it, its visibility, the time its paint reads), and the key a checkpoint saved partway through the frame is
// held under (stamp-paint-checkpoints.ts). What a checkpoint depends on is named here alone: the renderer saves and
// restores by this key, so a frame restores only a state it would have drawn itself.
//
// Each group's state comes from the frame state given (stamp-paint-frame-state.ts) and the recipe's own `motion` and
// `boil`, evaluated here into the same shape. Keys are built from values and the frame state's keys, never functions.

import { stampBoilEpoch, stampGroupPlacementAt, type StampGroupPlacement } from './stamp-group-motion.ts';
import { STAMP_WARP_CELL, type StampWarpMap } from './stamp-group-warp.ts';
import { stampLiveGroupProblem, type StampGroupFrameState, type StampPaintFrameState } from './stamp-paint-frame-state.ts';
import { stampSettledEventCount, type StampPaintEvent } from './stamp-paint-events.ts';
import { stampPassDeposits, type CompiledStampGroup, type CompiledStampPaint } from './stamp-paint-recipe.ts';
import type { StampPoint } from './stamp-region.ts';
import { stampKeysSpan } from './stamp-scene-keys.ts';

/** A group's events, as indices into the painting's (stampPaintEvents): from `first`, up to `end`. */
export type StampGroupEvents = { first: number; end: number };

/** Each of `painting`'s groups' events, in the order it paints them. */
export function stampGroupEvents(painting: CompiledStampPaint): StampGroupEvents[] {
  let at = 0;
  return painting.groups.map((group) => {
    const first = at;
    at += group.passes.reduce((n, pass) => n + stampPassDeposits(pass).length, 0);
    return { first, end: at };
  });
}

/**
 * A group as a frame draws it, its frame state resolved: `moved` null where it's painted; `paintAt`, the scene time its
 * paint reads, held to its span (null for paint that doesn't change). `ownMarks`, `ownPlacement`: its marks or its lay
 * (move, warp, visibility) are taken to be this frame's alone, so no checkpoint keeps them.
 */
export type StampGroupFrame = {
  group: CompiledStampGroup;
  epoch: number;
  live: { marks: CompiledStampGroup; key: string } | null;
  moved: StampGroupPlacement | null;
  pivot: StampPoint | undefined;
  warp: { map: StampWarpMap; key: string; cell: number } | null;
  visibility: number;
  paintAt: number | null;
  ownMarks: boolean;
  ownPlacement: boolean;
};

export type StampFramePlan = {
  groups: readonly StampGroupFrame[];
  /** How many events are settled at the frame's time: the prefix a checkpoint may stand for. */
  settled: number;
  /**
   * The key a checkpoint after `event` events is held under: each group laid by then at its marks and lay, and a group
   * partway through at its marks (its layer isn't laid yet, so its lay doesn't reach the checkpoint).
   */
  checkpointKey: (event: number) => string;
  /**
   * The events after which a frame starting from event `from` saves a checkpoint: its settled prefix, the state before
   * the first group that varies, and each group laid afresh painted but not laid, which later frames share; none
   * holding a state this frame's alone.
   */
  checkpointSaves: (from: number) => ReadonlySet<number>;
};

/** Whether `t` is strictly inside the span from `from` to `to`, where what's keyed is still changing. */
const changingAt = ({ from, to }: { from: number; to: number }, t: number) => from < t && t < to;

const isStill = ({ x, y, rotation, scale }: StampGroupPlacement) => x === 0 && y === 0 && rotation === 0 && scale === 1;

/**
 * `group`'s frame from its recipe's motion and boil at `t` (`frame` at the scene's fps) and `given`, the frame state
 * written for it. Given and authored never set one thing twice, but for the epoch: a given epoch re-seeds through the
 * recipe's boil in place of its own count. Live marks draw as they are, no epoch applied.
 */
function stampGroupFrame(group: CompiledStampGroup, given: StampGroupFrameState | undefined, t: number, frame: number): StampGroupFrame {
  const { recolours, boil, motion } = group, { placement: givenPlacement, pivot: givenPivot, warp, epoch: givenEpoch, visibility = 1, live } = given ?? {};
  if (motion && givenPlacement) throw new Error(`stamp paint: ${group.id} has a recipe motion and a placement in its frame state; it moves by one`);
  if (givenEpoch !== undefined && !(boil && Number.isInteger(givenEpoch) && givenEpoch >= 0)) {
    throw new Error(`stamp paint: ${group.id}'s frame state gives boil epoch ${givenEpoch}; an epoch is a whole number from 0, for a group compiled with a boil`);
  }
  if (!(visibility >= 0 && visibility <= 1)) throw new Error(`stamp paint: ${group.id}'s visibility is ${visibility}, outside 0..1`);
  if (warp && !(warp.cell === undefined || warp.cell > 0)) throw new Error(`stamp paint: ${group.id}'s warp lattice needs a positive cell, not ${warp.cell}`);
  const liveProblem = live && stampLiveGroupProblem(group, live.marks);
  if (liveProblem) throw new Error(`stamp paint: ${group.id} can't be drawn live: ${liveProblem}`);
  const placement = motion ? stampGroupPlacementAt(motion, t) : givenPlacement ?? null;
  const moved = placement && !isStill(placement) ? placement : null;
  const authoredBoil = !live && givenEpoch === undefined ? boil : undefined;
  return {
    group,
    epoch: live ? 0 : givenEpoch ?? (authoredBoil ? stampBoilEpoch(frame, authoredBoil) : 0),
    live: live ?? null,
    moved,
    pivot: motion ? motion.pivot : givenPivot,
    warp: warp ? { map: warp.map, key: warp.key, cell: warp.cell ?? STAMP_WARP_CELL } : null,
    visibility,
    paintAt: recolours ? Math.min(recolours.to, Math.max(recolours.from, t)) : null,
    ownMarks: !!live || (!!recolours && changingAt(recolours, t)) || authoredBoil?.every === 1,
    // A recipe's motion is shared beyond its keys; a lay given in frame state is taken to be the frame's own.
    ownPlacement: motion ? changingAt(stampKeysSpan(motion.keys), t) : !!(moved || warp || visibility < 1),
  };
}

/** Whether a group may draw differently in another frame once its events are settled. */
const stampGroupVaries = ({ group, live, moved, warp, visibility, epoch }: StampGroupFrame) =>
  !!(group.motion || group.boil || group.recolours || live || moved || warp || visibility < 1 || epoch);

/**
 * The frame of `painting` at `t` seconds into its scene, at `fps` (which counts a recipe boil's epochs), each group
 * in the state `state` gives it. Throws on state for a group the painting doesn't have, or state it can't draw.
 */
export function stampFramePlan(
  painting: CompiledStampPaint, groupEvents: readonly StampGroupEvents[], events: readonly StampPaintEvent[], t: number, fps: number, state: StampPaintFrameState = new Map(),
): StampFramePlan {
  const frame = Math.round(t * fps);
  const unknown = [...state.keys()].filter((id) => !painting.groups.some((group) => group.id === id));
  if (unknown.length) throw new Error(`stamp paint: frame state for ${unknown.join(', ')}, which the painting has no group of`);
  const groups = painting.groups.map((group) => stampGroupFrame(group, state.get(group.id), t, frame));
  const marks = groups.map(({ epoch, paintAt, live }) => `${epoch}${paintAt === null ? '' : `~${paintAt}`}${live ? `*${JSON.stringify(live.key)}` : ''}`);
  const laid = groups.map(({ moved, pivot, warp, visibility }, index) => marks[index]
    + (moved ? `@${moved.x},${moved.y},${moved.rotation},${moved.scale}${pivot ? `:${pivot.x},${pivot.y}` : ''}` : '')
    + (warp ? `^${warp.cell}${JSON.stringify(warp.key)}` : '')
    + (visibility < 1 ? `%${visibility}` : ''));
  /**
   * Each group with events that begin before `event`: laid by then, or partway through. A group whose lay is this
   * frame's own stands at its last event painted but not laid, a state frames laying it otherwise share. A group with
   * no events draws nothing.
   */
  const reached = (event: number) => groupEvents.flatMap(({ first, end }, index) => (first < event && first < end ? [{ index, laid: end < event || (end === event && !groups[index].ownPlacement), painted: end === event }] : []));
  const worthSaving = (event: number) => reached(event).every(({ index, laid: isLaid }) => !groups[index].ownMarks && !(isLaid && groups[index].ownPlacement));
  const settled = stampSettledEventCount(events, t);
  // Where a group laid afresh this frame is painted, before its lay: what every frame laying it otherwise shares.
  const paintedEnds = groupEvents.flatMap(({ end }, index) => (groups[index].ownPlacement && !groups[index].ownMarks ? [end] : []));
  const varyingFrom = groupEvents.find((_, index) => stampGroupVaries(groups[index]))?.first ?? events.length;
  return {
    groups,
    settled,
    checkpointKey: (event) => reached(event).map(({ index, laid: isLaid, painted }) => (isLaid ? laid[index] : `${marks[index]}${painted ? '#painted' : ''}`)).join('|'),
    checkpointSaves: (from) => new Set([settled, Math.min(settled, varyingFrom), ...paintedEnds.filter((end) => end <= settled)].filter((event) => event > from && worthSaving(event))),
  };
}
