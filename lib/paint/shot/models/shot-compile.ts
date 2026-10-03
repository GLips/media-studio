// shot-compile.ts: a PaintedShot's props checked and compiled as it loads (ENGINE 6.1): planes far to near, each on
// its canvas; each painted plane's occurrences from its first evaluation, at moment 0 through its source clock; the
// rigs, visibility and motion over them; the camera built over each plane's reach. Every problem is found before any
// is thrown, so the shot names them all at once.
//
// Negative space: masks, instanced planes, pin and cover lays, a dissolve between its ends and `warm` are refused here
// with a problem each (presentation, ENGINE 10 slice 6), as are visibility on the back, a picture or a three plane,
// and painted textures (ENGINE 6.3), which a shot doesn't paint.

import { buildPaintCamera } from '#lib/paint/animation/models/paint-camera-build.ts';
import type { PaintCamera } from '#lib/paint/animation/models/paint-camera.ts';
import { paintNodeClockProblem, paintNodeClockStep, paintNodeTimeAt, type PaintSceneStep } from '#lib/paint/animation/models/paint-clock.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
import { paintMoment, type PaintMoment, type StampGroupLay } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import { compileShotMotion, type CompiledShotMotion, type ShotMotionPlane } from './shot-motion.ts';
import { shotOccurrencePlane } from './shot-occurrences.ts';
import { shotPresentationAt, type OccurrenceKey, type PaintedShotProps, type PictureSource, type PlaneProps, type PresentationValue, type ThreeSource } from './shot-props.ts';
import { shotCameraPlanes } from './shot-reach.ts';
import { compileShotRig, type CompiledShotRig } from './shot-rigs.ts';
import { paintedSourceProblems, paintedSourceSelection, shotPlaneOccurrences, type PaintedSource, type ShotOccurrence } from './shot-selection.ts';
import { shotVisibilityProblems } from './shot-visibility.ts';

/** Where a painted plane lies: a lay for all time (null: document px are plane px), or one read at each moment. */
export type ShotPlaneLay =
  | { readonly kind: 'still'; readonly lay: StampGroupLay | null }
  | { readonly kind: 'moving'; readonly lay: (moment: PaintMoment) => StampGroupLay; readonly reach: StampBox | null };

type ShotPlaneCommon = { readonly id: string; readonly depth: number; readonly canvas: number; readonly clock: readonly PaintSceneStep[] };

/**
 * A painted plane compiled: its source, read at its source clock's moment (`sourceClock`); its lay; its first
 * evaluation's selection and the occurrences found in it; and whether it's the back, laid on its root's paper wherever
 * the frame shows.
 */
export type CompiledShotPaintedPlane = ShotPlaneCommon & {
  readonly kind: 'painted'; readonly source: PresentationValue<PaintedSource>; readonly sourceClock: readonly PaintSceneStep[];
  readonly lay: ShotPlaneLay; readonly first: LayerSelection; readonly occurrences: readonly ShotOccurrence[]; readonly back: boolean;
};

export type CompiledShotPlane =
  | CompiledShotPaintedPlane
  | (ShotPlaneCommon & { readonly kind: 'picture'; readonly source: PictureSource })
  | (ShotPlaneCommon & { readonly kind: 'three'; readonly source: ThreeSource });

/**
 * A shot compiled: its planes far to near (ties in written order), the back first; how many canvases it draws in;
 * its motion, rigs and visibility by occurrence; its camera.
 */
export type CompiledPaintedShot = {
  readonly planes: readonly CompiledShotPlane[];
  readonly canvases: number;
  readonly motion: CompiledShotMotion;
  readonly rigs: ReadonlyMap<OccurrenceKey, CompiledShotRig>;
  readonly visibility: ReadonlyMap<OccurrenceKey, PresentationValue<number>>;
  readonly camera: PaintCamera;
};

const shotError = (owner: string, field: string, message: string) => paintingProblem('error', owner, field, message);

