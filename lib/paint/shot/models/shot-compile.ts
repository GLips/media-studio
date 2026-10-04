// shot-compile.ts: a PaintedShot's props checked and compiled as it loads (ENGINE 6.1): planes far to near, each on
// its canvas; each painted plane's occurrences from its first evaluation, at moment 0 through its source clock; each
// instanced plane's variants (shot-instances.ts); the rigs, visibility and motion over them; the camera built over
// each plane's reach. Every problem is found before any is thrown. Covers are laid through the built camera here, pins
// each frame (shot-placement.ts). The back is opaque unless HTML lies behind the first canvas.
//
// Negative space: masks, a dissolve between its ends and `warm` are refused (ENGINE 10 slice 6), as are visibility on
// the back, a picture or a three plane, a lay on either, and painted textures (ENGINE 6.3).

import { buildPaintCamera } from '#lib/paint/animation/models/paint-camera-build.ts';
import type { PaintCamera } from '#lib/paint/animation/models/paint-camera.ts';
import { paintNodeClockProblem, paintNodeClockSteps, paintNodeTimeAt, type PaintNodeClock, type PaintSceneStep } from '#lib/paint/animation/models/paint-clock.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
import { paintMoment, type PaintMoment, type StampGroupLay } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import { compileShotInstancedPlane, type CompiledShotInstancedPlane } from './shot-instances.ts';
import { compileShotMotion, type CompiledShotMotion, type ShotMotionPlane } from './shot-motion.ts';
import { shotOccurrencePlane, shotPlaneOccurrences, type ShotOccurrence } from './shot-occurrences.ts';
import { shotCoveredPlanes, shotPlacementProblems } from './shot-placement.ts';
import { shotDrawableOrder } from './shot-plan.ts';
import {
  shotPresentationAt, type CoverFrame, type InstancedPlaneProps, type OccurrenceKey, type PaintedShotProps, type PictureSource, type PlaneProps, type PresentationValue,
  type ScreenPin, type ThreeSource,
} from './shot-props.ts';
import { shotCameraPlanes } from './shot-reach.ts';
import { compileShotRig, type CompiledShotRig } from './shot-rigs.ts';
import { paintedSourceProblems, paintedSourceSelection, type PaintedSource } from './shot-selection.ts';
import { shotVisibilityProblems } from './shot-visibility.ts';

/**
 * Where a painted plane lies: a lay for all time (null: document px are plane px), one read at each moment, or laid
 * on the frame through the built camera, a pin or a cover. A cover is laid as the shot compiles, so a compiled shot's
 * screen lays are pins, laid where each frame measures their elements (shotPinnedPlanes).
 */
export type ShotPlaneLay =
  | { readonly kind: 'still'; readonly lay: StampGroupLay | null }
  | { readonly kind: 'moving'; readonly lay: (moment: PaintMoment) => StampGroupLay; readonly reach: StampBox | null }
  | { readonly kind: 'screen'; readonly screen: ScreenPin | CoverFrame };

type ShotPlaneCommon = { readonly id: string; readonly depth: number; readonly canvas: number };

/**
 * A painted plane compiled: its source, read at its source clock's moment (`sourceClock`); its lay; its first
 * evaluation's selection and occurrences; and `back`: it's the opaque back, laid on its root's paper wherever the
 * frame shows. A clear back, over HTML, has `back` false: it's laid as clear film, as a nearer plane is.
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
 * A shot compiled: its planes far to near (shotDrawableOrder), the back first; its instanced planes as written; all
 * of them as `written`, which a frame orders with its items; how many canvases it draws in, and `clearBack`: the back
 * isn't opaque but clear where it lays nothing, over HTML, its canvas premultiplied as later ones are
 * (shotCanvasAlphaMode); its motion (each plane's clock in its planeClocks, an instanced plane's too), rigs and
 * visibility by occurrence; its camera.
 */
