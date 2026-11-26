// shot-frame-plan.ts: a shot's painted plane at one moment, purely: the selections its source
// blends and the clocks its solve reads, the poses its marks solve under, where its sheets
// lie, how visible its occurrences are, the glow its nodes give, and its rigs' poses, read once for every end.
//
// A frame's marks are posed at its own moment; its sheets and pieces rigs lie as each exposure or shutter end puts
// them. Boil wobble moves finished paint: marks are solved without it, and the lay takes it in first, so a lattice
// carries the solved film where the wobble puts it. A rigged group's wobble goes inside its rig.

import { sourceMoment } from './shot-props.ts';
import { paintNodeTimeAt } from '#lib/paint/animation/models/paint-clock.ts';
import type { PaintDeform } from '#lib/paint/animation/models/paint-deform.ts';
import { paintGlowProblem } from '#lib/paint/animation/models/paint-motion-compile.ts';
import { paintLevelDeformsAt, paintLevelPlacementAt, paintNodeWobbleAt } from '#lib/paint/animation/models/paint-motion-frame.ts';
import { PAINT_SIMILARITY_IDENTITY, paintSimilarityOf, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import { paintingDeformsPose, paintingPoseAfter, paintingSimilarityPose, type PaintingNodePose } from '#lib/paint/document/models/painting-pose.ts';
import { paintingProblem, paintingProblemsError, paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import type { PaintMoment, StampGroupGlow, StampGroupLay } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane } from './shot-compile.ts';
import type { CompiledShotGlow, CompiledShotMotion, CompiledShotNode } from './shot-motion.ts';
import type { OccurrenceKey, RigPartPose } from './shot-props.ts';
import { presentationValueAt } from '#lib/paint/animation/models/paint-value.ts';
import { shotPlaneOccurrences } from './shot-occurrences.ts';
import { shotPlaneRigEndProblems, shotRigCelPoses, shotRigPoseAt, shotRigPosed, shotRigPoseProblem, type CompiledShotRig, type ShotRigFound, type ShotRigPosed } from './shot-rigs.ts';
import { paintedPlaneBlendProblems, paintedSourceEnds, paintedSourceProblems, paintedSourceShares, type PaintedSourceShare } from './shot-selection.ts';
import { shotVisibilityProblem } from './shot-visibility.ts';

/** `node`'s boil wobble at `t`, its rest space displaced at the exposure moment. */
export function shotNodeWobbleAt(node: CompiledShotNode, t: PaintMoment, animationFps: number): PaintDeform | null {
  if (node.marks.kind !== 'wobble') return null;
  return paintNodeWobbleAt(node, node.marks.wobble, t, animationFps);
}

/**
 * `node`'s own map at `t` in its parent's frame: its pins, flutter and sway, then its placement about its pivot; with
 * `wobble`, its boil's wobble first. A similarity while nothing bends; the identity at rest. `solving`: a placement
 * at scale 0 left out, so no solve maps marks onto a point; it shows nothing then (shotScaledToNothingAt).
 */
export function shotNodePoseAt(node: CompiledShotNode, t: PaintMoment, animationFps: number, { wobble, solving }: { readonly wobble: boolean; readonly solving: boolean }): PaintingNodePose {
  const boiled = wobble ? shotNodeWobbleAt(node, t, animationFps) : null, place = paintLevelPlacementAt(node, t, animationFps);
  const placed = place && !(solving && placesNothing(place.placement)) ? [place] : [];
  return paintingDeformsPose([...(boiled ? [boiled] : []), ...paintLevelDeformsAt(node, t, animationFps, true), ...placed]);
}

/** A placement at scale 0 lays everything on its pivot, which draws nothing. */
const placesNothing = ({ scale }: { readonly scale: number }) => scale === 0;

/**
 * Whether `key` (a plane, or an occurrence on `plane`) is placed at scale 0 at `t`, by its node, a node over it, or
 * its plane's moving lay: it draws nothing then, as at visibility 0, and nothing is mapped back through it.
 */
export function shotScaledToNothingAt(shot: CompiledPaintedShot, plane: string, key: OccurrenceKey, t: PaintMoment): boolean {
  const { motion } = shot;
  for (let id = shotOccurrenceNearest(motion, plane, key); id !== null; id = motion.nodes.get(id)!.parent) {
    const place = paintLevelPlacementAt(motion.nodes.get(id)!, t, motion.animationFps);
    if (place && placesNothing(place.placement)) return true;
  }
  const compiled = shot.planes.find((each) => each.id === plane);
  return (compiled?.kind === 'painted' || compiled?.kind === 'effect') && compiled.lay.kind === 'moving' && placesNothing(compiled.lay.lay(shotPlaneMomentAt(motion, plane, t)).placement);
}

/**
 * The motion node nearest occurrence `key` of plane `plane`: its own or an enclosing group's, else the plane's; null
 * where nothing moves it. A layer a source in time gains past its first lies in no named group (shotPlaneSharesAt),
 * so its plane's node is its nearest.
 */
export const shotOccurrenceNearest = (motion: CompiledShotMotion, plane: string, key: OccurrenceKey): string | null =>
  motion.nearest.get(key) ?? (motion.nodes.has(plane) ? plane : null);

/** The moment plane `plane`'s presentation reads at frame moment `t`: through its own clock. */
export const shotPlaneMomentAt = (motion: CompiledShotMotion, plane: string, t: PaintMoment): PaintMoment =>
  paintNodeTimeAt(motion.planeClocks.get(plane) ?? [], t, motion.animationFps);

/** A lay as a similarity, document px to plane px: the identity for none. */
export const shotLaySimilarity = (lay: StampGroupLay | null): PaintSimilarity => (lay ? paintSimilarityOf(lay.placement, lay.pivot) : PAINT_SIMILARITY_IDENTITY);

/**
 * Plane `plane`'s lay at `t`, document px to plane px: a callback's read at its presentation moment; the identity
 * unlaid. Throws on a pin: a plane pinned to HTML lies where a frame measures its elements (shotPinnedPlanes).
 */
export function shotPlaneLayAt(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, t: PaintMoment): PaintSimilarity {
  if (plane.lay.kind === 'screen') throw new Error(`shot: plane ${plane.id} is laid on the frame (${plane.lay.screen.kind}), and lies nowhere until it's laid through the camera`);
  return shotLaySimilarity(plane.lay.kind === 'moving' ? plane.lay.lay(shotPlaneMomentAt(motion, plane.id, t)) : plane.lay.lay);
}

/** Where plane `plane` lays its root sheet at `t`: its node's map, its wobble in, then its lay. Document px to plane px. */
export function shotPlanePlaceAt(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, t: PaintMoment): PaintingNodePose {
  const node = motion.nodes.get(plane.id), own = node ? shotNodePoseAt(node, t, motion.animationFps, { wobble: true, solving: false }) : paintingSimilarityPose(PAINT_SIMILARITY_IDENTITY);
  return paintingPoseAfter(paintingSimilarityPose(shotPlaneLayAt(plane, motion, t)), own);
}

/** What of a shot names occurrences: their motion nodes, rigs, visibility and the masks reading them. */
export type ShotNaming = Pick<CompiledPaintedShot, 'motion' | 'rigs' | 'visibility' | 'masks'>;

/**
 * Whether `shot` names occurrence `key`, so a source must show it at every moment. One it doesn't name lays as its
 * plane does wherever it shows, so a figure in time may gain and lose layers as its drawings do (a line hidden in
 * one pose and seen in the next).
 */
export const shotOccurrenceNamed = ({ motion, rigs, visibility, masks }: ShotNaming, key: OccurrenceKey) =>
  motion.nodes.has(key) || rigs.has(key) || visibility.has(key) || masks.read.has(key);

/**
 * The selections plane `plane` of `shot` blends at frame moment `t`, read at its scheduled moment, each weighted.
 * A callback's answer is checked as its load checked the first: throws on its problems, on dropping an occurrence
 * the shot names (shotOccurrenceNamed), and on gaining one inside a named group. A painting in time was checked
 * as it loaded.
 */
export function shotPlaneSharesAt(shot: ShotNaming, plane: CompiledShotPaintedPlane, t: PaintMoment): PaintedSourceShare[] {
  const moment = sourceMoment(plane.drawings, t), source = presentationValueAt(plane.source, moment);
  if (typeof plane.source !== 'function' || plane.keyDrawings) return paintedSourceShares(source);
  const at = `shot plane ${plane.id}'s source at ${moment.at} s`, problems = paintedSourceProblems(plane.id, source), ends = paintedSourceEnds(source);
  if (!problems.length) problems.push(...paintedPlaneBlendProblems(plane.id, ends, plane.paints));
  if (!problems.length) problems.push(...shotPlaneRigEndProblems(shot.rigs.values(), plane.id, ends));
  if (problems.length) throw paintingProblemsError(at, problems);
  const shown = shotPlaneOccurrences(plane.id, source), keys = new Set(shown.map(({ key }) => key)), first = new Set(plane.occurrences.map(({ key }) => key));
  const lost = plane.occurrences.filter(({ key }) => shotOccurrenceNamed(shot, key) && !keys.has(key)).map(({ key }) => key);
  if (lost.length) throw new Error(`${at} doesn't show ${lost.join(', ')}, which its first showed: a source keeps the occurrences its motion, rigs, visibility and masks name`);
  // A newcomer takes its plane's motion (shotOccurrenceNearest): one inside a named group would need the group's.
  const nested = shown.filter(({ key, groups }) => !first.has(key) && groups.some((group) => shotOccurrenceNamed(shot, group))).map(({ key }) => key);
  if (nested.length) throw new Error(`${at} shows ${nested.join(', ')}, which its first didn't, inside a group the shot names: a source shows from its first what lies in a named group`);
  return paintedSourceShares(source);
}

/**
 * The clocks whose held moments plane `plane`'s solve reads, outermost steps first: its source schedule and presentation clock,
 * which its lay, rigs and nodes read. Frames reading the same moment on each solve alike. Its nodes' and plays' clocks
 * run inside its own (shot-motion.ts), so their moments follow from its clock's and add no pairing.
 */
export function shotPlaneClocks(motion: CompiledShotMotion, plane: CompiledShotPaintedPlane) {
  return (frame: PaintMoment) => [sourceMoment(plane.drawings, frame), shotPlaneMomentAt(motion, plane.id, frame)];
}

/**
 * The node maps of plane `plane`'s occurrences at `t`, by document key: each occurrence's own node, its plane's left
 * out; `laid`, as laid, each boil's wobble in but a rigged group's (`rigged`), which its rig takes; else as solved.
 */
export function shotOccurrencePosesAt(
  plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, t: PaintMoment, laid: boolean, rigged: ReadonlySet<OccurrenceKey>,
): Map<NodeKey, PaintingNodePose> {
  const poses = new Map<NodeKey, PaintingNodePose>();
  for (const { key, node } of plane.occurrences) {
    const level = motion.nodes.get(key);
    if (level) poses.set(node, shotNodePoseAt(level, t, motion.animationFps, { wobble: laid && !rigged.has(key), solving: !laid }));
  }
  return poses;
}

/**
 * How visible `key` (a plane or an occurrence on `plane`) is at `t`, read at its plane's presentation moment: 1 unless
 * the shot says, 0 where it's scaled to nothing (shotScaledToNothingAt). Throws on a callback's value outside 0..1.
 */
export function shotVisibilityAt(shot: CompiledPaintedShot, plane: string, key: OccurrenceKey, t: PaintMoment): number {
  if (shotScaledToNothingAt(shot, plane, key, t)) return 0;
  const value = shot.visibility.get(key);
  if (value === undefined) return 1;
  const moment = shotPlaneMomentAt(shot.motion, plane, t), visibility = presentationValueAt(value, moment), problem = shotVisibilityProblem(key, visibility, moment.at);
  if (problem) throw new Error(`shot: ${paintingProblemText(problem)}`);
  return visibility;
}

/**
 * What `glow` gives at frame moment `t`: its value at its stating node's held moment; null at amount 0, which costs
 * nothing. Throws on a value that can't be drawn.
 */
export function shotNodeGlowAt(motion: CompiledShotMotion, glow: CompiledShotGlow, t: PaintMoment): StampGroupGlow | null {
  const value = presentationValueAt(glow.value, paintNodeTimeAt(motion.nodes.get(glow.from)!.clock, t, motion.animationFps)), problem = paintGlowProblem(value);
  if (problem) throw new Error(`shot: ${paintingProblemText(paintingProblem('error', glow.from, 'motion', `${problem}, at ${t.at} s`))}`);
  return value.amount > 0 ? value : null;
}

/** The pivot rig `rig`'s roots turn about: its group node's, else the document's origin. */
export const shotRigGroupPivot = (rig: CompiledShotRig, motion: CompiledShotMotion): StampPoint => motion.nodes.get(rig.occurrence)?.pivot ?? { x: 0, y: 0 };

/** The moment rig `rig`'s pose reads at frame moment `t`: its group node's held moment (its own hold, else its plane's). */
export const shotRigMomentAt = (rig: CompiledShotRig, motion: CompiledShotMotion, t: PaintMoment): PaintMoment =>
  paintNodeTimeAt(motion.nodes.get(rig.occurrence)?.clock ?? motion.planeClocks.get(rig.plane) ?? [], t, motion.animationFps);

/** A rig at one moment: its pose, the pivot its roots turn about (shotRigGroupPivot), and its group node's boil wobble (null: none). */
export type ShotRigAt = { readonly pose: Readonly<Record<string, RigPartPose>>; readonly groupPivot: StampPoint; readonly wobble: PaintDeform | null };

/**
 * Rig `rig` at frame moment `t`, its pose read at its group node's held moment (its own hold, else its plane's).
 * Throws on a pose its rig can't take. Read only through a frame's shotRigReader, which reads each moment once.
 */
function shotRigAt(rig: CompiledShotRig, motion: CompiledShotMotion, t: PaintMoment): ShotRigAt {
  const node = motion.nodes.get(rig.occurrence), moment = shotRigMomentAt(rig, motion, t);
  const pose = shotRigPoseAt(rig.pose, moment), problem = shotRigPoseProblem(rig, pose);
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
 * A selection's rigs as a frame poses them: each `found` over that selection's paint, and `read`, the frame's one read
 * of their poses (shotRigReader), which every selection it blends shares.
 */
export type ShotFrameRigs = { readonly found: readonly ShotRigFound[]; readonly read: ShotRigRead };

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
 * group's frame, of `rigs` (its, as the frame poses them). `laid`: as the lay reads them, boil wobble in; else as
 * marks are solved.
 */
export function shotPlanePosesAt(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, { found: rigs, read }: ShotFrameRigs, t: PaintMoment, laid: boolean): Map<NodeKey, PaintingNodePose> {
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