/** Why plane `plane` can't be drawn as written, refusing what's presentation's (ENGINE slice 6). */
function planePropsProblems(plane: PaintedShotProps['planes'][number], canvases: readonly string[]): PaintingProblem[] {
  const problems: PaintingProblem[] = [];
  if (!plane.id || plane.id.includes('/')) problems.push(shotError(plane.id, 'id', `${JSON.stringify(plane.id)} isn't a plane id: one holds no "/"`));
  if (plane.kind === 'instanced') return [...problems, shotError(plane.id, 'kind', "is instanced: instanced planes aren't drawn yet (ENGINE slice 6)")];
  if (plane.masks?.length) problems.push(shotError(plane.id, 'masks', "masks aren't drawn yet (ENGINE slice 6)"));
  const { lay } = plane;
  if (lay && typeof lay !== 'function' && 'kind' in lay) problems.push(shotError(plane.id, 'lay', `a ${lay.kind} lay isn't drawn yet (ENGINE slice 6): lay it by a placement or a callback`));
  if (canvases.length && plane.canvas === undefined) problems.push(shotError(plane.id, 'canvas', `names no canvas, and the shot draws in ${canvases.join(', ')}: every plane names one`));
  if (plane.canvas !== undefined && !canvases.includes(plane.canvas)) problems.push(shotError(plane.id, 'canvas', `names ${plane.canvas}, which isn't one of the shot's canvases${canvases.length ? ` (${canvases.join(', ')})` : ': it has none'}`));
  for (const [field, clock] of [['clock', plane.clock], ['sourceClock', plane.sourceClock]] as const) {
    const problem = clock && paintNodeClockProblem(clock);
    if (problem) problems.push(shotError(plane.id, field, problem));
  }
  return problems;
}

/** Why the planes can't share their canvases: a later canvas's planes all nearer than an earlier one's, the back on the first. */
function canvasOrderProblems(planes: readonly CompiledShotPlane[], canvases: readonly string[]): PaintingProblem[] {
  const problems: PaintingProblem[] = [];
  if (planes.length && planes[0].canvas !== 0) problems.push(shotError(planes[0].id, 'canvas', `is the back, so it draws in the first canvas, ${canvases[0]}`));
  for (const far of planes) {
    for (const near of planes) {
      if (near.canvas > far.canvas && !(near.depth < far.depth)) {
        problems.push(shotError(near.id, 'canvas', `draws in ${canvases[near.canvas]} at depth ${near.depth}, not nearer than ${far.id} at ${far.depth} in ${canvases[far.canvas]}: a later canvas's planes are all nearer`));
      }
    }
  }
  return problems;
}

/** Plane `props` (a painted one) compiled from its first evaluation, or null and its problems. */
function compilePaintedPlane(
  props: PlaneProps, source: PresentationValue<PaintedSource>, common: ShotPlaneCommon, back: boolean, fps: number, problems: PaintingProblem[],
): CompiledShotPaintedPlane | null {
  const sourceClock = props.sourceClock && !paintNodeClockProblem(props.sourceClock) ? [paintNodeClockStep(props.sourceClock)] : [];
  const first = shotPresentationAt(source, paintNodeTimeAt(sourceClock, paintMoment(0), fps));
  const sourceProblems = paintedSourceProblems(props.id, first);
  problems.push(...sourceProblems);
  const drawn = paintedSourceSelection(first);
  if ('problem' in drawn) problems.push(shotError(props.id, 'source', drawn.problem));
  if (sourceProblems.length || 'problem' in drawn) return null;
  if (back && drawn.selection.ground === 'transparent') problems.push(shotError(props.id, 'source.ground', "is the back, laid on its paper wherever the frame shows: its ground can't be transparent"));
  const { lay } = props;
  const compiledLay: ShotPlaneLay = typeof lay === 'function' ? { kind: 'moving', lay, reach: props.reach ?? null } : { kind: 'still', lay: lay && !('kind' in lay) ? lay : null };
  return { ...common, kind: 'painted', source, sourceClock, lay: compiledLay, back, first: drawn.selection, occurrences: shotPlaneOccurrences(props.id, first) };
}

/** Each rig compiled over its group occurrence, refusing a rig inside another's group. */
function compileShotRigs(rigs: NonNullable<PaintedShotProps['rigs']>, planes: readonly CompiledShotPlane[], problems: PaintingProblem[]) {
  const compiled = new Map<OccurrenceKey, CompiledShotRig>();
  for (const [occurrence, rig] of Object.entries(rigs)) {
    const plane = planes.find(({ id }) => id === shotOccurrencePlane(occurrence));
    const found = plane?.kind === 'painted' ? plane.occurrences.find(({ key }) => key === occurrence) : undefined;
    if (!plane || plane.kind !== 'painted' || !found) {
      problems.push(shotError(occurrence, 'rig', 'names no group occurrence of a painted plane of this shot'));
      continue;
    }
    const outer = found.groups.find((group) => Object.hasOwn(rigs, group));
    if (outer) {
      problems.push(shotError(occurrence, 'rig', `lies in ${outer}, which is rigged: its parts pose all it holds, so nothing in it is rigged again`));
      continue;
    }
    const made = compileShotRig(occurrence, plane.id, plane.first.painting.tree, rig);
    problems.push(...made.problems);
    if (made.rig) compiled.set(occurrence, made.rig);
  }
  return compiled;
}