export type CompiledPaintedShot = {
  readonly planes: readonly CompiledShotPlane[];
  readonly instanced: readonly CompiledShotInstancedPlane[];
  readonly written: readonly (PlaneProps | InstancedPlaneProps)[];
  readonly canvases: number;
  readonly clearBack: boolean;
  readonly motion: CompiledShotMotion;
  readonly rigs: ReadonlyMap<OccurrenceKey, CompiledShotRig>;
  readonly visibility: ReadonlyMap<OccurrenceKey, PresentationValue<number>>;
  readonly camera: PaintCamera;
};

/**
 * What of `shot` a frame solves, and a warm would: its painted planes, then each instanced plane's variants. A variant
 * carries its instanced plane's id (CompiledShotVariant), so whatever is kept per solvable is keyed by object.
 */
export function shotPaintedSolvables(shot: Pick<CompiledPaintedShot, 'planes' | 'instanced'>): CompiledShotPaintedPlane[] {
  const painted = shot.planes.filter((plane): plane is CompiledShotPaintedPlane => plane.kind === 'painted');
  return [...painted, ...shot.instanced.flatMap(({ variants }) => [...variants.values()].map((variant) => variant.painted))];
}

const shotError = (owner: string, field: string, message: string) => paintingProblem('error', owner, field, message);

/** What a shot's page holds as it loads or draws a frame: whether HTML lies behind its first canvas (before it in DOM order). */
export type ShotPage = { readonly htmlBehind: boolean };

/** A shot drawn with no page, or in a canvas of its own under its children: nothing lies behind its back. */
const SHOT_NO_HTML_BEHIND: ShotPage = { htmlBehind: false };

/** How canvas `index` of `shot` hands the browser its pixels: the first opaque, holding an opaque back; the rest, and a clear back's, premultiplied. */
export const shotCanvasAlphaMode = (shot: CompiledPaintedShot, index: number): 'opaque' | 'premultiplied' => (index === 0 && !shot.clearBack ? 'opaque' : 'premultiplied');

/**
 * Why `shot` can't draw a frame over `page` as that frame finds it: a clear back with no HTML behind it. Its load's
 * frame had some, so HTML behind a clear back stays mounted while the shot draws.
 */
export function shotPageProblems(shot: CompiledPaintedShot, page: ShotPage): PaintingProblem[] {
  if (!shot.clearBack || page.htmlBehind) return [];
  return [shotError(shot.planes[0].id, 'source', 'is a clear back, and no HTML lies before the first canvas at this frame: HTML behind a clear back stays mounted while the shot draws')];
}

/** Why plane `plane` can't be drawn as written, refusing what's presentation's (ENGINE slice 6). */
function planePropsProblems(plane: PaintedShotProps['planes'][number], canvases: readonly string[]): PaintingProblem[] {
  const problems: PaintingProblem[] = [];
  if (!plane.id || plane.id.includes('/')) problems.push(shotError(plane.id, 'id', `${JSON.stringify(plane.id)} isn't a plane id: one holds no "/"`));
  if (plane.kind !== 'instanced') {
    if (plane.masks?.length) problems.push(shotError(plane.id, 'masks', "masks aren't drawn yet (ENGINE slice 6)"));
    const { lay, source } = plane;
    if (lay && typeof lay !== 'function' && 'kind' in lay) problems.push(...shotPlacementProblems(plane.id, lay));
    if (lay && typeof source !== 'function' && (source.kind === 'picture' || source.kind === 'three')) {
      problems.push(shotError(plane.id, 'lay', `is a ${source.kind} plane, which lies where its source puts it: a lay places a painted plane; move it by its node`));
    }
  }
  if (canvases.length && plane.canvas === undefined) problems.push(shotError(plane.id, 'canvas', `names no canvas, and the shot draws in ${canvases.join(', ')}: every plane names one`));
  if (plane.canvas !== undefined && !canvases.includes(plane.canvas)) problems.push(shotError(plane.id, 'canvas', `names ${plane.canvas}, which isn't one of the shot's canvases${canvases.length ? ` (${canvases.join(', ')})` : ': it has none'}`));
  const clocks: readonly (readonly [string, PaintNodeClock | undefined])[] = plane.kind === 'instanced' ? [['clock', plane.clock]] : [['clock', plane.clock], ['sourceClock', plane.sourceClock]];
  for (const [field, clock] of clocks) {
    const problem = clock && paintNodeClockProblem(clock);
    if (problem) problems.push(shotError(plane.id, field, problem));
  }
  return problems;
}

