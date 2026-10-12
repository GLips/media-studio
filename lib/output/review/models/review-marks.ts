// review-marks.ts: a press or a drag on the stage as what a note stores: points rounded to a ten-thousandth of the
// frame, and a stroke as the arrow, ellipse or thinned pen path it means. The stage measures; this decides.
import type { ReviewMark, ReviewPoint } from './review-threads.ts';

/** A pen stroke's points are thinned to within this much of the line drawn, in 0–1 frame units. */
const REVIEW_PATH_TOLERANCE = 0.002;
/** A drag shorter than this, in 0–1 frame units, draws nothing: it was a click. */
const REVIEW_MARK_MIN = 0.005;

const clampUnit = (v: number) => Math.min(1, Math.max(0, v));
const roundUnit = (v: number) => Math.round(v * 10_000) / 10_000;
export const reviewUnitPoint = (x: number, y: number): ReviewPoint => ({ x: roundUnit(clampUnit(x)), y: roundUnit(clampUnit(y)) });

/** Ramer–Douglas–Peucker: the fewest of `points` that stay within `tolerance` of the stroke as drawn. */
function simplifyReviewPath(points: readonly ReviewPoint[], tolerance: number): ReviewPoint[] {
  if (points.length < 3) return [...points];
  const first = points[0], last = points[points.length - 1];
  const dx = last.x - first.x, dy = last.y - first.y, length = Math.hypot(dx, dy) || 1;
  let far = 0, farthest = 0;
  points.forEach((p, i) => {
    const off = Math.abs(dy * (p.x - first.x) - dx * (p.y - first.y)) / length;
    if (off > farthest) [far, farthest] = [i, off];
  });
  if (farthest <= tolerance) return [first, last];
  return [...simplifyReviewPath(points.slice(0, far + 1), tolerance).slice(0, -1), ...simplifyReviewPath(points.slice(far), tolerance)];
}

/** The stroke `tool` draws from `start` to `end` (a pen through `points`), or null for a drag too short to mean one. */
export function reviewMarkOf(tool: ReviewMark['kind'], start: ReviewPoint, end: ReviewPoint, points: readonly ReviewPoint[]): ReviewMark | null {
  if (tool === 'path') return points.length > 1 ? { kind: 'path', points: simplifyReviewPath(points, REVIEW_PATH_TOLERANCE) } : null;
  if (Math.hypot(end.x - start.x, end.y - start.y) < REVIEW_MARK_MIN) return null;
  if (tool === 'arrow') return { kind: 'arrow', from: start, to: end };
  return {
    kind: 'ellipse', c: reviewUnitPoint((start.x + end.x) / 2, (start.y + end.y) / 2),
    rx: roundUnit(Math.abs(end.x - start.x) / 2), ry: roundUnit(Math.abs(end.y - start.y) / 2),
  };
}
