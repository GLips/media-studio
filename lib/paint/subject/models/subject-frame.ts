// subject-frame.ts: local frames on a subject, such as a face's or a flat side's, so paint drawn in the part's own
// coordinates turns and foreshortens with it: a hand-painted replacement, or marks a painter anchors to the part. A
// frame comes from landmarks or from the projection. When it can't be had (a landmark hidden, the face turned
// edge-on) it is unavailable with its reason: never guessed from a bounding box.

import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { SubjectLandmarkPoint, Visibility } from './subject-geometry.ts';
import type { FrameId, PartId } from './subject-id.ts';

/**
 * A frame on the page: local (x, y) lands at `(origin + x·xAxis + y·yAxis) / (1 + x·p.x + y·p.y)`, in document px,
 * with `p` its `perspective` (none: affine). A plane seen through a camera maps exactly so, its far side drawn in.
 */
export type SubjectFrameBasis = { readonly origin: StampPoint; readonly xAxis: StampPoint; readonly yAxis: StampPoint; readonly perspective?: StampPoint };

/** A frame's basis in this view, or why it has none (its landmarks hidden, seen edge-on or from behind). */
export type SubjectFrameStatus =
  | { readonly kind: 'available'; readonly basis: SubjectFrameBasis }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** A local frame on its owner part, as `face`: a replacement paints in it, and an unavailable one isn't called. */
export type SubjectFrame = { readonly id: FrameId; readonly owner: PartId; readonly status: SubjectFrameStatus };

/**
 * Where a frame comes from. `landmarks`: the origin midway between `left` and `right`, which sit at local x = -1 and
 * +1; `down` at local y = +1 when given (so a turned face shears with it), else y square to x, as long, pointing down
 * the page. `projected`: the adapter projected the frame itself.
 */
export type SubjectFrameSource<F extends string = string> =
  | { readonly kind: 'landmarks'; readonly left: F; readonly right: F; readonly down?: F }
  | { readonly kind: 'projected'; readonly status: SubjectFrameStatus };

/** Below this share of its axes' lengths, a frame's axes are taken as parallel: it has no second direction. */
const DEGENERATE_SHARE = 1e-3;

/** Where one local step along x and along y moves the page at the frame's origin: its axes, less the perspective's pull. */
function subjectFrameTangents({ origin, xAxis, yAxis, perspective = { x: 0, y: 0 } }: SubjectFrameBasis): { readonly x: StampPoint; readonly y: StampPoint } {
  return {
    x: { x: xAxis.x - origin.x * perspective.x, y: xAxis.y - origin.y * perspective.x },
    y: { x: yAxis.x - origin.x * perspective.y, y: yAxis.y - origin.y * perspective.y },
  };
}

/** The frame's basis when its axes span the page, else why not. */
export function subjectFrameStatusOf(basis: SubjectFrameBasis): SubjectFrameStatus {
  const { x: u, y: v } = subjectFrameTangents(basis), p = basis.perspective ?? { x: 0, y: 0 };
  const lengths = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
  if (![basis.origin.x, basis.origin.y, basis.xAxis.x, basis.xAxis.y, basis.yAxis.x, basis.yAxis.y, p.x, p.y].every(Number.isFinite)) return { kind: 'unavailable', reason: 'its basis isn\'t finite' };
  if (lengths === 0 || Math.abs(u.x * v.y - u.y * v.x) < DEGENERATE_SHARE * lengths) return { kind: 'unavailable', reason: 'its axes are parallel or zero: the view is edge-on to it' };
  return { kind: 'available', basis };
}

/**
 * A `landmarks` frame read from its landmarks' visibility. The caller has checked each id names a landmark; a hidden
 * one makes the frame unavailable.
 */
export function subjectFrameFromLandmarks<F extends string>(
  source: Extract<SubjectFrameSource<F>, { kind: 'landmarks' }>, landmark: (id: F) => Visibility<SubjectLandmarkPoint>,
): SubjectFrameStatus {
  const ids = [source.left, source.right, ...(source.down === undefined ? [] : [source.down])];
  const shown = ids.flatMap((id) => {
    const point = landmark(id);
    return point.kind === 'visible' ? [point.geometry.at] : [];
  });
  if (shown.length < ids.length) {
    const hidden = ids.filter((id) => landmark(id).kind === 'hidden');
    return { kind: 'unavailable', reason: `landmark ${hidden.join(', ')} ${hidden.length > 1 ? 'are' : 'is'} hidden` };
  }
  const [left, right, down] = shown;
  const origin = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const xAxis = { x: (right.x - left.x) / 2, y: (right.y - left.y) / 2 };
  const yAxis = source.down === undefined ? { x: -xAxis.y, y: xAxis.x } : { x: down.x - origin.x, y: down.y - origin.y };
  return subjectFrameStatusOf({ origin, xAxis, yAxis });
}

/** Local (x, y) on the page. Past the frame's horizon (where `1 + x·p.x + y·p.y` reaches 0) it has no place. */
export function subjectFramePoint({ origin, xAxis, yAxis, perspective }: SubjectFrameBasis, local: StampPoint): StampPoint {
  const w = perspective ? 1 + local.x * perspective.x + local.y * perspective.y : 1;
  return { x: (origin.x + local.x * xAxis.x + local.y * yAxis.x) / w, y: (origin.y + local.x * xAxis.y + local.y * yAxis.y) / w };
}

/** One local unit in px at the frame's origin, as an area's square root: what a stroke's width or a dot's radius scales by. */
export function subjectFrameUnitPx(basis: SubjectFrameBasis): number {
  const { x: u, y: v } = subjectFrameTangents(basis);
  return Math.sqrt(Math.abs(u.x * v.y - u.y * v.x));
}
