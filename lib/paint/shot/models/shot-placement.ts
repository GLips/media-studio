// shot-placement.ts: where a plane laid on the frame lies, worked back through the camera. A plane's lay takes its
// document px to plane px and the camera's view takes plane px to frame px, so a lay meant to land on frame px (an
// HTML element's centre, the frame's corners) is found through the view's inverse, as the camera stands at the lay's
// own scene second. Covers and pins are laid alike, after the camera is built (shotScreenLaid), and checked where
// they then lie by the build's own rule: a cover once, as the shot compiles; a pin at each frame, as its elements are
// measured. Also the DOM adapter's arithmetic: an element's measured box as a frame-px centre.

import { paintCameraPictureProblem } from '#lib/paint/animation/models/paint-camera-build.ts';
import { paintPlaneViewAt } from '#lib/paint/animation/models/paint-camera.ts';
import {
  paintPlacementOfSimilarity, paintSimilarityApply, paintSimilarityInverse, paintSimilarityThrough, type PaintSimilarity,
} from '#lib/paint/animation/models/paint-similarity.ts';
import { isPaintingFinitePoint, paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { paintMoment, type StampGroupLay } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane, CompiledShotPlane } from './shot-compile.ts';
import type { CoverFrame, ScreenPin } from './shot-props.ts';
import { shotBarePaperProblem, type ShotBackLaying } from './shot-back.ts';
import { shotPaintedCameraPlane } from './shot-reach.ts';

/**
 * The lay covering a frame `frame` px with `box` (document px), seen through `view` (paintPlaneViewAt at the cover's
 * `at`): the box's centre on the frame centre's place and the box scaled about its centre, unturned, until it holds
 * every frame corner's place. A rolled camera's frame is turned on the plane, so the box grows to hold its corners.
 */
export function shotCoverLay(box: StampBox, view: PaintSimilarity, frame: StampStage['frame']): StampGroupLay {
  const onPlane = paintSimilarityInverse(view), { width, height } = frame;
  const centre = paintSimilarityApply(onPlane, { x: width / 2, y: height / 2 }), pivot = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  const halfW = (box.x1 - box.x0) / 2, halfH = (box.y1 - box.y0) / 2;
  const frameCorners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  const scale = Math.max(...frameCorners.map((corner) => {
    const at = paintSimilarityApply(onPlane, corner);
    return Math.max(Math.abs(at.x - centre.x) / halfW, Math.abs(at.y - centre.y) / halfH);
  }));
  return { placement: { x: centre.x - pivot.x, y: centre.y - pivot.y, rotation: 0, scale }, pivot };
}

/**
 * The lay putting a pin's document points (`sources`, sourcePx) on its elements' measured `centres` (frame px), seen
 * through `view` (paintPlaneViewAt at the pin's `at`): one point moves the plane; two move, scale and turn it, the
 * similarity taking both. The centres are worked back to plane px through the view first.
 */
export function shotPinLay(sources: readonly StampPoint[], centres: readonly StampPoint[], view: PaintSimilarity): StampGroupLay {
  const onPlane = paintSimilarityInverse(view), [to0, to1] = centres.map((centre) => paintSimilarityApply(onPlane, centre)), [from0, from1] = sources;
  if (!from1 || !to1) return { placement: { x: to0.x - from0.x, y: to0.y - from0.y, rotation: 0, scale: 1 }, pivot: from0 };
  return { placement: paintPlacementOfSimilarity(paintSimilarityThrough([from0, from1], [to0, to1]), from0), pivot: from0 };
}

/** What keeps plane `plane`'s pin or cover from ever laying it, found as the shot loads. */
export function shotPlacementProblems(plane: string, lay: ScreenPin | CoverFrame): PaintingProblem[] {
  const problems: PaintingProblem[] = [], error = (field: string, message: string) => problems.push(paintingProblem('error', plane, field, message));
  if (lay.at !== undefined && !Number.isFinite(lay.at)) error('lay.at', `${lay.at} isn't a finite scene second`);
  if (lay.kind === 'cover') {
    const { x0, y0, x1, y1 } = lay.box;
    if (![x0, y0, x1, y1].every(Number.isFinite) || !(x1 > x0 && y1 > y0)) error('lay.box', `${x0}..${x1} × ${y0}..${y1} holds nothing to cover the frame with`);
    return problems;
  }
  const { points } = lay;
  points.forEach(({ sourcePx, element }, i) => {
    if (!isPaintingFinitePoint(sourcePx)) error(`lay.points[${i}].sourcePx`, `${sourcePx.x}, ${sourcePx.y} isn't a finite point`);
    if (!element.trim()) error(`lay.points[${i}].element`, `${JSON.stringify(element)} names no element: give the element data-pin="…" and name it here`);
  });
  const [a, b] = points;
  if (b && a.sourcePx.x === b.sourcePx.x && a.sourcePx.y === b.sourcePx.y) error('lay.points', `both pin ${a.sourcePx.x}, ${a.sourcePx.y}: two points set a scale and turn only apart`);
  if (b && a.element === b.element) error('lay.points', `both pin to ${a.element}: two points set a scale and turn only on two elements`);
  return problems;
}

/**
 * What keeps plane `plane`'s pin from laying it once measured: `centres` holds each point's element's centre (frame
 * px), null where the element isn't mounted. Two elements centred on one place set no scale or turn.
 */
