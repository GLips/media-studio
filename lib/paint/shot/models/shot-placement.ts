// shot-placement.ts: where a pinned or covering plane lies, worked back through the camera. A plane's lay takes its
// document px to plane px and the camera's view takes plane px to frame px, so a lay meant to land on frame px (an
// HTML element's centre, the frame's corners) is found through the view's inverse, as the camera stands at the lay's
// own scene second. Also the DOM adapter's arithmetic: an element's measured box as a frame-px centre.

import { paintCameraPoseAt, paintPlaneSimilarity, paintStageCentre, type PaintCamera } from '#lib/paint/animation/models/paint-camera.ts';
import {
  paintPlacementOfSimilarity, paintSimilarityApply, paintSimilarityInverse, paintSimilarityOf, type PaintSimilarity,
} from '#lib/paint/animation/models/paint-similarity.ts';
import { isPaintingFinitePoint, paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { paintMoment, type StampGroupLay } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampPolygonBox, type StampBox, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { CoverFrame, ScreenPin } from './shot-props.ts';

/** A plane `depth` deep as the camera shows it at scene second `at`: plane px to frame px. */
export function shotPlaneViewAt(camera: PaintCamera, depth: number, at: number): PaintSimilarity {
  return paintPlaneSimilarity(paintCameraPoseAt(camera, paintMoment(at)), depth, paintStageCentre(camera.stage));
}

const boxCorners = ({ x0, y0, x1, y1 }: StampBox): StampPoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** The box round `box` (document px) laid by `lay`: where it lies in plane px, the box a camera's reach check takes. */
export function shotLaidBox({ placement, pivot }: StampGroupLay, box: StampBox): StampBox {
  const laid = paintSimilarityOf(placement, pivot);
  return stampPolygonBox(boxCorners(box).map((corner) => paintSimilarityApply(laid, corner)));
}

/**
 * The lay covering a frame `frame` px with `box` (document px), seen through `view` (shotPlaneViewAt at the cover's
 * `at`): the box's centre on the frame centre's place and the box scaled about its centre, unturned, until it holds
 * every frame corner's place. A rolled camera's frame is turned on the plane, so the box grows to hold its corners.
 */
export function shotCoverLay(box: StampBox, view: PaintSimilarity, frame: { readonly width: number; readonly height: number }): StampGroupLay {
  const onPlane = paintSimilarityInverse(view), { width, height } = frame;
  const centre = paintSimilarityApply(onPlane, { x: width / 2, y: height / 2 }), pivot = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  const halfW = (box.x1 - box.x0) / 2, halfH = (box.y1 - box.y0) / 2;
  const scale = Math.max(...boxCorners({ x0: 0, y0: 0, x1: width, y1: height }).map((corner) => {
    const at = paintSimilarityApply(onPlane, corner);
    return Math.max(Math.abs(at.x - centre.x) / halfW, Math.abs(at.y - centre.y) / halfH);
  }));
  return { placement: { x: centre.x - pivot.x, y: centre.y - pivot.y, rotation: 0, scale }, pivot };
}

/**
 * The lay putting a pin's document points (`sources`, sourcePx) on its elements' measured `centres` (frame px), seen
 * through `view` (shotPlaneViewAt at the pin's `at`): one point moves the plane; two move, scale and turn it, the
 * similarity taking both. The centres are worked back to plane px through the view first.
 */
export function shotPinLay(sources: readonly StampPoint[], centres: readonly StampPoint[], view: PaintSimilarity): StampGroupLay {
  const onPlane = paintSimilarityInverse(view), [to0, to1] = centres.map((centre) => paintSimilarityApply(onPlane, centre)), [from0, from1] = sources;
  if (!from1 || !to1) return { placement: { x: to0.x - from0.x, y: to0.y - from0.y, rotation: 0, scale: 1 }, pivot: from0 };
  // m = (to1 − to0) / (from1 − from0), as complex numbers: the scale and turn taking one span onto the other.
  const fx = from1.x - from0.x, fy = from1.y - from0.y, tx = to1.x - to0.x, ty = to1.y - to0.y, n = fx * fx + fy * fy;
  const ma = (tx * fx + ty * fy) / n, mb = (ty * fx - tx * fy) / n;
  const pinned: PaintSimilarity = { ma, mb, kx: to0.x - (ma * from0.x - mb * from0.y), ky: to0.y - (mb * from0.x + ma * from0.y) };
  return { placement: paintPlacementOfSimilarity(pinned, from0), pivot: from0 };
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
  points.forEach(({ sourcePx }, i) => {
    if (!isPaintingFinitePoint(sourcePx)) error(`lay.points[${i}].sourcePx`, `${sourcePx.x}, ${sourcePx.y} isn't a finite point`);
  });
  const [a, b] = points;
  if (b && a.sourcePx.x === b.sourcePx.x && a.sourcePx.y === b.sourcePx.y) error('lay.points', `both pin ${a.sourcePx.x}, ${a.sourcePx.y}: two points set a scale and turn only apart`);
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

/** A box as the DOM measures one (`getBoundingClientRect`), in the page's px. */
export type ShotDomBox = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

/**
 * `element`'s centre in frame px, measured against `shot`, the PaintedShot element's box: the shot's element is
 * `frameWidth` frame px across, scaled to fill its box, so the page's px divide by that scale. Any transform above
 * it (a player's) scales both boxes alike and cancels.
 */
export function shotDomCentre(element: ShotDomBox, shot: ShotDomBox, frameWidth: number): StampPoint {
  const scale = shot.width / frameWidth;
  return { x: (element.left + element.width / 2 - shot.left) / scale, y: (element.top + element.height / 2 - shot.top) / scale };
}
