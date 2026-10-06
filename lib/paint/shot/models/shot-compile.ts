// shot-compile.ts: a PaintedShot's props checked and compiled as it loads (ENGINE 6.1): planes far to near, each on
// its canvas; painted planes' occurrences from their first evaluation, at moment 0; instanced planes' variants; the
// planes' entries (shot-entries.ts): rigs, visibility and motion; masks and warm; the camera over each plane's reach;
// the painted textures three sources read. Every problem is found before any is thrown. Values in time are sampled
// at the moments its span draws (paint-span-moments.ts), for its reach, depths (shot-depths.ts) and motion warnings
// (shot-motion-warnings.ts).
//
// Negative space: refused are the opaque back's visibility, a picture or three plane's lay, a three plane's depth in
// time, an alphaOf in a pieces rig, and a dissolve end cut otherwise than its rig (shotPlaneRigEndProblems).

import { buildPaintCamera, paintCameraLensBuilt, paintShotCameraOptions } from '#lib/paint/animation/models/paint-camera-build.ts';
import type { PaintCamera } from '#lib/paint/animation/models/paint-camera.ts';
import { paintNodeClockProblem, paintNodeClockSteps, paintNodeTimeAt, type PaintNodeClock, type PaintSceneStep } from '#lib/paint/animation/models/paint-clock.ts';
import { paintPlacementMoveProblem } from '#lib/paint/animation/models/paint-motion-clips.ts';
import { paintSecondsText, paintSpanFrames, paintSpanMoments, paintSpanProblem } from '#lib/paint/animation/models/paint-span-moments.ts';
import { presentationValueAt, type PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { PaintingBrushOf } from '#lib/paint/document/models/painting-deposit-compile.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { paintMoment, type PaintMoment, type StampGroupLay } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';
import { shotPlaneMomentAt } from './shot-frame-plan.ts';
import { shotPlaneEntries } from './shot-entries.ts';
import { compileShotInstancedPlane, type CompiledShotInstancedPlane } from './shot-instances.ts';
import { compileShotMotion, type CompiledShotMotion, type ShotMotionPlane } from './shot-motion.ts';
import { shotMotionWarnings } from './shot-motion-warnings.ts';
import { shotEntryProblem, shotOccurrencePlane, shotPlaneOccurrences, type ShotOccurrence } from './shot-occurrences.ts';
import { shotMaskCheck, type ShotMaskGraph } from './shot-masks.ts';
import { compileShotPaintedTextures, type CompiledShotPaintedTexture } from './shot-painted-texture-compile.ts';
import { shotCanvasDepthProblems, shotPlaneDepthRange, shotPlaneDepths } from './shot-depths.ts';
import { planShotKeyDrawings, shotKeyDrawingsAt, shotSourceMoments, type ShotKeyDrawings } from './shot-painting-in-time.ts';
import { shotCoveredPlanes, shotPlacementProblems, shotStillBackProblem } from './shot-placement.ts';
import { shotDrawableOrder } from './shot-plan.ts';
import type { CoverFrame, InstancedPlaneProps, OccurrenceKey, OccurrenceRig, PaintedShotProps, PictureSource, PlaneMask, PlaneProps, ScreenPin, ThreeSource } from './shot-props.ts';
import { shotCameraPlanes } from './shot-reach.ts';
import { compileShotRig, shotPlaneRigEndProblems, shotRigShowsGroup, type CompiledShotRig } from './shot-rigs.ts';
import { paintedPlaneBlendProblems, paintedSourceEnds, paintedSourceProblems, type PaintedSource, type PaintedSourceEnd, type ShotPlanePaints } from './shot-selection.ts';
import { shotVisibilityProblems } from './shot-visibility.ts';
import { shotWarmProblems, type ShotWarm } from './shot-warm.ts';

/**
 * Where a painted plane lies: a lay for all time (null: document px are plane px), one read at each moment, or laid
 * on the frame through the built camera, a pin or a cover. A cover is laid as the shot compiles, so a compiled shot's
 * screen lays are pins, laid where each frame measures their elements (shotPinnedPlanes).
 */
export type ShotPlaneLay =
  | { readonly kind: 'still'; readonly lay: StampGroupLay | null }
  | { readonly kind: 'moving'; readonly lay: (moment: PaintMoment) => StampGroupLay }
  | { readonly kind: 'screen'; readonly screen: ScreenPin | CoverFrame };

/** What every compiled plane holds: its id, its canvas, and its depth as a frame moment reads it (shotPlaneDepthValue). */
type ShotPlaneCommon = { readonly id: string; readonly depth: PresentationValue<number>; readonly canvas: number };

/**
 * A painted plane compiled: its source, read at `sourceClock`'s moment; a painting in time's plan (`keyDrawings`),
 * which its source then reads; its first evaluation's `ends` (a plan's every drawing), the size and ground all paint
 * and their occurrences; `opaqueBack`: laid on its root's paper wherever the frame shows (a clear back over HTML is
 * clear film).
 */
export type CompiledShotPaintedPlane = ShotPlaneCommon & {
  readonly kind: 'painted'; readonly source: PresentationValue<PaintedSource>; readonly keyDrawings: ShotKeyDrawings | null; readonly sourceClock: readonly PaintSceneStep[];
  readonly lay: ShotPlaneLay; readonly ends: readonly PaintedSourceEnd[]; readonly paints: ShotPlanePaints; readonly occurrences: readonly ShotOccurrence[];
  readonly opaqueBack: boolean; readonly masks: readonly PlaneMask[];
};

/** A picture or three plane compiled: its source, posed or pictured at `sourceClock`'s moment; a three plane at one depth. */
export type CompiledShotSourcePlane = ShotPlaneCommon & { readonly sourceClock: readonly PaintSceneStep[] } & (
  | { readonly kind: 'picture'; readonly source: PictureSource }
  | { readonly kind: 'three'; readonly source: ThreeSource; readonly depth: number }
);

export type CompiledShotPlane = CompiledShotPaintedPlane | CompiledShotSourcePlane;

/**
 * A shot compiled: its planes far to near, the back first; its instanced planes; both as `written`, which a frame
 * orders with its items; its canvas count; `clearBack`: the back is clear where it lays nothing, over HTML; its
 * motion, rigs, visibility by occurrence, masks' graph, camera, span, warm span (null: none) and painted textures.
 */
export type CompiledPaintedShot = {
  readonly span: SceneShownSpan;
  readonly planes: readonly CompiledShotPlane[];
  readonly instanced: readonly CompiledShotInstancedPlane[];
  readonly written: readonly (PlaneProps | InstancedPlaneProps)[];
  readonly canvases: number;
  readonly clearBack: boolean;
  readonly motion: CompiledShotMotion;
  readonly rigs: ReadonlyMap<OccurrenceKey, CompiledShotRig>;
  readonly visibility: ReadonlyMap<OccurrenceKey, PresentationValue<number>>;
  readonly masks: ShotMaskGraph;
  readonly camera: PaintCamera;
  readonly warm: ShotWarm | null;
  readonly paintedTextures: readonly CompiledShotPaintedTexture[];
};

/** What a compiled shot paints with, its planes and its painted textures alike: its brushes, and where its solves, readbacks and warnings count. */
export type PaintedShotPaintOptions = { readonly brushOf: PaintingBrushOf; readonly costs?: StampPaintCostTally };

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

/**
 * How a shot's canvas is laid on the page: `opaque`, hiding what's behind it; or as a `glaze` over the HTML behind,
 * a colour canvas over a filter canvas the page is multiplied by, so each channel of what's behind is taken apart.
 */
export type ShotCanvasLaying = 'opaque' | 'glaze';

/** How each of `shot`'s canvases is laid, in order: the first opaque, holding an opaque back; the rest, and a clear back's, as glazes. */
export const shotCanvasLayings = (shot: Pick<CompiledPaintedShot, 'canvases' | 'clearBack'>): ShotCanvasLaying[] =>
  Array.from({ length: shot.canvases }, (_, index) => (index === 0 && !shot.clearBack ? 'opaque' : 'glaze'));

/**
 * Why `shot` can't draw a frame over `page` as that frame finds it: a clear back with no HTML behind it. Its load's
 * frame had some, so HTML behind a clear back stays mounted while the shot draws.
 */
export function shotPageProblems(shot: CompiledPaintedShot, page: ShotPage): PaintingProblem[] {
  if (!shot.clearBack || page.htmlBehind) return [];
  return [shotError(shot.planes[0].id, 'source', 'is a clear back, and no HTML lies before the first canvas at this frame: HTML behind a clear back stays mounted while the shot draws')];
}

/**
 * Why plane `plane` can't be drawn as written: its id, a lay on a picture or three plane, a depth in time on a three
 * plane, its canvas or its clocks.
 */
function planePropsProblems(plane: PaintedShotProps['planes'][number], canvases: readonly string[]): PaintingProblem[] {
  const problems: PaintingProblem[] = [];
  if (!plane.id || plane.id.includes('/')) problems.push(shotError(plane.id, 'id', `${JSON.stringify(plane.id)} isn't a plane id: one holds no "/"`));
  if (plane.kind !== 'instanced') {
    const { lay, source } = plane;
    if (lay && typeof lay !== 'function' && 'kind' in lay) problems.push(...shotPlacementProblems(plane.id, lay));
    if (lay && typeof source !== 'function' && (source.kind === 'picture' || source.kind === 'three')) {
      problems.push(shotError(plane.id, 'lay', `is a ${source.kind} plane, which lies where its source puts it: a lay places a painted plane; move it by its node`));
    }
    if (typeof plane.depth === 'function' && typeof source !== 'function' && source.kind === 'three') {
      problems.push(shotError(plane.id, 'depth', 'is a three plane, whose scene stands at its depth in the world it shares: move what it shows in its scene (poseAt)'));
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

/** Plane `props`' lay: a pin or cover left to be laid through the built camera. */
function compilePlaneLay({ lay }: PlaneProps): ShotPlaneLay {
  if (typeof lay === 'function') return { kind: 'moving', lay };
  if (lay && 'kind' in lay) return { kind: 'screen', screen: lay };
  return { kind: 'still', lay: lay ?? null };
}

/**
 * Why `plane`'s moving lay can't lay it at one of `motion`'s moments, or none: a part not finite, a negative scale, or
 * on the back, which must hold the frame, a scale of 0.
 */
function movingLayProblems(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion): PaintingProblem[] {
  if (plane.lay.kind !== 'moving') return [];
  for (const moment of motion.moments) {
    const { placement, pivot } = plane.lay.lay(shotPlaneMomentAt(motion, plane.id, moment));
    const problem = paintPlacementMoveProblem(placement, plane.opaqueBack ? 'the back' : null) ?? (Number.isFinite(pivot.x) && Number.isFinite(pivot.y) ? null : `its pivot ${pivot.x}, ${pivot.y} isn't finite`);
    if (problem) return [shotError(plane.id, 'lay', `at ${paintSecondsText(moment.at)} ${problem}`)];
  }
  return [];
}

/**
 * Plane `props` (a painted one) compiled from its first evaluation, or a painting in time's plan, or null and its
 * problems, its source's at `field`. The farthest plane is the back, opaque; with a transparent ground over HTML
 * behind the first canvas, it's clear film instead.
 */
function compilePaintedPlane(
  props: PlaneProps, given: PresentationValue<PaintedSource> | ShotKeyDrawings, common: ShotPlaneCommon, farthest: boolean, page: ShotPage, fps: number,
  problems: PaintingProblem[], field = 'source',
): CompiledShotPaintedPlane | null {
  const sourceClock = paintNodeClockSteps(props.sourceClock);
  const keyDrawings = typeof given !== 'function' && given.kind === 'key-drawings' ? given : null;
  const source: PresentationValue<PaintedSource> = typeof given === 'function' || given.kind !== 'key-drawings' ? given : (moment) => shotKeyDrawingsAt(given, moment);
  const first = presentationValueAt(source, paintNodeTimeAt(sourceClock, paintMoment(0), fps));
  const sourceProblems = paintedSourceProblems(props.id, first, field);
  problems.push(...sourceProblems);
  if (sourceProblems.length) return null;
  const ends = keyDrawings?.ends ?? paintedSourceEnds(first, field), [{ selection: { painting: { document: { widthPx, heightPx } }, ground } }] = ends, paints = { widthPx, heightPx, ground };
  problems.push(...paintedPlaneBlendProblems(props.id, ends, paints));
  const clear = ground === 'transparent';
  if (farthest && clear && !page.htmlBehind) {
    problems.push(shotError(props.id, 'source.ground', 'is the back, laid on its paper wherever the frame shows: its ground is transparent only over HTML before the first canvas'));
  }
  return {
    ...common, kind: 'painted', source, keyDrawings, sourceClock, lay: compilePlaneLay(props), opaqueBack: farthest && !clear, ends, paints,
    occurrences: shotPlaneOccurrences(props.id, first), masks: props.masks ?? [],
  };
}

/**
 * Each rig compiled over its group occurrence, cut in the first of its plane's ends showing the group, every end held
 * to that cut; a rig inside another's group refused. `rigs` name occurrences of painted planes (shotPlaneEntries).
 */
function compileShotRigs(rigs: ReadonlyMap<OccurrenceKey, OccurrenceRig>, planes: readonly CompiledShotPlane[], problems: PaintingProblem[]) {
  const compiled = new Map<OccurrenceKey, CompiledShotRig>();
  const painted = new Map(planes.flatMap((plane) => (plane.kind === 'painted' ? [[plane.id, plane] as const] : [])));
  for (const [occurrence, rig] of rigs) {
    const plane = painted.get(shotOccurrencePlane(occurrence))!, found = plane.occurrences.find(({ key }) => key === occurrence)!;
    const outer = found.groups.find((group) => rigs.has(group));
    if (outer) {
      problems.push(shotEntryProblem('error', occurrence, 'rig', `lies in ${outer}, which is rigged: its parts pose all it holds, so nothing in it is rigged again`));
      continue;
    }
    // With no end showing it as a group, the first end's tree is where the rig finds it isn't one.
    const cutIn = plane.ends.find(({ selection }) => shotRigShowsGroup(selection, found.node)) ?? plane.ends[0];
    const made = compileShotRig(occurrence, plane.id, cutIn.selection.painting, rig);
    problems.push(...made.problems);
    if (made.rig) compiled.set(occurrence, made.rig);
  }
  for (const plane of planes) if (plane.kind === 'painted') problems.push(...shotPlaneRigEndProblems(compiled.values(), plane.id, plane.ends));
  return compiled;
}

/** Why `visibility` can't be drawn beyond its names and constants: it fades the opaque back (`opaqueBack`, its id). */
function visibilityBackProblems(visibility: ReadonlyMap<OccurrenceKey, PresentationValue<number>>, opaqueBack: string | null): PaintingProblem[] {
  return opaqueBack !== null && visibility.has(opaqueBack) ? [shotEntryProblem('error', opaqueBack, 'visibility', 'is the back, shown wherever the frame is: fade a nearer plane or its occurrences')] : [];
}

/**
 * Why an alphaOf mask can't read what it names: an occurrence inside a rig drawn as pieces (`rigs`), whose parts are
 * drawn as one picture, so no layer or group within shows apart from the rest.
 */
function maskPiecesProblems(planes: readonly CompiledShotPlane[], rigs: ReadonlyMap<OccurrenceKey, CompiledShotRig>): PaintingProblem[] {
  const occurrences = new Map(planes.flatMap((plane) => (plane.kind === 'painted' ? plane.occurrences.map((occurrence) => [occurrence.key, occurrence] as const) : [])));
  return planes.flatMap((plane) => (plane.kind === 'painted' ? plane.masks : []).flatMap((mask, i) => {
    const rig = occurrences.get(mask.drawable)?.groups.find((group) => rigs.get(group)?.pieces);
    return rig ? [shotError(plane.id, `masks[${i}].drawable`, `names ${mask.drawable}, inside ${rig}, drawn as pieces: read ${rig}`)] : [];
  }));
}

/**
 * `props` checked and compiled, drawn in `canvases` (the PaintedShotCanvas names, in document order; none for the
 * shot's own canvas) on `page`, a lens leaving its shutter out taking the film's at its span's fps: the compiled
 * shot, or null and every problem keeping it from being drawn.
 */
export function compilePaintedShot(
  props: PaintedShotProps, canvases: readonly string[], page: ShotPage = SHOT_NO_HTML_BEHIND,
): { readonly shot: CompiledPaintedShot | null; readonly problems: readonly PaintingProblem[] } {
  // Warnings found as planes compile, said beside a shot that draws: problems stop the stages after them.
  const problems: PaintingProblem[] = [], warnings: PaintingProblem[] = [], fps = props.camera.animationFps ?? PAINT_ANIMATION_FPS;
  // A texture reads no plane, so its problems join every answer, whichever stage the planes stop at.
  const textures = compileShotPaintedTextures(props.paintedTextures ?? []);
  const answer = (shot: CompiledPaintedShot | null, found: readonly PaintingProblem[]) => ({ shot, problems: [...found, ...textures.problems] });
  if (props.warm) problems.push(...shotWarmProblems(props.warm));
  const spanProblem = paintSpanProblem(props.span);
  if (spanProblem) problems.push(shotError('shot', 'span', spanProblem));
  canvases.forEach((name, index) => {
    if (canvases.indexOf(name) !== index) problems.push(shotError('shot', 'canvas', `names two of its canvases ${name}: each PaintedShotCanvas takes a name of its own`));
  });
  const ids = new Set<string>();
  for (const plane of props.planes) {
    if (ids.has(plane.id)) problems.push(shotError(plane.id, 'id', 'names two planes'));
    ids.add(plane.id);
    problems.push(...planePropsProblems(plane, canvases));
  }
  if (problems.length) return answer(null, problems);
  const written = new Map(props.planes.flatMap((plane) => (plane.kind === 'instanced' ? [] : [[plane.id, plane] as const])));
  if (!written.size) return answer(null, [shotError('shot', 'planes', 'has no planes: a shot draws its back at least')]);
  const cameraOptions = paintShotCameraOptions(props.camera, props.span, []);
  const frames = paintSpanFrames(props.span, paintCameraLensBuilt(cameraOptions.lens)), moments = paintSpanMoments(frames);
  const planeDepths = shotPlaneDepths(props.planes, moments, fps);
  if (planeDepths.problems.length) return answer(null, planeDepths.problems);
  // The farthest plane not instanced is the back, which keeps one depth; shotDrawableOrder places no items here.
  const canvasOf = (name: string | undefined) => (name === undefined ? 0 : canvases.indexOf(name));
  const planes = shotDrawableOrder(props.planes, new Map(), (plane) => shotPlaneDepthRange(plane, moments, fps).far).flatMap((drawable, index): CompiledShotPlane[] => {
    const plane = written.get(drawable.plane)!, canvas = canvasOf(plane.canvas);
    const common = { id: plane.id, depth: planeDepths.values.get(plane.id)!, canvas };
    const { source } = plane, sourceClock = paintNodeClockSteps(plane.sourceClock);
    if (typeof source !== 'function' && source.kind === 'picture') return [{ ...common, sourceClock, kind: 'picture', source }];
    // planePropsProblems refuses a three plane's depth in time.
    if (typeof source !== 'function' && source.kind === 'three') return typeof common.depth === 'number' ? [{ ...common, depth: common.depth, sourceClock, kind: 'three', source }] : [];
    if (typeof source !== 'function' && source.kind === 'in-time') {
      const planned = planShotKeyDrawings(plane.id, source, shotSourceMoments(props.span, sourceClock, fps));
      problems.push(...planned.problems.filter(({ severity }) => severity === 'error'));
      warnings.push(...planned.problems.filter(({ severity }) => severity === 'warning'));
      const painted = planned.plan && compilePaintedPlane(plane, planned.plan, common, index === 0, page, fps, problems);
      return painted ? [painted] : [];
    }
    const painted = compilePaintedPlane(plane, source, common, index === 0, page, fps, problems);
    return painted ? [painted] : [];
  });
  const [back] = planes, clearBack = !!back && (back.kind === 'painted' ? !back.opaqueBack : back.kind === 'three' || back.source.extent.kind !== 'everywhere');
  if (clearBack && !page.htmlBehind && back.kind === 'three') {
    problems.push(shotError(back.id, 'source', "is the farthest plane, and a three plane is the back only over HTML before the first canvas: the back is opaque to the frame's edge, painted or a picture"));
  }
  if (clearBack && !page.htmlBehind && back.kind === 'picture') {
    problems.push(shotError(back.id, 'source.extent', `is the back, a picture held ${back.source.extent.kind === 'box' ? 'within a box' : back.source.extent.kind}; the back's extent is everywhere, unless HTML lies before the first canvas`));
  }
  const backDepth = planeDepths.back, instanced = back && backDepth ? props.planes.flatMap((plane) => {
    if (plane.kind !== 'instanced') return [];
    const common = { id: plane.id, depth: plane.depths.far, canvas: canvasOf(plane.canvas) };
    // Each variant compiles as a painted plane does, under its instanced plane's id (CompiledShotVariant says why).
    const variants = Object.entries(plane.variants).map(([name, source]) =>
      [name, compilePaintedPlane({ id: plane.id, depth: plane.depths.far, source }, source, common, false, page, fps, problems, `variants.${name}`)] as const);
    const made = compileShotInstancedPlane(plane, common.canvas, backDepth, props.camera.stage, variants, problems);
    return made ? [made] : [];
  }) : [];
  if (canvases.length) {
    const places = [...planes.map(({ id, canvas, depth }) => ({ id, canvas, depth })), ...instanced.map(({ id, canvas, depths: range }) => ({ id, canvas, depth: range }))];
    problems.push(...shotCanvasDepthProblems(places, canvases, moments));
  }
  const motionPlanes = [
    ...planes.map((plane): ShotMotionPlane => ({
      id: plane.id, kind: plane.kind, clock: paintNodeClockSteps(written.get(plane.id)!.clock), movingLay: plane.kind === 'painted' && plane.lay.kind === 'moving',
      occurrences: plane.kind === 'painted' ? plane.occurrences : [],
    })),
    // An instanced plane for its clock, which its items' moment reads (shotPlaneMomentAt): its entry writes no node.
    ...props.planes.flatMap((plane): ShotMotionPlane[] => (plane.kind === 'instanced' ? [{ id: plane.id, kind: 'instanced', clock: paintNodeClockSteps(plane.clock), movingLay: false, occurrences: [] }] : [])),
  ];
  const entries = shotPlaneEntries(props.planes, motionPlanes, problems), { visibility } = entries;
  const rigs = compileShotRigs(entries.rigs, planes, problems);
  const occurrences = new Map(planes.flatMap((plane) => (plane.kind === 'painted' ? [[plane.id, plane.occurrences.map(({ key }) => key)] as const] : [])));
  problems.push(...shotVisibilityProblems(visibility), ...visibilityBackProblems(visibility, back && !clearBack ? back.id : null));
  const masks = shotMaskCheck(props.planes, occurrences);
  problems.push(...masks.problems, ...maskPiecesProblems(planes, rigs));
  const motion = compileShotMotion(motionPlanes, entries.motion, new Set(rigs.keys()), fps, moments);
  problems.push(...motion.problems);
  for (const plane of planes) if (plane.kind === 'painted') problems.push(...movingLayProblems(plane, motion.motion));
  if (problems.length || !masks.graph || !textures.textures) return answer(null, problems);
  // Planes laid on the frame are unchecked in the build, which they're laid through; covers are laid and checked after it.
  const cameraPlanes = [...shotCameraPlanes(planes, motion.motion, rigs), ...instanced.map(({ id, depths }) => ({ id, kind: 'instanced' as const, depths }))];
  const built = buildPaintCamera({ ...cameraOptions, planes: cameraPlanes, animationFps: fps });
  if (!built.ok) return answer(null, built.problems.map((message) => shotError('camera', '', message)));
  const setting = { camera: built.camera, motion: motion.motion, rigs }, covered = shotCoveredPlanes(setting, planes);
  // A back laid still is held to all the frame reads of it here; a cover is as it's laid, a callback's lay each frame.
  const bare = back?.kind === 'painted' && back.lay.kind === 'still' && shotStillBackProblem(setting, back, back.lay.lay);
  const laidProblems = [...covered.problems, ...(bare ? [shotError(back.id, 'lay', bare)] : [])];
  if (laidProblems.length) return answer(null, laidProblems);
  const shot: CompiledPaintedShot = {
    span: props.span, planes: covered.planes, instanced, written: props.planes, canvases: Math.max(1, canvases.length), clearBack, motion: motion.motion, rigs,
    visibility, masks: masks.graph, camera: built.camera, warm: props.warm ?? null,
    paintedTextures: textures.textures,
  };
  return answer(shot, [...problems, ...warnings, ...shotMotionWarnings(shot, frames)]);
}