/** The depths a plane's drawables lie between on its canvas: a plane's one depth, an instanced plane's items' `depths`. */
type ShotCanvasSpan = { readonly id: string; readonly canvas: number; readonly near: number; readonly far: number };

const spanText = ({ near, far }: ShotCanvasSpan) => (near === far ? `at depth ${near}` : `at depths ${near}..${far}`);

/**
 * Why the drawables can't share their canvases: a later canvas's all nearer than an earlier one's, the back (the
 * first of `spans`) on the first.
 */
function canvasOrderProblems(spans: readonly ShotCanvasSpan[], canvases: readonly string[]): PaintingProblem[] {
  const problems: PaintingProblem[] = [];
  if (spans.length && spans[0].canvas !== 0) problems.push(shotError(spans[0].id, 'canvas', `is the back, so it draws in the first canvas, ${canvases[0]}`));
  for (const far of spans) {
    for (const near of spans) {
      if (near.canvas > far.canvas && !(near.far < far.near)) {
        problems.push(shotError(near.id, 'canvas', `draws in ${canvases[near.canvas]} ${spanText(near)}, not nearer than ${far.id} ${spanText(far)} in ${canvases[far.canvas]}: a later canvas's planes are all nearer`));
      }
    }
  }
  return problems;
}

/** Plane `props`' lay: a pin or cover left to be laid through the built camera. */
function compilePlaneLay({ lay, reach }: PlaneProps): ShotPlaneLay {
  if (typeof lay === 'function') return { kind: 'moving', lay, reach: reach ?? null };
  if (lay && 'kind' in lay) return { kind: 'screen', screen: lay };
  return { kind: 'still', lay: lay ?? null };
}

/**
 * Plane `props` (a painted one) compiled from its first evaluation, or null and its problems, its source's at `field`.
 * The farthest plane is the back, opaque; with a transparent ground over HTML behind the first canvas, it's clear film
 * instead.
 */
