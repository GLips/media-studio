// paint-motion-frame.ts: a compiled motion evaluated at scene time `t` into each group's frame state, purely.
//
// Composition, per level as a rigger builds it: a rest point goes through its node's boil wobble, its node's own bend
// (pins, then flutter, then sway), its node's placement, then its parent's bend, its parent's placement, and so up.
// The steps up to the outermost bend become the group's warp; the placements after it, rigid, its lay. The camera
// never reaches a lay: it places the plane the group is on (paint-camera.ts).
//
// A live node's own pins are its pose, handed to its poser, never a warp; what follows them reaches its marks as
// warp and lay.

import type { StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import { stampLiveGroupProblem, type PaintMoment, type StampGroupFrameState, type StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { CompiledStampGroup } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintBoilEpochAt, paintLaneClipAt, paintNodeTimeAt, sceneSeconds } from './paint-clock.ts';
import {
  paintPlacementIsRest, paintPlacementRounded, paintRatioSteps, paintWarpChainKey, paintWarpChainMap,
  type PaintDeform, type PaintPinMoved, type PaintWarpChain,
} from './paint-deform.ts';
import { paintKeyNumbers } from './paint-pins.ts';
import { PAINT_LIVE_POSES_KEPT, type CompiledPaintLevel, type CompiledPaintNode, type PaintMotion } from './paint-motion-compile.ts';
import { paintFlutterSpreadAt, paintPinClipMoveAt, paintPlaceClipAt, paintSwayAngleAt } from './paint-motion-clips.ts';
import { PAINT_SIMILARITY_IDENTITY, paintPlacementOfSimilarity, paintSimilarityAfter, paintSimilarityOf } from './paint-similarity.ts';

/** Each of `level`'s pins moved at `t`, rounded; pins at rest left out. */
function pinsMovedAt(level: CompiledPaintLevel, t: PaintMoment, animationFps: number): PaintPinMoved[] {
  return [...level.pins].flatMap(([name, { pin, lane }]) => {
    const playing = paintLaneClipAt(lane, t, animationFps);
    if (!playing) return [];
    const move = paintPlacementRounded(paintPinClipMoveAt(playing.play.clip, name, playing.time));
    return paintPlacementIsRest(move) ? [] : [{ name, pin, move }];
  });
}

/** `node`'s own bend at `t` as data, its pins left out for a live node's own level; empty when nothing bends. */
export function paintLevelDeformsAt(node: CompiledPaintLevel, t: PaintMoment, fps: number, withPins: boolean): PaintDeform[] {
  const owner = node.id;
  const deforms: PaintDeform[] = [];
  const moves = withPins ? pinsMovedAt(node, t, fps) : [];
  if (moves.length) deforms.push({ owner, kind: 'pins', moves });
  const flutter = paintLaneClipAt(node.flutter, t, fps);
  if (flutter) {
    const { clip } = flutter.play, spreadSteps = paintRatioSteps(paintFlutterSpreadAt(clip, node.phase, flutter.time));
    if (spreadSteps !== paintRatioSteps(1)) deforms.push({ owner, kind: 'flutter', origin: clip.at, direction: clip.direction, spreadSteps });
  }
  const sway = paintLaneClipAt(node.sway, t, fps);
  if (sway) {
    const angleSteps = paintRatioSteps(paintSwayAngleAt(sway.play.clip, node.phase, sway.time));
    const { root, direction, length } = sway.play.clip;
    if (angleSteps !== 0) deforms.push({ owner, kind: 'sway', root, direction, length, angleSteps });
  }
  return deforms;
}

/** `node`'s own placement at `t` about its pivot, rounded; null at rest or when nothing places it. */
export function paintLevelPlacementAt(node: CompiledPaintLevel, t: PaintMoment, fps: number): Extract<PaintDeform, { kind: 'place' }> | null {
  const playing = paintLaneClipAt(node.place, t, fps);
  if (!playing) return null;
  const placement = paintPlacementRounded(paintPlaceClipAt(playing.play.clip, playing.time));
  return paintPlacementIsRest(placement) ? null : { owner: node.id, kind: 'place', placement, pivot: node.pivot };
}

/** `node`'s boil epoch at `t`, on its own time: 0 unless it boils. A boil is held through its frame, as a hold is. */
function epochAt(motion: PaintMotion, node: CompiledPaintNode, t: PaintMoment): number {
  if (node.marks.kind !== 'wobble' && node.marks.kind !== 'reseed') return 0;
  return paintBoilEpochAt(sceneSeconds(paintNodeTimeAt(node.clock, t, motion.animationFps).frame), node.marks.every, motion.animationFps);
}

/** Rigid placements, innermost first, as one placement about `pivot`: one already about it is handed on as it is. */
function composedPlacement(places: readonly Extract<PaintDeform, { kind: 'place' }>[], pivot: StampPoint): StampGroupPlacement {
  if (places.length === 1 && places[0].pivot.x === pivot.x && places[0].pivot.y === pivot.y) return places[0].placement;
  return paintPlacementOfSimilarity(places.reduce((inner, place) => paintSimilarityAfter(paintSimilarityOf(place.placement, place.pivot), inner), PAINT_SIMILARITY_IDENTITY), pivot);
}

/** Where `node`'s paint goes at `t`: the warp chain (up to its outermost bend) and the rigid lay after it, if any. */
export function paintNodeWarpAt(motion: PaintMotion, node: CompiledPaintNode, t: PaintMoment): { warp: PaintWarpChain; lay: StampGroupPlacement | null } {
  const epoch = node.marks.kind === 'wobble' ? epochAt(motion, node, t) : 0;
  const steps: PaintDeform[] = node.marks.kind === 'wobble' && epoch > 0 ? [{ owner: node.id, kind: 'wobble', seed: node.id, epoch, wobble: node.marks.wobble }] : [];
  for (const [depth, id] of node.levels.entries()) {
    const level = motion.nodes.get(id)!;
    steps.push(...paintLevelDeformsAt(level, t, motion.animationFps, depth > 0 || node.marks.kind !== 'live'));
    const place = paintLevelPlacementAt(level, t, motion.animationFps);
    if (place) steps.push(place);
  }
  const outermostBend = steps.findLastIndex((step) => step.kind !== 'place');
  const places = steps.slice(outermostBend + 1).flatMap((step) => (step.kind === 'place' ? [step] : []));
  return { warp: steps.slice(0, outermostBend + 1), lay: places.length ? composedPlacement(places, node.pivot) : null };
}

/** A live node's marks at `t` from its poser, kept by pose key; null at rest, where it draws as written. */
function liveMarksAt(motion: PaintMotion, node: CompiledPaintNode, t: PaintMoment): { marks: CompiledStampGroup; key: string } | null {
  if (node.marks.kind !== 'live') return null;
  const moves = pinsMovedAt(node, t, motion.animationFps);
  if (!moves.length) return null;
  // Its own pins are fixed for the motion's life, so their names and moves name the pose.
  const key = `${node.id}{${moves.map(({ name, move }) => `${name}=${paintKeyNumbers(move.x, move.y, move.rotation, move.scale)}`).join(';')}}`;
  const { kept, poser } = node.marks;
  let marks = kept.get(key);
  if (marks) kept.delete(key);
  else {
    marks = poser({ pins: Object.fromEntries(moves.map(({ name, move }) => [name, move])), key });
    const problem = stampLiveGroupProblem(node.group, marks);
    if (problem) throw new Error(`paint motion: ${node.id}'s poser can't stand in for its group: ${problem}`);
  }
  kept.set(key, marks);
  if (kept.size > PAINT_LIVE_POSES_KEPT) kept.delete(kept.keys().next().value!);
  return { marks, key };
}

/** `node`'s group's frame at `t`. */
function nodeFrameAt(motion: PaintMotion, node: CompiledPaintNode, t: PaintMoment): StampGroupFrameState {
  const { warp, lay } = paintNodeWarpAt(motion, node, t), live = liveMarksAt(motion, node, t);
  const epoch = node.marks.kind === 'reseed' ? epochAt(motion, node, t) : 0;
  const laid = lay && !paintPlacementIsRest(lay) ? lay : null;
  return {
    ...(laid && { lay: { placement: laid, pivot: node.pivot } }),
    ...(node.glow && { glow: node.glow }),
    ...(warp.length && { warp: { map: paintWarpChainMap(warp), key: paintWarpChainKey(warp) } }),
    ...(live ? { marks: { kind: 'live', ...live } } : node.group.boil && { marks: { kind: 'written', epoch } }),
  };
}

/**
 * Every group's frame state at `moment` that differs from as painted (moved, bent, re-placed or glowing): a pure
 * function of the motion and the moment.
 */
export function paintMotionFrameAt(motion: PaintMotion, moment: PaintMoment): StampPaintFrameState {
  const { last } = motion.remembered, { at, frame } = moment;
  if (last?.at === at && last.frame === frame) return last.state;
  const own = new Map<string, StampGroupFrameState>();
  for (const node of motion.nodes.values()) {
    const groupState = nodeFrameAt(motion, node, moment);
    if (groupState.lay || groupState.warp || groupState.marks || groupState.glow) own.set(node.id, groupState);
  }
  motion.remembered.last = { at, frame, state: own };
  return own;
}
