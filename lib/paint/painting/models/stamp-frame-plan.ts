// stamp-frame-plan.ts: what a painting's frame at `t` draws, group by group (its boil epoch, where it's moved to, the
// time its paint reads), and the key a checkpoint saved partway through the frame is held under
// (stamp-paint-checkpoints.ts). What a checkpoint depends on is named here alone: the renderer saves and restores by
// this key, so a frame restores only a state it would have drawn itself.

import { stampBoilEpoch, stampGroupPlacementAt, type StampGroupPlacement } from './stamp-group-motion.ts';
import { stampSettledEventCount, type StampPaintEvent } from './stamp-paint-events.ts';
import { stampPassDeposits, type CompiledStampGroup, type CompiledStampPaint } from './stamp-paint-recipe-compile.ts';
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

/** Whether `group` may draw differently in two frames once its events are settled: it moves, boils or recolours. */
const stampGroupVaries = (group: CompiledStampGroup) => !!(group.motion || group.boil || group.recolours);

/**
 * A group as a frame draws it: its boil `epoch` (0, as written), where it's `moved` to (null where it's painted) and
 * `paintAt`, its paint's scene time held to its keys (null for paint that doesn't change). `ownMarks`, `ownPlacement`:
 * its marks (epoch and paint) or placement are this frame's alone.
 */
export type StampGroupFrame = {
  group: CompiledStampGroup;
  epoch: number;
  moved: StampGroupPlacement | null;
  paintAt: number | null;
  ownMarks: boolean;
  ownPlacement: boolean;
};

export type StampFramePlan = {
  groups: readonly StampGroupFrame[];
  /** How many events are settled at the frame's time: the prefix a checkpoint may stand for. */
  settled: number;
  /**
   * The key a checkpoint after `event` events is held under: each group laid by then at its marks and placement, and
   * a group partway through at its marks (its layer isn't laid yet, so its placement doesn't reach the checkpoint).
   */
  checkpointKey: (event: number) => string;
  /**
   * The events after which a frame starting from event `from` saves a checkpoint: its settled prefix, and the state
   * before the first group that moves, boils or recolours, which later frames share; none holding a state this frame's alone.
   */
  checkpointSaves: (from: number) => ReadonlySet<number>;
};

/** Whether `t` is strictly inside the span from `from` to `to`, where what's keyed is still changing. */
const changingAt = ({ from, to }: { from: number; to: number }, t: number) => from < t && t < to;

/** The frame of `painting` at `t` seconds into its scene, at `fps` (which counts a boil's epochs). */
export function stampFramePlan(painting: CompiledStampPaint, groupEvents: readonly StampGroupEvents[], events: readonly StampPaintEvent[], t: number, fps: number): StampFramePlan {
  const frame = Math.round(t * fps);
  const groups = painting.groups.map((group): StampGroupFrame => {
    const placement = group.motion ? stampGroupPlacementAt(group.motion, t) : null;
    const still = !placement || (placement.x === 0 && placement.y === 0 && placement.rotation === 0 && placement.scale === 1);
    const { recolours, boil, motion } = group;
    return {
      group,
      epoch: boil ? stampBoilEpoch(frame, boil) : 0,
      moved: still ? null : placement,
      paintAt: recolours ? Math.min(recolours.to, Math.max(recolours.from, t)) : null,
      ownMarks: (!!recolours && changingAt(recolours, t)) || boil?.every === 1,
      ownPlacement: !!motion && changingAt(stampKeysSpan(motion.keys), t),
    };
  });
  const marks = groups.map(({ epoch, paintAt }) => `${epoch}${paintAt === null ? '' : `~${paintAt}`}`);
  const laid = groups.map(({ moved }, index) => `${marks[index]}${moved ? `@${moved.x},${moved.y},${moved.rotation},${moved.scale}` : ''}`);
  /** Each group with events that begin before `event`: laid by then, or partway through. A group with none draws nothing. */
  const reached = (event: number) => groupEvents.flatMap(({ first, end }, index) => (first < event && first < end ? [{ index, laid: end <= event }] : []));
  const worthSaving = (event: number) => reached(event).every(({ index, laid: isLaid }) => !groups[index].ownMarks && !(isLaid && groups[index].ownPlacement));
  const settled = stampSettledEventCount(events, t);
  const varyingFrom = groupEvents.find((_, index) => stampGroupVaries(painting.groups[index]))?.first ?? events.length;
  return {
    groups,
    settled,
    checkpointKey: (event) => reached(event).map(({ index, laid: isLaid }) => (isLaid ? laid[index] : marks[index])).join('|'),
    checkpointSaves: (from) => new Set([settled, Math.min(settled, varyingFrom)].filter((event) => event > from && worthSaving(event))),
  };
}
