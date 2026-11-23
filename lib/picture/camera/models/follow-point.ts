// follow-point.ts: a camera's aim on a moving point (a cursor), smoothed the way an operator's hands would be: each
// moment it aims at the point's average over the seconds around it, so a flick across the screen becomes one glide
// and a jitter disappears. Pure in time, so any frame renders alone and a seek never drifts.
//
// The window is centred, so the aim starts moving a little before the point does: on screen that reads as the
// camera anticipating, not lagging.
import type { Point } from '#lib/picture/frame/models/geometry.ts';

/** A point at a moment: a cursor's position at `t` seconds. */
export type TimedPoint = Point & { t: number };

// A Gaussian cut off at two deviations each side, sampled this many times a deviation.
const SAMPLES_PER_SIGMA = 6;

/** Where `points` is at `t`, between its samples linearly, held before the first and after the last. */
export function pointOnPathAt(points: readonly TimedPoint[], t: number): Point {
  if (!points.length) throw new Error('a path to follow needs at least one point');
  let lo = 0, hi = points.length - 1;
  if (t <= points[lo].t) return points[lo];
  if (t >= points[hi].t) return points[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo], b = points[hi], k = (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/**
 * The aim on `points` at `t`: their path averaged over about `seconds` either side (a Gaussian, its deviation half
 * that). Larger is calmer and lazier; 0.4–0.8 suits a cursor. `points` must be in time order.
 */
export function followPointAt(points: readonly TimedPoint[], t: number, { seconds = 0.6 }: { seconds?: number } = {}): Point {
  const sigma = seconds / 2;
  if (sigma <= 0) return pointOnPathAt(points, t);
  let x = 0, y = 0, total = 0;
  for (let i = -2 * SAMPLES_PER_SIGMA; i <= 2 * SAMPLES_PER_SIGMA; i++) {
    const d = i / SAMPLES_PER_SIGMA, weight = Math.exp(-(d * d) / 2), p = pointOnPathAt(points, t + d * sigma);
    x += p.x * weight;
    y += p.y * weight;
    total += weight;
  }
  return { x: x / total, y: y / total };
}
