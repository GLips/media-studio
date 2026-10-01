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
import {
  stampLiveGroupProblem, stampPaintFrameStateAt, type StampGroupFrameState, type StampGroupGlow, type StampGroupLay, type StampGroupMarks, type StampPaintFrameState,
} from './stamp-paint-frame-state.ts';
import { stampSettledEventCount, type StampPaintEvent } from './stamp-paint-events.ts';
import type { StampOutsideFrameState, StampOutsideLayerPlace } from './stamp-outside-layer.ts';
import { stampPassDeposits, type CompiledStampGroup, type CompiledStampPaint } from './stamp-paint-recipe.ts';

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
 * that doesn't change. `layVaries`: laid otherwise than as painted (moved, warped, part visible, defocused, glowing),
 * so the checkpoint at its end holds it painted, not laid, which frames laying it otherwise share.
 */
export type StampGroupFrame = {
  /** What its painted layer depends on besides how much is shown: its marks and paint's time; 'hidden' drawn not at all. */
  paintKey: string;
  group: CompiledStampGroup;
  marks: StampGroupMarks;
  lay: StampGroupLay | null;
  warp: { map: StampWarpMap; key: string; cell: number } | null;
  visibility: number;
  paintAt: number | null;
  /** Its defocus, gaussian sigma in stage px; 0 sharp. */
  blur: number;
  /** The light it gives off; null for none, as a glow of amount 0 is. */
  glow: StampGroupGlow | null;
  layVaries: boolean;
};

/**
 * An outside layer as a frame lays it (stamp-outside-layer.ts): before the events from `event` on, so a checkpoint
 * after `event` events stands before it and one after more holds it, under `key` (its content and how it's laid).
 */
export type StampOutsideLayerFrame = StampOutsideLayerPlace & { event: number; key: string; visibility: number; blur: number; glow: StampGroupGlow | null };

/** The outside layers a painting is drawn with: where each lies, and each one's state this frame. */
export type StampOutsideLayersAt = { places: readonly StampOutsideLayerPlace[]; state: StampOutsideFrameState };

export type StampFramePlan = {
  groups: readonly StampGroupFrame[];
  /** Its outside layers, in the order they're laid. */
  outside: readonly StampOutsideLayerFrame[];
  /** How many events are settled at the frame's time: the prefix a checkpoint may stand for. */
  settled: number;
  /**
   * The key a checkpoint after `event` events is held under: each group laid by then at its marks and lay, and a group
   * partway through (or at its end, its lay varying) at its marks: its layer isn't laid yet; and each outside layer
   * laid before `event`, at its key.
   */
  checkpointKey: (event: number) => string;
  /**
   * The events after which a frame starting from event `from` saves a checkpoint, each with whether it's partway
   * through a group (holding its layer): its settled prefix, the state before the first group with frame state or
   * outside layer, and the first group whose lay varies painted but not laid, which frames laying it otherwise share.
   */
  checkpointSaves: (from: number) => ReadonlyMap<number, boolean>;
};

const hasEvents = ({ first, end }: StampGroupEvents) => first < end;

const isStill = ({ x, y, rotation, scale }: StampGroupPlacement) => x === 0 && y === 0 && rotation === 0 && scale === 1;

/** `id`'s defocus and glow as drawn, checked: no blur is 0, and no glow (or one of amount 0) null, so equal looks key equal. */
function stampLayLight(id: string, { blur = 0, glow }: Pick<StampGroupFrameState, 'blur' | 'glow'>): { blur: number; glow: StampGroupGlow | null } {
  if (!(Number.isFinite(blur) && blur >= 0)) throw new Error(`stamp paint: ${id}'s blur is ${blur}; a defocus is a sigma of 0 px or more`);
  if (glow) {
    const { amount, radius, threshold } = glow;
    if (!(Number.isFinite(amount) && amount >= 0 && Number.isFinite(radius) && radius > 0 && threshold >= 0 && threshold <= 1)) {
      throw new Error(`stamp paint: ${id}'s glow ${JSON.stringify(glow)} needs an amount from 0, a radius past 0 px and a threshold within 0..1`);
    }
  }
  return { blur, glow: glow && glow.amount > 0 ? { amount: glow.amount, radius: glow.radius, threshold: glow.threshold } : null };
}

/** The part of a laid key its defocus and glow write: empty for neither. */
const layLightKey = ({ blur, glow }: { blur: number; glow: StampGroupGlow | null }) => `${blur ? `~blur${blur}` : ''}${glow ? `~glow${glow.amount},${glow.radius},${glow.threshold}` : ''}`;

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
  const { blur, glow } = stampLayLight(group.id, state);
  // A hidden group draws nothing, whatever its marks or lay.
  const paintKey = visibility === 0 ? 'hidden' : `${marks.kind === 'live' ? `*${JSON.stringify(marks.key)}` : marks.epoch}${paintAt === undefined ? '' : `~${paintAt}`}`;
  return {
    paintKey, group, marks, lay: moved, warp: warp ? { map: warp.map, key: warp.key, cell: warp.cell ?? STAMP_WARP_CELL } : null, visibility,
    paintAt: paintAt ?? null, blur, glow, layVaries: visibility > 0 && !!(moved || warp || visibility < 1 || blur || glow),
  };
}