function compilePaintedPlane(
  props: PlaneProps, source: PresentationValue<PaintedSource>, common: ShotPlaneCommon, farthest: boolean, page: ShotPage, fps: number, problems: PaintingProblem[],
  field = 'source',
): CompiledShotPaintedPlane | null {
  const sourceClock = paintNodeClockSteps(props.sourceClock);
  const first = shotPresentationAt(source, paintNodeTimeAt(sourceClock, paintMoment(0), fps));
  const sourceProblems = paintedSourceProblems(props.id, first, field);
  problems.push(...sourceProblems);
  const drawn = paintedSourceSelection(first);
  if ('problem' in drawn) problems.push(shotError(props.id, field, drawn.problem));
  if (sourceProblems.length || 'problem' in drawn) return null;
  const clear = drawn.selection.ground === 'transparent';
  if (farthest && clear && !page.htmlBehind) {
    problems.push(shotError(props.id, 'source.ground', 'is the back, laid on its paper wherever the frame shows: its ground is transparent only over HTML before the first canvas'));
  }
  return { ...common, kind: 'painted', source, sourceClock, lay: compilePlaneLay(props), back: farthest && !clear, first: drawn.selection, occurrences: shotPlaneOccurrences(props.id, first) };
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

/**
 * Why `visibility` can't be drawn beyond its names and constants: on the back, a picture plane or a three plane, or
 * between 0 and 1 inside a rig drawn as pieces (`rigs`), whose layers show whole or not at all.
 */
function visibilityPlaneProblems(visibility: NonNullable<PaintedShotProps['visibility']>, planes: readonly CompiledShotPlane[], rigs: ReadonlyMap<OccurrenceKey, CompiledShotRig>): PaintingProblem[] {
  return Object.entries(visibility).flatMap(([key, value]) => {
    const plane = planes.find(({ id }) => id === shotOccurrencePlane(key));
    if (plane && plane.id === key) {
      if (plane.kind !== 'painted') return [shotError(key, 'visibility', `is a ${plane.kind} plane: its visibility isn't drawn; fade what its source draws`)];
      return plane.back ? [shotError(key, 'visibility', 'is the back, shown wherever the frame is: fade a nearer plane or its occurrences')] : [];
    }
    const rigged = plane?.kind === 'painted' && plane.occurrences.find((occurrence) => occurrence.key === key)?.groups.find((group) => rigs.get(group)?.pieces);
    if (!rigged || typeof value !== 'number' || value === 0 || value === 1) return [];
    return [shotError(key, 'visibility', `is ${value}, inside ${rigged}, drawn as pieces: a layer or group there shows (1) or doesn't (0)`)];
  });
}

/**
 * `props` checked and compiled, drawn in `canvases` (the PaintedShotCanvas names, in document order; none for the
 * shot's own canvas) on `page`: the compiled shot, or null and every problem keeping it from being drawn.
 */
export function compilePaintedShot(
  props: PaintedShotProps, canvases: readonly string[], page: ShotPage = SHOT_NO_HTML_BEHIND,
): { readonly shot: CompiledPaintedShot | null; readonly problems: readonly PaintingProblem[] } {
  const problems: PaintingProblem[] = [], fps = props.camera.animationFps ?? PAINT_ANIMATION_FPS;
  if (props.warm) problems.push(shotError('shot', 'warm', "warming isn't done yet (ENGINE slice 6): the shot solves each frame's films as it draws it"));
  canvases.forEach((name, index) => {
    if (canvases.indexOf(name) !== index) problems.push(shotError('shot', 'canvas', `names two of its canvases ${name}: each PaintedShotCanvas takes a name of its own`));
  });
  const ids = new Set<string>();
  for (const plane of props.planes) {
    if (ids.has(plane.id)) problems.push(shotError(plane.id, 'id', 'names two planes'));
    ids.add(plane.id);
    problems.push(...planePropsProblems(plane, canvases));
  }
  if (problems.length) return { shot: null, problems };
  // The farthest plane not instanced is the back; shotDrawableOrder places no items here.
  const written = new Map(props.planes.flatMap((plane) => (plane.kind === 'instanced' ? [] : [[plane.id, plane] as const])));
  if (!written.size) return { shot: null, problems: [shotError('shot', 'planes', 'has no planes: a shot draws its back at least')] };
  const canvasOf = (name: string | undefined) => (name === undefined ? 0 : canvases.indexOf(name));
  const planes = shotDrawableOrder(props.planes, new Map()).flatMap((drawable, index): CompiledShotPlane[] => {
    const plane = written.get(drawable.plane)!, canvas = canvasOf(plane.canvas);
    const common = { id: plane.id, depth: plane.depth, canvas };
    const { source } = plane;
    if (typeof source !== 'function' && source.kind === 'picture') return [{ ...common, kind: 'picture', source }];
    if (typeof source !== 'function' && source.kind === 'three') return [{ ...common, kind: 'three', source }];
    const painted = compilePaintedPlane(plane, source, common, index === 0, page, fps, problems);
    return painted ? [painted] : [];
  });
  const [back] = planes, clearBack = !!back && (back.kind === 'painted' ? !back.back : back.kind === 'three' || back.source.extent.kind !== 'everywhere');
  if (clearBack && !page.htmlBehind && back.kind === 'three') {
    problems.push(shotError(back.id, 'source', "is the farthest plane, and a three plane is the back only over HTML before the first canvas: the back is opaque to the frame's edge, painted or a picture"));
  }
  if (clearBack && !page.htmlBehind && back.kind === 'picture') {
    problems.push(shotError(back.id, 'source.extent', `is the back, a picture held ${back.source.extent.kind === 'box' ? 'within a box' : back.source.extent.kind}; the back's extent is everywhere, unless HTML lies before the first canvas`));
  }
  const instanced = back ? props.planes.flatMap((plane) => {
    if (plane.kind !== 'instanced') return [];
    const common = { id: plane.id, depth: plane.depths.far, canvas: canvasOf(plane.canvas) };
    // Each variant compiles as a painted plane does, under its instanced plane's id (CompiledShotVariant says why).
    const variants = Object.entries(plane.variants).map(([name, source]) =>
      [name, compilePaintedPlane({ id: plane.id, depth: plane.depths.far, source }, source, common, false, page, fps, problems, `variants.${name}`)] as const);
    const made = compileShotInstancedPlane(plane, common.canvas, back, props.camera.stage, variants, problems);
    return made ? [made] : [];
  }) : [];
  if (canvases.length) {
    const spans = [...planes.map(({ id, canvas, depth }) => ({ id, canvas, near: depth, far: depth })), ...instanced.map(({ id, canvas, depths }) => ({ id, canvas, ...depths }))];
    problems.push(...canvasOrderProblems(spans, canvases));
  }
  const rigs = compileShotRigs(props.rigs ?? {}, planes, problems);
  const occurrences = new Map(planes.flatMap((plane) => (plane.kind === 'painted' ? [[plane.id, plane.occurrences.map(({ key }) => key)] as const] : [])));
  const visibility = props.visibility ?? {};
  problems.push(...shotVisibilityProblems(visibility, props.planes, occurrences), ...visibilityPlaneProblems(visibility, planes, rigs));
  const motionPlanes = [
    ...planes.map((plane): ShotMotionPlane => ({
      id: plane.id, kind: plane.kind, clock: paintNodeClockSteps(written.get(plane.id)!.clock), movingLay: plane.kind === 'painted' && plane.lay.kind === 'moving',
      occurrences: plane.kind === 'painted' ? plane.occurrences : [],
    })),
    // Every instanced plane as written, so a node on one that failed to compile is refused for what it is.
    ...props.planes.flatMap((plane): ShotMotionPlane[] => (plane.kind === 'instanced' ? [{ id: plane.id, kind: 'instanced', clock: paintNodeClockSteps(plane.clock), movingLay: false, occurrences: [] }] : [])),
  ];
  const motion = compileShotMotion(motionPlanes, props.motion, new Set(rigs.keys()), fps);
  problems.push(...motion.problems);
  if (props.paintedTextures?.length) problems.push(shotError('shot', 'paintedTextures', "a shot doesn't paint textures for three.js objects yet (ENGINE 6.3): paint them apart, or leave them out"));
  if (problems.length) return { shot: null, problems };
  // Planes laid on the frame are unchecked in the build, which they're laid through; covers are laid and checked after it.
  const cameraPlanes = [...shotCameraPlanes(planes, motion.motion, rigs), ...instanced.map(({ id, depths }) => ({ id, kind: 'instanced' as const, depths }))];
  const built = buildPaintCamera({ ...props.camera, animationFps: fps, planes: cameraPlanes });
  if (!built.ok) return { shot: null, problems: built.problems.map((message) => shotError('camera', '', message)) };
  const covered = shotCoveredPlanes({ camera: built.camera, motion: motion.motion, rigs }, planes);
  if (covered.problems.length) return { shot: null, problems: covered.problems };
  return {
    shot: {
      planes: covered.planes, instanced, written: props.planes, canvases: Math.max(1, canvases.length), clearBack, motion: motion.motion, rigs,
      visibility: new Map(Object.entries(visibility)), camera: built.camera,
    },
    problems,
  };
}
