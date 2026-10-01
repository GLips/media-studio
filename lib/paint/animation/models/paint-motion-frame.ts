// paint-motion-frame.ts: a compiled motion evaluated at scene time `t` into each group's frame state, purely.
//
// Composition, per level as a rigger builds it: a rest point goes through its node's boil wobble, its node's own bend
// (pins, then flutter, then sway), its node's placement, then its parent's bend, its parent's placement, and so up.
// The steps up to the outermost bend become the group's warp; the placements after it, rigid, its lay, then a
// plane's camera step (paint-camera.ts).
//
// A live node's own pins are its pose, handed to its poser, never a warp; what comes after them (its sway or flutter,
// its ancestors' bends and placements) reaches its re-placed marks as their warp and lay.

import type { StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import { stampLiveGroupProblem, type StampGroupFrameState, type StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { CompiledStampGroup } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintCameraFrameStateAt } from './paint-camera.ts';
import { paintBoilEpochAt, paintLanePlayAt, paintNodeTimeAt, paintPlayClipTimeAt, sceneSeconds, type SceneSeconds } from './paint-clock.ts';
import {
  paintPlacementIsRest, paintPlacementRounded, paintPxRounded, paintRatioSteps, paintWarpChainKey, paintWarpChainMap,
  type PaintDeform, type PaintPinMoved, type PaintWarpChain,
} from './paint-deform.ts';
import { paintKeyNumbers } from './paint-pins.ts';
import { PAINT_LIVE_POSES_KEPT, type CompiledPaintNode, type PaintMotion } from './paint-motion-compile.ts';
import { paintFlutterSpreadAt, paintPinClipMoveAt, paintPlaceClipAt, paintSwayAngleAt } from './paint-motion-clips.ts';
import { PAINT_SIMILARITY_IDENTITY, paintPlacementOfSimilarity, paintSimilarityAfter, paintSimilarityOf } from './paint-similarity.ts';

/** Each of `node`'s pins moved at `t`, rounded; pins at rest left out. */
function pinsMovedAt(motion: PaintMotion, node: CompiledPaintNode, t: SceneSeconds): PaintPinMoved[] {
  const time = paintNodeTimeAt(node.clock, t, motion.animationFps);
  return [...node.pins].flatMap(([name, { pin, lane }]) => {
    const play = paintLanePlayAt(lane, time);
    if (!play) return [];
    const move = paintPlacementRounded(paintPinClipMoveAt(play.clip, name, paintPlayClipTimeAt(play.clock, t, motion.animationFps)));
    return paintPlacementIsRest(move) ? [] : [{ name, pin, move }];
  });
}

/** `node`'s own bend at `t` as data, its pins left out for a live node's own level; empty when nothing bends. */
function ownDeformsAt(motion: PaintMotion, node: CompiledPaintNode, t: SceneSeconds, withPins: boolean): PaintDeform[] {
  const fps = motion.animationFps, time = paintNodeTimeAt(node.clock, t, fps), owner = node.id;
  const deforms: PaintDeform[] = [];
  const moves = withPins ? pinsMovedAt(motion, node, t) : [];
  if (moves.length) deforms.push({ owner, kind: 'pins', moves });
  const flutter = paintLanePlayAt(node.flutter, time);
  if (flutter) {
    const spreadSteps = paintRatioSteps(paintFlutterSpreadAt(flutter.clip, node.phase, paintPlayClipTimeAt(flutter.clock, t, fps)));
    if (spreadSteps !== paintRatioSteps(1)) deforms.push({ owner, kind: 'flutter', origin: flutter.clip.at, direction: flutter.clip.direction, spreadSteps });
  }
  const sway = paintLanePlayAt(node.sway, time);
  if (sway) {
    const angleSteps = paintRatioSteps(paintSwayAngleAt(sway.clip, node.phase, paintPlayClipTimeAt(sway.clock, t, fps)));
    const { root, direction, length } = sway.clip;
    if (angleSteps !== 0) deforms.push({ owner, kind: 'sway', root, direction, length, angleSteps });
  }
  return deforms;
}

/** `node`'s own placement at `t` about its pivot, rounded; null at rest or when nothing places it. */
function ownPlacementAt(motion: PaintMotion, node: CompiledPaintNode, t: SceneSeconds): PaintDeform | null {
  const play = paintLanePlayAt(node.place, paintNodeTimeAt(node.clock, t, motion.animationFps));
  if (!play) return null;
  const placement = paintPlacementRounded(paintPlaceClipAt(play.clip, paintPlayClipTimeAt(play.clock, t, motion.animationFps)));
  return paintPlacementIsRest(placement) ? null : { owner: node.id, kind: 'place', placement, pivot: node.pivot };
}

/** `node`'s boil epoch at `t`: 0 unless it boils and its group's reveal has ended, on its own time. */
function epochAt(motion: PaintMotion, node: CompiledPaintNode, t: SceneSeconds): number {
  if (node.marks.kind !== 'wobble' && node.marks.kind !== 'reseed') return 0;
  return paintBoilEpochAt(paintNodeTimeAt(node.clock, t, motion.animationFps), node.revealEnd, node.marks.every, motion.animationFps);
}

/** Rigid placements, innermost first, as one placement about `pivot`: one already about it is handed on as it is. */
function composedPlacement(places: readonly Extract<PaintDeform, { kind: 'place' }>[], pivot: StampPoint): StampGroupPlacement {
  if (places.length === 1 && places[0].pivot.x === pivot.x && places[0].pivot.y === pivot.y) return places[0].placement;
  return paintPlacementOfSimilarity(places.reduce((inner, place) => paintSimilarityAfter(paintSimilarityOf(place.placement, place.pivot), inner), PAINT_SIMILARITY_IDENTITY), pivot);
}

/** Where `node`'s paint goes at `t`: the warp chain (up to its outermost bend) and the rigid lay after it, if any. */
export function paintNodeWarpAt(motion: PaintMotion, node: CompiledPaintNode, t: SceneSeconds): { warp: PaintWarpChain; lay: StampGroupPlacement | null } {
  const epoch = node.marks.kind === 'wobble' ? epochAt(motion, node, t) : 0;
  const steps: PaintDeform[] = node.marks.kind === 'wobble' && epoch > 0 ? [{ owner: node.id, kind: 'wobble', seed: node.id, epoch, wobble: node.marks.wobble }] : [];
  for (const [depth, id] of node.levels.entries()) {
    const level = motion.nodes.get(id)!;
    steps.push(...ownDeformsAt(motion, level, t, depth > 0 || node.marks.kind !== 'live'));
    const place = ownPlacementAt(motion, level, t);
    if (place) steps.push(place);
  }
  const outermostBend = steps.findLastIndex((step) => step.kind !== 'place');
  const places = steps.slice(outermostBend + 1).flatMap((step) => (step.kind === 'place' ? [step] : []));
  return { warp: steps.slice(0, outermostBend + 1), lay: places.length ? composedPlacement(places, node.pivot) : null };
}

/** A live node's marks at `t` from its poser, kept by pose key; null at rest, where it draws as written. */
function liveMarksAt(motion: PaintMotion, node: CompiledPaintNode, t: SceneSeconds): { marks: CompiledStampGroup; key: string } | null {
  if (node.marks.kind !== 'live') return null;
  const moves = pinsMovedAt(motion, node, t);
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
function nodeFrameAt(motion: PaintMotion, node: CompiledPaintNode, t: SceneSeconds): StampGroupFrameState {
  const { warp, lay } = paintNodeWarpAt(motion, node, t), live = liveMarksAt(motion, node, t);
  const epoch = node.marks.kind === 'reseed' ? epochAt(motion, node, t) : 0;
  const laid = lay && !paintPlacementIsRest(lay) ? lay : null;
  return {
    ...(laid && { lay: { placement: laid, pivot: node.pivot } }),
    // A glow's radius is in rest px: it grows with the group's lay, and the camera step grows it on.
    ...(node.glow && { glow: { ...node.glow, radius: paintPxRounded(node.glow.radius * (laid?.scale ?? 1)) } }),
    ...(warp.length && { warp: { map: paintWarpChainMap(warp), key: paintWarpChainKey(warp) } }),
    ...(live ? { marks: { kind: 'live', ...live } } : node.group.boil && { marks: { kind: 'written', epoch } }),
  };
}

/**
 * Every group's frame state at scene time `t` that differs from as painted (moved, bent, re-placed, glowing, or laid
 * or blurred by the camera): a pure function of the motion and `t`.
 */
export function paintMotionFrameAt(motion: PaintMotion, t: number): StampPaintFrameState {
  const { last } = motion.remembered;
  if (last?.t === t) return last.state;
  const own = new Map<string, StampGroupFrameState>();
  for (const node of motion.nodes.values()) {
    const groupState = nodeFrameAt(motion, node, sceneSeconds(t));
    if (groupState.lay || groupState.warp || groupState.marks || groupState.glow) own.set(node.id, groupState);
  }
  const state = motion.camera ? paintCameraFrameStateAt(motion.camera, own, t) : own;
  motion.remembered.last = { t, state };
  return state;
}
