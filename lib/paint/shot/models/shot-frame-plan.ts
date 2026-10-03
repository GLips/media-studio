// shot-frame-plan.ts: what a shot's painted plane is at one moment, purely (ENGINE 6.2, 6.3): the selection its
// source gives at its source clock's moment, the node poses its marks are solved under, the boil epochs reseeding its
// layers, where its sheets lie, how visible its occurrences are, and its rigs' poses. The renderer reads these and
// draws; none of it touches a device.
//
// A frame's marks are posed at the frame's own moment; where its sheets lie, and a pieces rig's pose, are read at each
// exposure's or shutter end's. A node's map is its wobble, its bends and its placement about its pivot, in its parent's
// frame; its parent is implied (shot-motion.ts).

import { paintBoilEpochAt, paintNodeTimeAt, sceneSeconds } from '#lib/paint/animation/models/paint-clock.ts';
import { paintWarpChainKey, paintWarpChainMap, type PaintDeform } from '#lib/paint/animation/models/paint-deform.ts';
import { paintLevelDeformsAt, paintLevelPlacementAt } from '#lib/paint/animation/models/paint-motion-frame.ts';
import { PAINT_SIMILARITY_IDENTITY, paintSimilarityAfter, paintSimilarityOf, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import { paintingPoseAfter, paintingSimilarityPose, type PaintingNodePose } from '#lib/paint/document/models/painting-pose.ts';
import { paintingProblemsError, paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane } from './shot-compile.ts';
import type { CompiledShotMotion, CompiledShotNode } from './shot-motion.ts';
import { shotPresentationAt, type OccurrenceKey, type RigPartPose } from './shot-props.ts';
import { shotRigPoseProblem, type CompiledShotRig } from './shot-rigs.ts';
import { paintedSourceProblems, paintedSourceSelection, shotPlaneOccurrences } from './shot-selection.ts';
import { shotVisibilityProblem } from './shot-visibility.ts';

/** `node`'s boil epoch at `t`, on its own time: 0 unless its marks boil. A boil holds through its frame, as a hold does. */
export function shotNodeEpochAt(node: CompiledShotNode, t: PaintMoment, animationFps: number): number {
  if (node.marks.kind === 'stuck') return 0;
  return paintBoilEpochAt(sceneSeconds(paintNodeTimeAt(node.clock, t, animationFps).frame), node.marks.every, animationFps);
}

/**
 * `node`'s own map at `t` in its parent's frame: its wobble (its rest space boiled, before anything bends it), its
 * pins, flutter and sway, then its placement about its pivot. A similarity while nothing bends; the identity at rest.
 */
export function shotNodePoseAt(node: CompiledShotNode, t: PaintMoment, animationFps: number): PaintingNodePose {
  const epoch = node.marks.kind === 'wobble' ? shotNodeEpochAt(node, t, animationFps) : 0;
  const steps: PaintDeform[] = node.marks.kind === 'wobble' && epoch > 0 ? [{ owner: node.id, kind: 'wobble', seed: node.id, epoch, wobble: node.marks.wobble }] : [];
  steps.push(...paintLevelDeformsAt(node, t, animationFps, true));
  const place = paintLevelPlacementAt(node, t, animationFps);
  if (place) steps.push(place);
  if (steps.every((step) => step.kind === 'place')) {
    return paintingSimilarityPose(steps.reduce((inner, step) => (step.kind === 'place' ? paintSimilarityAfter(paintSimilarityOf(step.placement, step.pivot), inner) : inner), PAINT_SIMILARITY_IDENTITY));
  }
  return { kind: 'warp', map: paintWarpChainMap(steps), text: paintWarpChainKey(steps) };
}

/** The moment plane `plane`'s presentation reads at frame moment `t`: through its own clock. */
export const shotPlaneMomentAt = (motion: CompiledShotMotion, plane: string, t: PaintMoment): PaintMoment =>
  paintNodeTimeAt(motion.planeClocks.get(plane) ?? [], t, motion.animationFps);

/** Plane `plane`'s lay at `t`, document px to plane px: a callback's read at its presentation moment; the identity unlaid. */
export function shotPlaneLayAt(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, t: PaintMoment): PaintSimilarity {
  const lay = plane.lay.kind === 'moving' ? plane.lay.lay(shotPlaneMomentAt(motion, plane.id, t)) : plane.lay.lay;
  return lay ? paintSimilarityOf(lay.placement, lay.pivot) : PAINT_SIMILARITY_IDENTITY;
}

/** Where plane `plane` lays its root sheet at `t`: its node's map, then its lay. Document px to plane px. */
export function shotPlanePlaceAt(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, t: PaintMoment): PaintingNodePose {
  const node = motion.nodes.get(plane.id), own = node ? shotNodePoseAt(node, t, motion.animationFps) : paintingSimilarityPose(PAINT_SIMILARITY_IDENTITY);
  return paintingPoseAfter(paintingSimilarityPose(shotPlaneLayAt(plane, motion, t)), own);
}

/**
 * The selection plane `plane`'s source gives at frame moment `t`, read at its source clock's moment. Throws on a
 * callback's selection with problems, on a dissolve between its ends (ENGINE slice 6), and on a source whose
 * occurrences aren't its first evaluation's: motion, rigs and visibility were checked against those.
 */
export function shotPlaneSelectionAt(plane: CompiledShotPaintedPlane, t: PaintMoment, animationFps: number): LayerSelection {
  const moment = paintNodeTimeAt(plane.sourceClock, t, animationFps), source = shotPresentationAt(plane.source, moment);
  // A constant source was checked as the shot loaded; a callback's answer is checked each time it's read.
  const problems = typeof plane.source === 'function' ? paintedSourceProblems(plane.id, source) : [];
  if (problems.length) throw paintingProblemsError(`shot plane ${plane.id}'s source at ${moment.at} s`, problems);
  const drawn = paintedSourceSelection(source);
  if ('problem' in drawn) throw new Error(`shot: plane ${plane.id}'s source at ${moment.at} s ${drawn.problem}`);
  const keys = shotPlaneOccurrences(plane.id, source).map(({ key }) => key), first = plane.occurrences.map(({ key }) => key);
  if (keys.length !== first.length || keys.some((key, i) => key !== first[i])) {
    throw new Error(`shot: plane ${plane.id}'s source at ${moment.at} s shows ${keys.join(', ')}, and its first showed ${first.join(', ')}: a source keeps the occurrences its motion, rigs and visibility name`);
  }
  return drawn.selection;
}

/** The node maps of plane `plane`'s occurrences at `t`, by document key: each occurrence's own node, its plane's left out. */
export function shotOccurrencePosesAt(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, t: PaintMoment): Map<NodeKey, PaintingNodePose> {
  const poses = new Map<NodeKey, PaintingNodePose>();
  for (const { key, node } of plane.occurrences) {
    const level = motion.nodes.get(key);
    if (level) poses.set(node, shotNodePoseAt(level, t, motion.animationFps));
  }
  return poses;
}

/**
 * The boil epochs reseeding plane `plane`'s layers at `t`, by document key (compilePaintingSelection's `reseed`): each
 * reseeding occurrence node's; its plane's node's over every key `selection` names, where an inner one says nothing.
 */
export function shotPlaneReseedAt(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, selection: LayerSelection, t: PaintMoment): Map<NodeKey, number> {
  const reseed = new Map<NodeKey, number>(), fps = motion.animationFps;
  for (const { key, node } of plane.occurrences) {
    const level = motion.nodes.get(key);
    if (level?.marks.kind === 'reseed') reseed.set(node, shotNodeEpochAt(level, t, fps));
  }
  const planeNode = motion.nodes.get(plane.id);
  if (planeNode?.marks.kind === 'reseed') {
    const epoch = shotNodeEpochAt(planeNode, t, fps);
    for (const key of selection.layers) if (!reseed.has(key)) reseed.set(key, epoch);
  }
  return reseed;
}

/**
 * How visible `key` (a plane or an occurrence on `plane`) is at `t`, read at its plane's presentation moment: 1 unless
 * the shot says. Throws on a callback's value outside 0..1.
 */
export function shotVisibilityAt(shot: CompiledPaintedShot, plane: string, key: OccurrenceKey, t: PaintMoment): number {
  const value = shot.visibility.get(key);
  if (value === undefined) return 1;
  const moment = shotPlaneMomentAt(shot.motion, plane, t), visibility = shotPresentationAt(value, moment), problem = shotVisibilityProblem(key, visibility, moment.at);
  if (problem) throw new Error(`shot: ${paintingProblemText(problem)}`);
  return visibility;
}

/**
 * Rig `rig`'s pose at frame moment `t`, read at its group node's held moment (its own hold, else its plane's), and the
 * pivot its roots turn about: its group node's, else the document's origin. Throws on a pose its rig can't take.
 */
export function shotRigPoseAt(rig: CompiledShotRig, motion: CompiledShotMotion, t: PaintMoment): { readonly pose: Readonly<Record<string, RigPartPose>>; readonly groupPivot: StampPoint } {
  const node = motion.nodes.get(rig.occurrence), moment = paintNodeTimeAt(node ? node.clock : motion.planeClocks.get(rig.plane) ?? [], t, motion.animationFps);
  const pose = shotPresentationAt(rig.pose, moment), problem = shotRigPoseProblem(rig, pose);
  if (problem) throw new Error(`shot: ${rig.occurrence}'s rig at ${moment.at} s ${problem}`);
  return { pose, groupPivot: node?.pivot ?? { x: 0, y: 0 } };
}