export function shotPinMeasureProblems(plane: string, centres: readonly (StampPoint | null)[]): PaintingProblem[] {
  const problems = centres.flatMap((centre, i) => (centre ? [] : [paintingProblem('error', plane, `lay.points[${i}].element`, "isn't mounted: a pin lies on its element's centre once laid out")]));
  const [a, b] = centres;
  if (a && b && a.x === b.x && a.y === b.y) problems.push(paintingProblem('error', plane, 'lay.points', `both elements are centred at ${a.x}, ${a.y} px: two points set a scale and turn only apart`));
  return problems;
}

/** Each pinned plane's elements' centres as a frame measures them, frame px by plane id: null where one isn't mounted. */
export type ShotPinCentres = ReadonlyMap<string, readonly (StampPoint | null)[]>;

/** What a plane laid on the frame is laid through and checked against: its shot's built camera, motion and rigs. */
export type ShotScreenSetting = Pick<CompiledPaintedShot, 'camera' | 'motion' | 'rigs'>;

/**
 * Plane `plane` laid on the frame: `layThrough` given the camera's view of the plane at scene second `at`, then
 * checked where it lies as the camera build checks a plane (paintCameraPictureProblem), the back's painting against
 * all the frame reads of it as `laying` words its fix (shotBarePaperProblem). The plane laid still, or why it can't
 * lie there.
 */
function shotScreenLaid(
  setting: ShotScreenSetting, plane: CompiledShotPaintedPlane, at: number, layThrough: (view: PaintSimilarity) => StampGroupLay,
  laying: (lay: StampGroupLay, view: PaintSimilarity) => ShotBackLaying,
): { readonly plane: CompiledShotPaintedPlane } | { readonly problem: PaintingProblem } {
  const { camera, motion, rigs } = setting, view = paintPlaneViewAt(camera, plane.depth, paintMoment(at)), lay = layThrough(view);
  const laid: CompiledShotPaintedPlane = { ...plane, lay: { kind: 'still', lay } };
  const problem = paintCameraPictureProblem(camera, shotPaintedCameraPlane(laid, motion, new Set(rigs.keys()))) ?? shotBarePaperProblem(setting, plane, laying(lay, view));
  return problem ? { problem: paintingProblem('error', plane.id, 'lay', problem) } : { plane: laid };
}

/**
 * `planes` with each cover laid (shotCoverLay) through the built camera at its second, as the shot compiles; or what
 * keeps one from lying there.
 */
export function shotCoveredPlanes(setting: ShotScreenSetting, planes: readonly CompiledShotPlane[]): { readonly planes: readonly CompiledShotPlane[]; readonly problems: readonly PaintingProblem[] } {
  const problems: PaintingProblem[] = [];
  const covered = planes.map((plane) => {
    if (plane.kind !== 'painted' || plane.lay.kind !== 'screen' || plane.lay.screen.kind !== 'cover') return plane;
    const { box, at = 0 } = plane.lay.screen, { frame } = setting.camera.stage;
    const laid = shotScreenLaid(setting, plane, at, (view) => shotCoverLay(box, view, frame), (lay, view) => ({ kind: 'cover', lay, box, relaid: (other) => shotCoverLay(other, view, frame) }));
    if ('problem' in laid) problems.push(laid.problem);
    return 'plane' in laid ? laid.plane : plane;
  });
  return { planes: covered, problems };
}

/**
 * `shot`'s pinned planes laid where `centres` put their elements (shotPinLay, through the camera's view at each pin's
 * second); or what keeps one from lying there: an element unmeasured or unmounted, two centred alike, paint past the
 * stage.
 */
export function shotPinnedPlanes(shot: CompiledPaintedShot, centres: ShotPinCentres): { readonly planes: ReadonlyMap<string, CompiledShotPaintedPlane>; readonly problems: readonly PaintingProblem[] } {
  const planes = new Map<string, CompiledShotPaintedPlane>(), problems: PaintingProblem[] = [];
  for (const plane of shot.planes) {
    if (plane.kind !== 'painted' || plane.lay.kind !== 'screen' || plane.lay.screen.kind !== 'pin') continue;
    const { points, at = 0 } = plane.lay.screen, measured = centres.get(plane.id) ?? points.map(() => null);
    const measureProblems = shotPinMeasureProblems(plane.id, measured), found = measured.flatMap((centre) => (centre ? [centre] : []));
    problems.push(...measureProblems);
    if (measureProblems.length) continue;
    const sources = points.map(({ sourcePx }) => sourcePx);
    const laid = shotScreenLaid(shot, plane, at, (view) => shotPinLay(sources, found, view), (lay) => ({ kind: 'pin', lay, sources }));
    if ('problem' in laid) problems.push(laid.problem);
    else planes.set(plane.id, laid.plane);
  }
  return { planes, problems };
}

/** A box as the DOM measures one (`getBoundingClientRect`), in the page's px. */
export type ShotDomBox = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

/**
 * `element`'s centre in frame px, measured against `shot`, the PaintedShot element's box: the shot's element is
 * `frame` px, scaled to fill its box, so the page's px divide by that scale, each axis by its own should the fill
 * stretch. Any transform above it (a player's) scales both boxes alike and cancels.
 */
export function shotDomCentre(element: ShotDomBox, shot: ShotDomBox, frame: StampStage['frame']): StampPoint {
  return {
    x: ((element.left + element.width / 2 - shot.left) * frame.width) / shot.width,
    y: ((element.top + element.height / 2 - shot.top) * frame.height) / shot.height,
  };
}
