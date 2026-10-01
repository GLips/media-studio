// stamp-frame-plan.ts: what a painting's frame at `t` draws, group by group (its marks, where it's laid, the warp
// bending it, its visibility, the time its paint reads), and the key a checkpoint saved partway through the frame is
// held under (stamp-paint-checkpoints.ts). What a checkpoint depends on is named here alone: the renderer saves and
// restores by this key, so a frame restores only a state it would have drawn itself.
//
// Each group is planned from its frame state (stamp-paint-frame-state.ts), its recipe's own merged in. Keys, built
// from values and the frame state's keys, decide what's shared: a frame held on twos restores the last save; new keys
// save afresh, bounded by the store's budget and LRU.

import type { StampGroupPlacement } from './stamp-group-motion.ts';
import { STAMP_WARP_CELL, type StampWarpMap } from './stamp-group-warp.ts';
import { stampLiveGroupProblem, stampPaintFrameStateAt, type StampGroupFrameState, type StampGroupLay, type StampGroupMarks, type StampPaintFrameState } from './stamp-paint-frame-state.ts';
import { stampSettledEventCount, type StampPaintEvent } from './stamp-paint-events.ts';
import { stampPassDeposits, type CompiledStampGroup, type CompiledStampPaint } from './stamp-paint-recipe-compile.ts';

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
 * A group as a frame draws it, its frame state resolved: `lay` null where it lies as painted; `paintAt` null for paint
 * that doesn't change. `layVaries`: laid apart from where it's painted (a lay, a warp, part visible), so the checkpoint
 * at its end holds it painted, not laid, which frames laying it otherwise share.
 */
export type StampGroupFrame = {
  group: CompiledStampGroup;
  marks: StampGroupMarks;
  lay: StampGroupLay | null;
  warp: { map: StampWarpMap; key: string; cell: number } | null;
  visibility: number;
  paintAt: number | null;
  layVaries: boolean;
};

export type StampFramePlan = {
  groups: readonly StampGroupFrame[];
  /** How many events are settled at the frame's time: the prefix a checkpoint may stand for. */
  settled: number;
  /**
   * The key a checkpoint after `event` events is held under: each group laid by then at its marks and lay, and a group
   * partway through (or at its end, its lay varying) at its marks: its layer isn't laid yet.
   */
  checkpointKey: (event: number) => string;
  /**
   * The events after which a frame starting from event `from` saves a checkpoint, each with whether it's partway
   * through a group (holding its layer): its settled prefix, the state before the first group with frame state, and
   * the first group whose lay varies painted but not laid, which frames laying it otherwise share.
   */
  checkpointSaves: (from: number) => ReadonlyMap<number, boolean>;
};

const hasEvents = ({ first, end }: StampGroupEvents) => first < end;

const isStill = ({ x, y, rotation, scale }: StampGroupPlacement) => x === 0 && y === 0 && rotation === 0 && scale === 1;

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
  return {
    group, marks, lay: moved, warp: warp ? { map: warp.map, key: warp.key, cell: warp.cell ?? STAMP_WARP_CELL } : null, visibility,
    paintAt: paintAt ?? null, layVaries: visibility > 0 && !!(moved || warp || visibility < 1),
  };
}

/**
 * The frame of `painting` at `t` seconds into its scene, each group in its recipe's own state with `given` over it
 * (stampPaintFrameStateAt). Throws on state for a group the painting doesn't have, or state it can't draw.
 */
export function stampFramePlan(
  painting: CompiledStampPaint, groupEvents: readonly StampGroupEvents[], events: readonly StampPaintEvent[], t: number, given?: StampPaintFrameState,
): StampFramePlan {
  const state = stampPaintFrameStateAt(painting, t, given);
  const groups = painting.groups.map((group) => stampGroupFrame(group, state.get(group.id) ?? {}));
  // A hidden group draws nothing, whatever its marks or lay.
  const marks = groups.map(({ marks: drawn, paintAt, visibility }) => (visibility === 0 ? 'hidden'
    : `${drawn.kind === 'live' ? `*${JSON.stringify(drawn.key)}` : drawn.epoch}${paintAt === null ? '' : `~${paintAt}`}`));
  const laid = groups.map(({ lay, warp, visibility }, index) => (visibility === 0 ? marks[index] : marks[index]
    + (lay ? `@${lay.placement.x},${lay.placement.y},${lay.placement.rotation},${lay.placement.scale}:${lay.pivot.x},${lay.pivot.y}` : '')
    + (warp ? `^${warp.cell}${JSON.stringify(warp.key)}` : '')
    + (visibility < 1 ? `%${visibility}` : '')));
  /**
   * Each group with events that begin before `event`: laid by then, or partway through. A group whose lay varies
   * stands at its last event painted but not laid. A group with no events draws nothing.
   */
  const reached = (event: number) => groupEvents.flatMap(({ first, end }, index) => (first < event && first < end ? [{ index, laid: end < event || (end === event && !groups[index].layVaries), painted: end === event }] : []));
  /** Whether a checkpoint after `event` events holds a group's layer: partway through it, or at its end unlaid. */
  const inGroup = (event: number) => reached(event).some(({ laid: isLaid }) => !isLaid);
  const settled = stampSettledEventCount(events, t);
  const varyingFrom = groupEvents.find((_, index) => state.has(painting.groups[index].id))?.first ?? events.length;
  const firstVaryingLay = groupEvents.find((span, index) => hasEvents(span) && groups[index].layVaries);
  const saves = [settled, Math.min(settled, varyingFrom), ...(firstVaryingLay && firstVaryingLay.end <= settled ? [firstVaryingLay.end] : [])];
  return {
    groups,
    settled,
    checkpointKey: (event) => reached(event).map(({ index, laid: isLaid, painted }) => (isLaid ? laid[index] : `${marks[index]}${painted ? '#painted' : ''}`)).join('|'),
    checkpointSaves: (from) => new Map(saves.filter((event) => event > from).map((event) => [event, inGroup(event)])),
  };
}