/** Why `visibility` can't be drawn beyond its names and constants: on the back, a picture plane or a three plane. */
function visibilityPlaneProblems(visibility: NonNullable<PaintedShotProps['visibility']>, planes: readonly CompiledShotPlane[]): PaintingProblem[] {
  return Object.keys(visibility).flatMap((key) => {
    const plane = planes.find(({ id }) => id === key);
    if (!plane) return [];
    if (plane.kind !== 'painted') return [shotError(key, 'visibility', `is a ${plane.kind} plane: its visibility isn't drawn; fade what its source draws`)];
    return plane.back ? [shotError(key, 'visibility', 'is the back, shown wherever the frame is: fade a nearer plane or its occurrences')] : [];
  });
}

/**
 * `props` checked and compiled, drawn in `canvases` (the PaintedShotCanvas names, in document order; none for the
 * shot's own canvas): the compiled shot, or null and every problem keeping it from being drawn.
 */
export function compilePaintedShot(props: PaintedShotProps, canvases: readonly string[]): { readonly shot: CompiledPaintedShot | null; readonly problems: readonly PaintingProblem[] } {
  const problems: PaintingProblem[] = [], fps = props.camera.animationFps ?? PAINT_ANIMATION_FPS;
  if (props.warm) problems.push(shotError('shot', 'warm', "warming isn't done yet (ENGINE slice 6): the shot solves each frame's films as it draws it"));
  const ids = new Set<string>();
  for (const plane of props.planes) {
    if (ids.has(plane.id)) problems.push(shotError(plane.id, 'id', 'names two planes'));
    ids.add(plane.id);
    problems.push(...planePropsProblems(plane, canvases));
  }
  if (problems.length) return { shot: null, problems };
  const written = props.planes.flatMap((plane) => (plane.kind === 'instanced' ? [] : [plane]));
  if (!written.length) return { shot: null, problems: [shotError('shot', 'planes', 'has no planes: a shot draws its back at least')] };
  const sorted = written.toSorted((a, b) => b.depth - a.depth);
  const planes = sorted.flatMap((plane, index): CompiledShotPlane[] => {
    const canvas = plane.canvas === undefined ? 0 : canvases.indexOf(plane.canvas), clock = plane.clock && !paintNodeClockProblem(plane.clock) ? [paintNodeClockStep(plane.clock)] : [];
    const common = { id: plane.id, depth: plane.depth, canvas, clock };
    const { source } = plane;
    if (typeof source !== 'function' && source.kind === 'picture') return [{ ...common, kind: 'picture', source }];
    if (typeof source !== 'function' && source.kind === 'three') return [{ ...common, kind: 'three', source }];
    const painted = compilePaintedPlane(plane, source, common, index === 0, fps, problems);
    return painted ? [painted] : [];
  });
  const [back] = planes;
  if (back?.kind === 'three') problems.push(shotError(back.id, 'source', "is the farthest plane, and a three plane can't be the back: the back is opaque to the frame's edge, painted or a picture"));
  if (back?.kind === 'picture' && back.source.extent.kind !== 'everywhere') problems.push(shotError(back.id, 'source.extent', `is the back, a picture held ${back.source.extent.kind === 'box' ? 'within a box' : back.source.extent.kind}; the back's extent is everywhere`));
  if (canvases.length) problems.push(...canvasOrderProblems(planes, canvases));
  const rigs = compileShotRigs(props.rigs ?? {}, planes, problems);
  const occurrences = new Map(planes.flatMap((plane) => (plane.kind === 'painted' ? [[plane.id, plane.occurrences.map(({ key }) => key)] as const] : [])));
  const visibility = props.visibility ?? {};
  problems.push(...shotVisibilityProblems(visibility, props.planes, occurrences), ...visibilityPlaneProblems(visibility, planes));
  const motionPlanes = planes.map((plane): ShotMotionPlane => ({
    id: plane.id, kind: plane.kind, clock: written.find(({ id }) => id === plane.id)!.clock, movingLay: plane.kind === 'painted' && plane.lay.kind === 'moving',
    occurrences: plane.kind === 'painted' ? plane.occurrences : [],
  }));
  const motion = compileShotMotion(motionPlanes, props.motion, new Set(rigs.keys()), fps);
  problems.push(...motion.problems);
  if (props.paintedTextures?.length) problems.push(shotError('shot', 'paintedTextures', "a shot doesn't paint textures for three.js objects yet (ENGINE 6.3): paint them apart, or leave them out"));
  if (problems.length) return { shot: null, problems };
  const built = buildPaintCamera({ ...props.camera, animationFps: fps, planes: shotCameraPlanes(planes, motion.motion, rigs) });
  if (!built.ok) return { shot: null, problems: built.problems.map((message) => shotError('camera', '', message)) };
  return {
    shot: {
      planes, canvases: Math.max(1, canvases.length), motion: motion.motion, rigs, visibility: new Map(Object.entries(visibility)), camera: built.camera,
    },
    problems,
  };
}