/** Each outside layer's frame, checked: every declared layer given a state, and no state for one that isn't. */
function stampOutsideLayerFrames(groupEvents: readonly StampGroupEvents[], eventCount: number, { places, state }: StampOutsideLayersAt): StampOutsideLayerFrame[] {
  const unknown = [...state.keys()].filter((id) => !places.some((place) => place.id === id));
  if (unknown.length) throw new Error(`stamp paint: outside layer state for ${unknown.join(', ')}, which the painting has no outside layer of`);
  return places.map((place) => {
    const given = state.get(place.id);
    if (!given) throw new Error(`stamp paint: outside layer ${place.id} has no state this frame; its content's key names its pixels, each frame`);
    const { content, visibility = 1 } = given;
    if (!(visibility >= 0 && visibility <= 1)) throw new Error(`stamp paint: outside layer ${place.id}'s visibility is ${visibility}, outside 0..1`);
    // Built here, not left to the caller: whatever changes what's laid is in it.
    const light = stampLayLight(place.id, given);
    const key = visibility === 0 ? 'hidden' : `${JSON.stringify(content)}${visibility < 1 ? `%${visibility}` : ''}${layLightKey(light)}`;
    return { ...place, event: groupEvents[place.groupIndex]?.first ?? eventCount, key, visibility, ...light };
  });
}

/**
 * The frame of `painting` at `t` seconds into its scene, each group in its recipe's own state with `given` over it
 * (stampPaintFrameStateAt), and each of `outside`'s layers in its state. Throws on state for a group or outside layer
 * the painting doesn't have, state it can't draw, or an outside layer given none.
 */
export function stampFramePlan(
  painting: CompiledStampPaint, groupEvents: readonly StampGroupEvents[], events: readonly StampPaintEvent[], t: number, given?: StampPaintFrameState,
  outside: StampOutsideLayersAt = { places: [], state: new Map() },
): StampFramePlan {
  const state = stampPaintFrameStateAt(painting, t, given);
  const groups = painting.groups.map((group) => stampGroupFrame(group, state.get(group.id) ?? {}));
  const outsideLayers = stampOutsideLayerFrames(groupEvents, events.length, outside);
  const marks = groups.map(({ paintKey }) => paintKey);
  const laid = groups.map((group, index) => (group.visibility === 0 ? marks[index] : marks[index]
    + (group.lay ? `@${group.lay.placement.x},${group.lay.placement.y},${group.lay.placement.rotation},${group.lay.placement.scale}:${group.lay.pivot.x},${group.lay.pivot.y}` : '')
    + (group.warp ? `^${group.warp.cell}${JSON.stringify(group.warp.key)}` : '')
    + (group.visibility < 1 ? `%${group.visibility}` : '') + layLightKey(group)));
  /**
   * Each group with events that begin before `event`: laid by then, or partway through. A group whose lay varies
   * stands at its last event painted but not laid. A group with no events draws nothing.
   */
  const reached = (event: number) => groupEvents.flatMap(({ first, end }, index) => (first < event && first < end ? [{ index, laid: end < event || (end === event && !groups[index].layVaries), painted: end === event }] : []));
  // An outside layer at `event` is laid after a checkpoint there is saved, so only one before it holds it.
  const outsideBefore = (event: number) => outsideLayers.filter((layer) => layer.event < event).map(({ id, key }) => `outside ${JSON.stringify(id)}=${key}`);
  /** Whether a checkpoint after `event` events holds a group's layer: partway through it, or at its end unlaid. */
  const inGroup = (event: number) => reached(event).some(({ laid: isLaid }) => !isLaid);
  const settled = stampSettledEventCount(events, t);
  // Every outside layer varies: what's under it is worth a checkpoint.
  const varyingFrom = Math.min(groupEvents.find((_, index) => state.has(painting.groups[index].id))?.first ?? events.length, ...outsideLayers.map((layer) => layer.event));
  const firstVaryingLay = groupEvents.find((span, index) => hasEvents(span) && groups[index].layVaries);
  const saves = [settled, Math.min(settled, varyingFrom), ...(firstVaryingLay && firstVaryingLay.end <= settled ? [firstVaryingLay.end] : [])];
  return {
    groups,
    outside: outsideLayers,
    settled,
    checkpointKey: (event) => [
      ...reached(event).map(({ index, laid: isLaid, painted }) => (isLaid ? laid[index] : `${marks[index]}${painted ? '#painted' : ''}`)), ...outsideBefore(event),
    ].join('|'),
    checkpointSaves: (from) => new Map(saves.filter((event) => event > from).map((event) => [event, inGroup(event)])),
  };
}
