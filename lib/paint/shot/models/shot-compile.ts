// shot-compile.ts: a PaintedShot's props checked and compiled as it loads: planes far to near, each on its
// canvas; painted planes' occurrences from their first evaluation, at moment 0; instanced planes' variants; the
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
import type { GroupKey } from '#lib/paint/document/models/painting-document.ts';
import { paintingField, paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { PAPER_KEY_LIGHT, paintLightProblem, type PaintLight } from '#lib/paint/painting/models/stamp-form.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { paintMoment, type PaintMoment, type StampGroupLay } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';
import { compiledShotEffect, shotEffectChecked, shotEffectReadMap, shotImageLeaves, type CompiledShotEffectImage, type CompiledShotEffectRead, type CompiledShotImage, type ShotImageSource } from './shot-effect.ts';
import { shotFigureProblems } from './shot-figure.ts';
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
 * Where a plane's image lies, its placement half: its lay, document px to plane px, through which its image is drawn
 * into plane px; `opaqueBack`: laid on its root's paper wherever the frame shows (a clear back over HTML is clear film).
 */
export type ShotPlanePlacement = ShotPlaneCommon & { readonly lay: ShotPlaneLay; readonly opaqueBack: boolean };

/**
 * A painted image compiled, its image half: its source, read at `sourceClock`'s moment; a painting in time's plan
 * (`keyDrawings`), which its source then reads; its first evaluation's `ends` (a plan's every drawing), the size and
 * ground all paint and their occurrences; its masks.
 */
export type CompiledShotPaintedImage = {
  readonly source: PresentationValue<PaintedSource>; readonly keyDrawings: ShotKeyDrawings | null; readonly sourceClock: readonly PaintSceneStep[];
  readonly ends: readonly PaintedSourceEnd[]; readonly paints: ShotPlanePaints; readonly occurrences: readonly ShotOccurrence[]; readonly masks: readonly PlaneMask[];
  /** The figure card group it holds when its source is a figure (shot-figure.ts), its silhouette's; null for any other selection. */
  readonly figure: GroupKey | null;
};

/**
 * A painted image laid through a placement: what a frame solves and lays. A painted plane places its own; an effect's
 * input is laid through its effect plane's placement, under that plane's id, so the plane's entries move it, and
 * isn't `placed`: the effect's output takes the plane's visibility, not each input (shot-effect.ts).
 */
export type CompiledShotPaintedPlane = ShotPlanePlacement & CompiledShotPaintedImage & { readonly kind: 'painted'; readonly placed: boolean };

/**
 * A plane placing an effect's image (shot-effect.ts): its placement, which its inputs are drawn through, and the
 * occurrences they show, each key once, which its entries name.
 */
export type CompiledShotEffectPlane = ShotPlanePlacement & { readonly kind: 'effect'; readonly image: CompiledShotEffectImage; readonly occurrences: readonly ShotOccurrence[] };

/** A picture or three plane compiled: its source, posed or pictured at `sourceClock`'s moment; a three plane at one depth. */
export type CompiledShotSourcePlane = ShotPlaneCommon & { readonly sourceClock: readonly PaintSceneStep[] } & (
  | { readonly kind: 'picture'; readonly source: PictureSource }
  | { readonly kind: 'three'; readonly source: ThreeSource; readonly depth: number }
);

export type CompiledShotPlane = CompiledShotPaintedPlane | CompiledShotEffectPlane | CompiledShotSourcePlane;

/** The painted images plane `plane` lays: its own, an effect's inputs (each once), or none for a picture or three plane. */
export function shotPlaneLeaves(plane: CompiledShotPlane): readonly CompiledShotPaintedPlane[] {
  if (plane.kind === 'painted') return [plane];
  return plane.kind === 'effect' ? shotImageLeaves(plane.image) : [];
}

/**
 * A shot compiled: its planes far to near, the back first; its instanced planes; both as `written`, which a frame
 * orders with its items; its canvas count; `clearBack`: the back is clear where it lays nothing, over HTML; its
 * motion, rigs, visibility by occurrence, masks' graph, camera, light, span, warm span (null: none) and painted textures.
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
  readonly light: PaintLight;
  readonly warm: ShotWarm | null;
  readonly paintedTextures: readonly CompiledShotPaintedTexture[];
};

/** What a compiled shot paints with, its planes and its painted textures alike: its brushes, and where its solves, readbacks and warnings count. */
export type PaintedShotPaintOptions = { readonly brushOf: PaintingBrushOf; readonly costs?: StampPaintCostTally };

/**
 * What of `shot` a frame solves, and a warm would: its painted planes and its effect planes' inputs, then each
 * instanced plane's variants. A variant carries its instanced plane's id (CompiledShotVariant), as an effect's input
 * carries its effect plane's, so whatever is kept per solvable is keyed by object.
 */
export function shotPaintedSolvables(shot: Pick<CompiledPaintedShot, 'planes' | 'instanced'>): CompiledShotPaintedPlane[] {
  return [...shot.planes.flatMap(shotPlaneLeaves), ...shot.instanced.flatMap(({ variants }) => [...variants.values()].map((variant) => variant.painted))];
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
function movingLayProblems(plane: ShotPlanePlacement, motion: CompiledShotMotion): PaintingProblem[] {
  if (plane.lay.kind !== 'moving') return [];
  for (const moment of motion.moments) {
    const { placement, pivot } = plane.lay.lay(shotPlaneMomentAt(motion, plane.id, moment));
    const problem = paintPlacementMoveProblem(placement, plane.opaqueBack ? 'the back' : null) ?? (Number.isFinite(pivot.x) && Number.isFinite(pivot.y) ? null : `its pivot ${pivot.x}, ${pivot.y} isn't finite`);
    if (problem) return [shotError(plane.id, 'lay', `at ${paintSecondsText(moment.at)} ${problem}`)];
  }
  return [];
}

/**
 * Plane `props` (a painted one) compiled from its first evaluation or a painting in time's plan, or null and its
 * problems, its source's at `field`. The farthest plane is the back, opaque; with a transparent ground over HTML
 * behind the first canvas, it's clear film. An effect's input isn't `placed`: it takes its plane's lay, not its masks.
 */
function compilePaintedPlane(
  props: PlaneProps, given: PresentationValue<PaintedSource> | ShotKeyDrawings, common: ShotPlaneCommon, farthest: boolean, page: ShotPage, fps: number,
  problems: PaintingProblem[], field = 'source', figure: GroupKey | null = null, placed = true,
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
  if (figure !== null) problems.push(...shotFigureProblems(props.id, figure, ends));
  const clear = ground === 'transparent';
  if (farthest && clear && !page.htmlBehind) {
    problems.push(shotError(props.id, 'source.ground', 'is the back, laid on its paper wherever the frame shows: its ground is transparent only over HTML before the first canvas'));
  }
  return {
    ...common, kind: 'painted', placed, source, keyDrawings, sourceClock, lay: compilePlaneLay(props), opaqueBack: farthest && !clear, ends, paints,
    occurrences: shotPlaneOccurrences(props.id, first), masks: placed ? props.masks ?? [] : [], figure,
  };
}

/** What compiling a plane's image reads beside its source: the plane as written, its common fields, the page, fps and span's source moments. */
type ShotImageCompiling = {
  readonly props: PlaneProps; readonly common: ShotPlaneCommon; readonly page: ShotPage; readonly fps: number; readonly span: PaintedShotProps['span'];
  readonly problems: PaintingProblem[]; readonly warnings: PaintingProblem[];
};

/**
 * `source`, written at `field` of plane `props`, compiled as an effect's input, `reader` the effect reading it: a
 * painted image laid through the plane's placement, unplaced, or an effect's image, its inputs compiled in turn. Null
 * when it can't be drawn, its problems said: a painted one on a paper ground, which an effect can't read colour and
 * transmittance from.
 */
function compileEffectInput(source: ShotImageSource, field: string, reader: string, at: ShotImageCompiling): CompiledShotImage | null {
  const { props, common, page, fps, problems } = at;
  if (typeof source !== 'function' && source.kind === 'effect') return compileEffectImage(source, field, at);
  const figure = typeof source !== 'function' && source.kind === 'figure' ? source.card : null;
  const painted = typeof source !== 'function' && source.kind === 'figure' ? source.source : source;
  let given: PresentationValue<PaintedSource> | ShotKeyDrawings;
  if (typeof painted !== 'function' && painted.kind === 'in-time') {
    const planned = planShotKeyDrawings(props.id, painted, shotSourceMoments(at.span, paintNodeClockSteps(props.sourceClock), fps));
    problems.push(...planned.problems.filter(({ severity }) => severity === 'error'));
    at.warnings.push(...planned.problems.filter(({ severity }) => severity === 'warning'));
    if (!planned.plan) return null;
    given = planned.plan;
  } else given = painted;
  const leaf = compilePaintedPlane(props, given, common, false, page, fps, problems, field, figure, false);
  if (leaf && leaf.paints.ground !== 'transparent') {
    problems.push(shotError(props.id, field, `lays its paper ground, and ${reader} reads colour and transmittance: select it with ground: 'transparent', as a figure lies`));
    return null;
  }
  return leaf;
}

/**
 * Effect image `image`, written at `field` of plane `props`, compiled: its parameters checked (shotEffectChecked),
 * each input compiled once, and its reads over them. Null when any of it can't be drawn, every problem said.
 */
function compileEffectImage(image: Extract<ShotImageSource, { readonly kind: 'effect' }>, field: string, at: ShotImageCompiling): CompiledShotEffectImage | null {
  const { definition } = image, checked = shotEffectChecked(at.props.id, field, image);
  at.problems.push(...checked.problems);
  const inputs = new Map(definition.inputs.flatMap((name) => {
    const given = image.inputs[name];
    return given === undefined ? [] : [[name, compileEffectInput(given, paintingField(field, `inputs.${name}`), definition.name, at)] as const];
  }));
  if (checked.problems.length || [...inputs.values()].some((input) => input === null)) return null;
  const reads = checked.reads.map((read): CompiledShotEffectRead => ({ input: inputs.get(read.input)!, map: shotEffectReadMap(read), moment: read.moment ?? null }));
  return compiledShotEffect(definition, checked.params, reads, checked.grow);
}

/**
 * Plane `props`, placing effect image `image`, compiled: its placement, and its inputs' occurrences, each key once.
 * Refused: the back, which is opaque to the frame's edge; masks, which cut a painted plane's films as they're laid;
 * a pin or cover, laid through the camera only for a painted plane.
 */
function compileEffectPlane(image: Extract<ShotImageSource, { readonly kind: 'effect' }>, farthest: boolean, at: ShotImageCompiling): CompiledShotEffectPlane | null {
  const { props, common, problems } = at, { lay } = props;
  if (farthest) problems.push(shotError(props.id, 'source', `is the farthest plane, the back, and ${image.definition.name}'s output is clear film: place it nearer than a painted back or a picture`));
  if (props.masks?.length) problems.push(shotError(props.id, 'masks', `places ${image.definition.name}'s output, and masks cut a painted plane's films as it lays them: mask what the effect reads`));
  if (lay && typeof lay !== 'function' && 'kind' in lay) problems.push(shotError(props.id, 'lay', `places ${image.definition.name}'s output, and a ${lay.kind} lays only a painted plane: lay it by a lay or a value in time`));
  const compiled = compileEffectImage(image, 'source', at);
  if (!compiled || farthest || props.masks?.length || (lay && typeof lay !== 'function' && 'kind' in lay)) return null;
  const occurrences = new Map(shotImageLeaves(compiled).flatMap(({ occurrences: shown }) => shown.map((occurrence) => [occurrence.key, occurrence] as const)));
  return { ...common, kind: 'effect', lay: compilePlaneLay(props), opaqueBack: false, image: compiled, occurrences: [...occurrences.values()] };
}

/**
 * Each rig compiled over its group occurrence, cut in the first of its plane's ends showing the group, every end held
 * to that cut; a rig inside another's group refused. `rigs` name occurrences of painted planes (shotPlaneEntries).
 */
function compileShotRigs(rigs: ReadonlyMap<OccurrenceKey, OccurrenceRig>, planes: readonly CompiledShotPlane[], problems: PaintingProblem[]) {
  const compiled = new Map<OccurrenceKey, CompiledShotRig>();
  const painted = new Map(planes.flatMap((plane) => (plane.kind === 'painted' || plane.kind === 'effect' ? [[plane.id, plane] as const] : [])));
  for (const [occurrence, rig] of rigs) {
    const plane = painted.get(shotOccurrencePlane(occurrence))!, found = plane.occurrences.find(({ key }) => key === occurrence)!;
    const ends = shotPlaneLeaves(plane).flatMap((leaf) => leaf.ends);
    const outer = found.groups.find((group) => rigs.has(group));
    if (outer) {
      problems.push(shotEntryProblem('error', occurrence, 'rig', `lies in ${outer}, which is rigged: its parts pose all it holds, so nothing in it is rigged again`));
      continue;
    }
    // With no end showing it as a group, the first end's tree is where the rig finds it isn't one.
    const cutIn = ends.find(({ selection }) => shotRigShowsGroup(selection, found.node)) ?? ends[0];
    const made = compileShotRig(occurrence, plane.id, cutIn.selection.painting, rig);
    problems.push(...made.problems);
    if (made.rig) compiled.set(occurrence, made.rig);
  }
  for (const leaf of planes.flatMap(shotPlaneLeaves)) problems.push(...shotPlaneRigEndProblems(compiled.values(), leaf.id, leaf.ends));
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

/** Why an alphaOf mask can't read what it names: a plane placing an effect, or an occurrence on one, whose output gathers no coverage. */
function maskEffectProblems(planes: readonly CompiledShotPlane[]): PaintingProblem[] {
  const effects = new Set(planes.flatMap((plane) => (plane.kind === 'effect' ? [plane.id] : [])));
  return planes.flatMap((plane) => (plane.kind === 'painted' ? plane.masks : []).flatMap((mask, i) => {
    const on = shotOccurrencePlane(mask.drawable);
    return effects.has(on) ? [shotError(plane.id, `masks[${i}].drawable`, `names ${mask.drawable}, on ${on}, which places an effect's output: an effect gathers no coverage a mask reads`)] : [];
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
  const lightProblem = props.light && paintLightProblem(props.light);
  if (lightProblem) problems.push(shotError('shot', 'light', lightProblem));
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
    if (typeof plane.source !== 'function' && plane.source.kind === 'effect') {
      const effect = compileEffectPlane(plane.source, index === 0, { props: plane, common, page, fps, span: props.span, problems, warnings });
      return effect ? [effect] : [];
    }
    // A figure places the selection it holds, as that selection on the plane would (shot-figure.ts).
    const given = plane.source, figure = typeof given !== 'function' && given.kind === 'figure' ? given : null;
    const source = typeof given !== 'function' && given.kind === 'figure' ? given.source : given, sourceClock = paintNodeClockSteps(plane.sourceClock);
    if (typeof source !== 'function' && source.kind === 'picture') return [{ ...common, sourceClock, kind: 'picture', source }];
    // planePropsProblems refuses a three plane's depth in time.
    if (typeof source !== 'function' && source.kind === 'three') return typeof common.depth === 'number' ? [{ ...common, depth: common.depth, sourceClock, kind: 'three', source }] : [];
    if (typeof source !== 'function' && source.kind === 'in-time') {
      const planned = planShotKeyDrawings(plane.id, source, shotSourceMoments(props.span, sourceClock, fps));
      problems.push(...planned.problems.filter(({ severity }) => severity === 'error'));
      warnings.push(...planned.problems.filter(({ severity }) => severity === 'warning'));
      const painted = planned.plan && compilePaintedPlane(plane, planned.plan, common, index === 0, page, fps, problems, 'source', figure?.card ?? null);
      return painted ? [painted] : [];
    }
    const painted = compilePaintedPlane(plane, source, common, index === 0, page, fps, problems, 'source', figure?.card ?? null);
    return painted ? [painted] : [];
  });
  // An effect plane is refused as the back (compileEffectPlane): its output is clear film.
  const [back] = planes, clearBack = !!back && (back.kind === 'painted' ? !back.opaqueBack : back.kind !== 'picture' || back.source.extent.kind !== 'everywhere');
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
      // An effect plane shows its inputs' layers and groups as a painted plane shows its own.
      id: plane.id, kind: plane.kind === 'effect' ? 'painted' : plane.kind, clock: paintNodeClockSteps(written.get(plane.id)!.clock),
      movingLay: (plane.kind === 'painted' || plane.kind === 'effect') && plane.lay.kind === 'moving', occurrences: plane.kind === 'painted' || plane.kind === 'effect' ? plane.occurrences : [],
    })),
    // An instanced plane for its clock, which its items' moment reads (shotPlaneMomentAt): its entry writes no node.
    ...props.planes.flatMap((plane): ShotMotionPlane[] => (plane.kind === 'instanced' ? [{ id: plane.id, kind: 'instanced', clock: paintNodeClockSteps(plane.clock), movingLay: false, occurrences: [] }] : [])),
  ];
  const entries = shotPlaneEntries(props.planes, motionPlanes, problems), { visibility } = entries;
  const rigs = compileShotRigs(entries.rigs, planes, problems);
  const occurrences = new Map(planes.flatMap((plane) => (plane.kind === 'painted' || plane.kind === 'effect' ? [[plane.id, plane.occurrences.map(({ key }) => key)] as const] : [])));
  problems.push(...shotVisibilityProblems(visibility), ...visibilityBackProblems(visibility, back && !clearBack ? back.id : null));
  const masks = shotMaskCheck(props.planes, occurrences);
  problems.push(...masks.problems, ...maskPiecesProblems(planes, rigs), ...maskEffectProblems(planes));
  const motion = compileShotMotion(motionPlanes, entries.motion, new Set(rigs.keys()), fps, moments);
  problems.push(...motion.problems);
  for (const plane of planes) if (plane.kind === 'painted' || plane.kind === 'effect') problems.push(...movingLayProblems(plane, motion.motion));
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
    visibility, masks: masks.graph, camera: built.camera, light: props.light ?? PAPER_KEY_LIGHT, warm: props.warm ?? null,
    paintedTextures: textures.textures,
  };
  return answer(shot, [...problems, ...warnings, ...shotMotionWarnings(shot, frames)]);
}
