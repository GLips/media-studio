// shot-frame-plan.ts: what a shot's painted plane is at one moment, purely (ENGINE 6.2, 6.3): the selections its
// source blends and the clocks its solve reads, the node poses its marks are solved under, the boil epochs reseeding
// its layers, where its sheets lie, how visible its occurrences are, and its rigs' poses, read once for every end.
//
// A frame's marks are posed at its own moment; its sheets and pieces rigs lie as each exposure or shutter end puts
// them. Boil wobble moves finished paint: marks are solved without it, and the lay takes it in first, so a lattice
// carries the solved film where the wobble puts it (ENGINE 5.3). A rigged group's wobble goes inside its rig.

import { paintBoilEpochAt, paintNodeTimeAt, sceneSeconds, type PaintSceneStep } from '#lib/paint/animation/models/paint-clock.ts';
import type { PaintDeform } from '#lib/paint/animation/models/paint-deform.ts';
import { paintLevelDeformsAt, paintLevelPlacementAt } from '#lib/paint/animation/models/paint-motion-frame.ts';
import { PAINT_SIMILARITY_IDENTITY, paintSimilarityOf, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import { paintingDeformsPose, paintingPoseAfter, paintingSimilarityPose, type PaintingNodePose } from '#lib/paint/document/models/painting-pose.ts';
import { paintingProblemsError, paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane } from './shot-compile.ts';
import type { CompiledShotMotion, CompiledShotNode } from './shot-motion.ts';
import { shotPresentationAt, type OccurrenceKey, type RigPartPose } from './shot-props.ts';
import { shotPlaneOccurrences } from './shot-occurrences.ts';
import { shotRigCelPoses, shotRigEndProblems, shotRigPosed, shotRigPoseProblem, type CompiledShotRig, type ShotRigFound, type ShotRigPosed } from './shot-rigs.ts';
import { paintedPlaneBlendProblems, paintedSourceEnds, paintedSourceProblems, paintedSourceShares, type PaintedSourceShare } from './shot-selection.ts';
import { shotVisibilityProblem } from './shot-visibility.ts';

/** `node`'s boil epoch at `t`, on its own time: 0 unless its marks boil. A boil holds through its frame, as a hold does. */
export function shotNodeEpochAt(node: CompiledShotNode, t: PaintMoment, animationFps: number): number {
  if (node.marks.kind === 'stuck') return 0;
  return paintBoilEpochAt(sceneSeconds(paintNodeTimeAt(node.clock, t, animationFps).frame), node.marks.every, animationFps);
}

/** `node`'s boil wobble at `t`, its rest space boiled: null unless its marks wobble past epoch 0. */
export function shotNodeWobbleAt(node: CompiledShotNode, t: PaintMoment, animationFps: number): PaintDeform | null {
  if (node.marks.kind !== 'wobble') return null;
  const epoch = shotNodeEpochAt(node, t, animationFps);
  return epoch > 0 ? { owner: node.id, kind: 'wobble', seed: node.id, epoch, wobble: node.marks.wobble } : null;
}

/**
 * `node`'s own map at `t` in its parent's frame: its pins, flutter and sway, then its placement about its pivot; with
 * `wobble`, its boil's wobble first, before anything bends it. A similarity while nothing bends; the identity at rest.
 */
export function shotNodePoseAt(node: CompiledShotNode, t: PaintMoment, animationFps: number, wobble: boolean): PaintingNodePose {
  const boiled = wobble ? shotNodeWobbleAt(node, t, animationFps) : null, place = paintLevelPlacementAt(node, t, animationFps);
  return paintingDeformsPose([...(boiled ? [boiled] : []), ...paintLevelDeformsAt(node, t, animationFps, true), ...(place ? [place] : [])]);
}

/** The moment plane `plane`'s presentation reads at frame moment `t`: through its own clock. */
export const shotPlaneMomentAt = (motion: CompiledShotMotion, plane: string, t: PaintMoment): PaintMoment =>
  paintNodeTimeAt(motion.planeClocks.get(plane) ?? [], t, motion.animationFps);

/**
 * Plane `plane`'s lay at `t`, document px to plane px: a callback's read at its presentation moment; the identity
 * unlaid. Throws on a pin: a plane pinned to HTML lies where a frame measures its elements (shotPinnedPlanes).
 */
export function shotPlaneLayAt(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, t: PaintMoment): PaintSimilarity {
  if (plane.lay.kind === 'screen') throw new Error(`shot: plane ${plane.id} is laid on the frame (${plane.lay.screen.kind}), and lies nowhere until it's laid through the camera`);
  const lay = plane.lay.kind === 'moving' ? plane.lay.lay(shotPlaneMomentAt(motion, plane.id, t)) : plane.lay.lay;
  return lay ? paintSimilarityOf(lay.placement, lay.pivot) : PAINT_SIMILARITY_IDENTITY;
}

/** Where plane `plane` lays its root sheet at `t`: its node's map, its wobble in, then its lay. Document px to plane px. */
export function shotPlanePlaceAt(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, t: PaintMoment): PaintingNodePose {
  const node = motion.nodes.get(plane.id), own = node ? shotNodePoseAt(node, t, motion.animationFps, true) : paintingSimilarityPose(PAINT_SIMILARITY_IDENTITY);
  return paintingPoseAfter(paintingSimilarityPose(shotPlaneLayAt(plane, motion, t)), own);
}

/**
 * The selections plane `plane` of `shot` blends at frame moment `t`, read at its source clock's moment, each weighted
 * (paintedSourceShares). A callback's answer is checked as its load checked the first: throws on its problems
 * (paintedSourceProblems, paintedPlaneBlendProblems, shotRigEndProblems), and on occurrences other than its first
 * evaluation's, which motion, rigs and visibility were checked against.
 */
export function shotPlaneSharesAt(shot: Pick<CompiledPaintedShot, 'motion' | 'rigs'>, plane: CompiledShotPaintedPlane, t: PaintMoment): PaintedSourceShare[] {
  const moment = paintNodeTimeAt(plane.sourceClock, t, shot.motion.animationFps), source = shotPresentationAt(plane.source, moment);
  if (typeof plane.source !== 'function') return paintedSourceShares(source);
  const at = `shot plane ${plane.id}'s source at ${moment.at} s`, problems = paintedSourceProblems(plane.id, source), ends = paintedSourceEnds(source);
  if (!problems.length) problems.push(...paintedPlaneBlendProblems(plane.id, ends, plane.paints));
  for (const rig of problems.length ? [] : shot.rigs.values()) if (rig.plane === plane.id) problems.push(...ends.flatMap((end) => shotRigEndProblems(rig, end)));
  if (problems.length) throw paintingProblemsError(at, problems);
  const keys = shotPlaneOccurrences(plane.id, source).map(({ key }) => key), firstKeys = plane.occurrences.map(({ key }) => key);
  if (keys.length !== firstKeys.length || keys.some((key, i) => key !== firstKeys[i])) {
    throw new Error(`${at} shows ${keys.join(', ')}, and its first showed ${firstKeys.join(', ')}: a source keeps the occurrences its motion, rigs and visibility name`);
  }
  return paintedSourceShares(source);
}

/**
 * The clocks whose held moments plane `plane`'s solve reads, outermost steps first: its source clock, and its own,
 * which its lay, rigs and nodes read. Frames reading the same moment on each solve alike. Its nodes' and plays' clocks
 * run inside its own (shot-motion.ts), so their moments follow from its clock's and add no pairing.
 */
export function shotPlaneClocks(motion: CompiledShotMotion, plane: CompiledShotPaintedPlane): (readonly PaintSceneStep[])[] {
  return [plane.sourceClock, motion.planeClocks.get(plane.id) ?? []];
}

/**
 * The node maps of plane `plane`'s occurrences at `t`, by document key: each occurrence's own node, its plane's left
 * out; with `wobble`, as laid, each boil's wobble in but a rigged group's (`rigged`), which its rig takes.
 */
export function shotOccurrencePosesAt(
  plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, t: PaintMoment, wobble: boolean, rigged: ReadonlySet<OccurrenceKey>,
): Map<NodeKey, PaintingNodePose> {
  const poses = new Map<NodeKey, PaintingNodePose>();
  for (const { key, node } of plane.occurrences) {
    const level = motion.nodes.get(key);
    if (level) poses.set(node, shotNodePoseAt(level, t, motion.animationFps, wobble && !rigged.has(key)));
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

/** The pivot rig `rig`'s roots turn about: its group node's, else the document's origin. */
export const shotRigGroupPivot = (rig: CompiledShotRig, motion: CompiledShotMotion): StampPoint => motion.nodes.get(rig.occurrence)?.pivot ?? { x: 0, y: 0 };

/** A rig at one moment: its pose, the pivot its roots turn about (shotRigGroupPivot), and its group node's boil wobble (null: none). */
export type ShotRigAt = { readonly pose: Readonly<Record<string, RigPartPose>>; readonly groupPivot: StampPoint; readonly wobble: PaintDeform | null };

/**
 * Rig `rig` at frame moment `t`, its pose read at its group node's held moment (its own hold, else its plane's).
 * Throws on a pose its rig can't take.
 */
export function shotRigAt(rig: CompiledShotRig, motion: CompiledShotMotion, t: PaintMoment): ShotRigAt {
  const node = motion.nodes.get(rig.occurrence), moment = paintNodeTimeAt(node ? node.clock : motion.planeClocks.get(rig.plane) ?? [], t, motion.animationFps);
  const pose = shotPresentationAt(rig.pose, moment), problem = shotRigPoseProblem(rig, pose);
  if (problem) throw new Error(`shot: ${rig.occurrence}'s rig at ${moment.at} s ${problem}`);
  return { pose, groupPivot: shotRigGroupPivot(rig, motion), wobble: node ? shotNodeWobbleAt(node, t, motion.animationFps) : null };
}

/** A rig at a moment as one frame reads it (shotRigReader). */
export type ShotRigRead = (rig: CompiledShotRig, t: PaintMoment) => ShotRigAt;

/**
 * A frame's reads of its rigs (shotRigAt), each rig at each moment read once: its solve and its lay, at every end of
 * a dissolve, pose by the one answer. Made per frame, so a pose callback is read once a moment a frame reads.
 */
export function shotRigReader(motion: CompiledShotMotion): ShotRigRead {
  const read = new Map<string, ShotRigAt>();
  return (rig, t) => {
    const key = JSON.stringify([rig.occurrence, t.at, t.frame]);
    let at = read.get(key);
    if (!at) read.set(key, (at = shotRigAt(rig, motion, t)));
    return at;
  };
}

/**
 * Rig `found` posed at frame moment `t` as `read` reads it, along its axes; `laid`, its group node's wobble first.
 * Marks are solved unlaid; a lattice carries them to where the laid pose puts them.
 */
export function shotRigPosedAt({ rig, axes }: ShotRigFound, read: ShotRigRead, t: PaintMoment, laid: boolean): ShotRigPosed {
  const { pose, groupPivot, wobble } = read(rig, t);
  return shotRigPosed(rig, pose, groupPivot, axes, laid ? wobble : null);
}

/**
 * Plane `plane`'s node poses at `t` by document key: its occurrences' own and each marks rig's cels' within its
 * group's frame, of `rigs` (its, as found), posed as `read` reads them. `laid`: as the lay reads them, boil wobble in;
 * else as marks are solved.
 */
export function shotPlanePosesAt(
  plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, rigs: readonly ShotRigFound[], read: ShotRigRead, t: PaintMoment, laid: boolean,
): Map<NodeKey, PaintingNodePose> {
  const poses = shotOccurrencePosesAt(plane, motion, t, laid, new Set(rigs.map(({ rig }) => rig.occurrence)));
  for (const found of rigs) {
    const { rig, skin } = found;
    if (!skin) continue;
    for (const [cel, celPose] of shotRigCelPoses(rig, shotRigPosedAt(found, read, t, laid), skin)) {
      const own = poses.get(cel);
      poses.set(cel, own ? paintingPoseAfter(celPose, own) : celPose);
    }
  }
  return poses;
}
