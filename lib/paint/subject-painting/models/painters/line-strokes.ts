// line-strokes.ts: the line painter's geometry. Outlines resampled evenly and smoothed (a traced ring steps by the
// pixel), each point with its area's outward normal; runs of an outline kept by a predicate; and runs cut into the
// overlapping, tapered strokes a hand inks a long line in, each point's width carried as a stroke point's `scale`.

import type { Subpath } from '#lib/paint/document/models/painting-document.ts';
import { stampRingsDistance, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { SubjectArea, SubjectPathRun, SubjectRing } from '#lib/paint/subject/models/subject-geometry.ts';
import { seededRandom } from '#lib/picture/motion/models/random.ts';
import { subjectSmoothStep } from './subject-paint-kit.ts';

/** A point on an outline, with the unit normal pointing out of the area it bounds (or to one side of an open path). */
export type LineOutlinePoint = { readonly x: number; readonly y: number; readonly nx: number; readonly ny: number };

/**
 * A stretch of line to ink: each point's weight is its share of the line's full width. `continues` marks an open end
 * where another line takes the edge over, so it is inked through, not tapered: a taper there reads as a dash.
 */
export type LineRun = {
  readonly points: readonly (StampPoint & { readonly weight: number })[];
  readonly closed: boolean;
  readonly continues: { readonly start: boolean; readonly end: boolean };
};

const distance = (a: StampPoint, b: StampPoint) => Math.hypot(b.x - a.x, b.y - a.y);

function resampled(points: readonly StampPoint[], closed: boolean, step: number): StampPoint[] {
  const loop = closed ? [...points, points[0]] : points;
  const out: StampPoint[] = [loop[0]];
  let carried = 0;
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1], b = loop[i], span = distance(a, b);
    let at = step - carried;
    for (; at <= span; at += step) out.push({ x: a.x + ((b.x - a.x) * at) / span, y: a.y + ((b.y - a.y) * at) / span });
    carried = span - (at - step);
  }
  if (closed && out.length > 1 && distance(out.at(-1)!, out[0]) < step * 0.5) out.pop();
  if (!closed && distance(out.at(-1)!, loop.at(-1)!) > step * 0.25) out.push(loop.at(-1)!);
  return out;
}

/** Two passes of a [1 2 1] filter: a traced ring's pixel stair becomes the curve it stands for. An open path keeps its ends. */
function smoothed(points: readonly StampPoint[], closed: boolean): StampPoint[] {
  let current = [...points];
  const n = current.length;
  for (let pass = 0; pass < 2; pass++) {
    current = current.map((p, i) => {
      if (!closed && (i === 0 || i === n - 1)) return p;
      const a = current[(i - 1 + n) % n], b = current[(i + 1) % n];
      return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
    });
  }
  return current;
}

function withNormals(points: readonly StampPoint[], closed: boolean): LineOutlinePoint[] {
  const n = points.length;
  return points.map((p, i) => {
    const a = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const tx = b.x - a.x, ty = b.y - a.y, length = Math.hypot(tx, ty) || 1;
    return { x: p.x, y: p.y, nx: ty / length, ny: -tx / length };
  });
}

/** A path's runs resampled every `step` px and smoothed, normals to one side. */
export const linePathOutline = (run: SubjectPathRun, step: number): LineOutlinePoint[] =>
  withNormals(smoothed(resampled(run.points, run.closed, step), run.closed), run.closed);

/**
 * Each ring of `area`, resampled every `step` px and smoothed, its normals turned out of the area: a hole's point away
 * from the hole's middle, since that is out of the paint. Rings too small to resample are left out.
 */
export function lineAreaOutlines(area: SubjectArea, step: number): LineOutlinePoint[][] {
  return area.rings.flatMap((ring: SubjectRing) => {
    const points = withNormals(smoothed(resampled(ring, true, step), true), true);
    if (points.length < 3) return [];
    // A majority of a few probes, so one probe landing in a neighbouring ring's gap can't flip the ring.
    const probes = [0, 1, 2].map((k) => points[Math.floor((k * points.length) / 3)]);
    const inward = probes.filter((p) => stampRingsDistance(area.rings, p.x + p.nx * step, p.y + p.ny * step) > 0).length >= 2;
    return [inward ? points.map((p) => ({ ...p, nx: -p.nx, ny: -p.ny })) : points];
  });
}

/**
 * The stretches of `outline` whose points `weightAt` keeps, weights averaged over a few neighbours so a line thickens
 * smoothly. Runs under `minLength` px are dropped: a speck at a junction reads as dirt. An end whose next point
 * `handover.at` gives to another line continues, inking on up to `handover.reachPx` so the two lines meet.
 */
export function lineRunsWhere<P extends LineOutlinePoint>(
  outline: readonly P[], closed: boolean, minLength: number, weightAt: (point: P) => number | undefined,
  handover: { readonly at: (point: P) => boolean; readonly reachPx: number },
): LineRun[] {
  const weights = outline.map(weightAt);
  const n = outline.length;
  const smooth = (i: number, inRun: (k: number) => boolean) => {
    let sum = 0, count = 0;
    for (let k = -3; k <= 3; k++) {
      const j = closed ? (i + k + n) % n : i + k;
      if (j < 0 || j >= n || !inRun(j)) continue;
      sum += weights[j]!;
      count++;
    }
    return sum / count;
  };
  const kept = (j: number) => weights[j] !== undefined;
  // Past an open outline's end there is no point: an end that continues is judged on itself.
  const step = (i: number, by: -1 | 1) => (closed ? (i + by + n) % n : Math.max(0, Math.min(n - 1, i + by)));
  /** The handed-over points past `from`, going `by`, within reach: what a continuing end inks on over. */
  const reach = (from: number, by: -1 | 1) => {
    const over: number[] = [];
    for (let i = step(from, by), travelled = 0; i !== from && !over.includes(i) && !kept(i) && handover.at(outline[i]); i = step(i, by)) {
      travelled += distance(outline[over.at(-1) ?? from], outline[i]);
      if (travelled > handover.reachPx) break;
      over.push(i);
    }
    return over;
  };
  const runOf = (indices: number[], isClosed: boolean): LineRun => {
    const points = indices.map((i) => ({ x: outline[i].x, y: outline[i].y, weight: smooth(i, kept) }));
    if (isClosed) return { closed: true, points, continues: { start: false, end: false } };
    const first = indices[0], last = indices.at(-1)!;
    const continues = { start: handover.at(outline[step(first, -1)]), end: handover.at(outline[step(last, 1)]) };
    const before = continues.start ? reach(first, -1).toReversed().map((i) => ({ x: outline[i].x, y: outline[i].y, weight: points[0].weight })) : [];
    const after = continues.end ? reach(last, 1).map((i) => ({ x: outline[i].x, y: outline[i].y, weight: points.at(-1)!.weight })) : [];
    return { closed: false, points: [...before, ...points, ...after], continues };
  };
  if (closed && weights.every((w) => w !== undefined)) return [runOf(outline.map((_, i) => i), true)];
  const start = closed ? weights.findIndex((w) => w === undefined) : 0;
  const runs: number[][] = [];
  let current: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = closed ? (start + k) % n : k;
    if (kept(i)) current.push(i);
    else if (current.length) { runs.push(current); current = []; }
  }
  if (current.length) runs.push(current);
  const runLength = (indices: number[]) => indices.slice(1).reduce((sum, i, k) => sum + distance(outline[indices[k]], outline[i]), 0);
  return runs.filter((indices) => indices.length > 1 && runLength(indices) >= minLength).map((indices) => runOf(indices, false));
}

/** How a hand inks a run: stroke length and overlap in px, and the floor of the taper (1 for no taper). */
export type LineHand = { readonly strokePx: number; readonly overlapPx: number; readonly taperFloor: number; readonly pressure: number };

/**
 * `run` cut into tapered strokes about `hand.strokePx` long, overlapping by `overlapPx`, as a pen lifts and lands again
 * along a long contour; a closed run's cuts start at a seeded place. Each point's `scale` is its weight times the
 * taper, baked in because a hand's profile would span every subpath of the stroke as one.
 */
export function lineStrokeSubpaths(run: LineRun, hand: LineHand, seed: string): Subpath[] {
  const random = seededRandom(seed);
  // A closed run is laid out three times over, and its cuts read from the middle copy, so a stroke overlapping the
  // seam on either side still finds its points.
  const points = run.closed ? [...run.points, ...run.points, ...run.points, run.points[0]] : run.points;
  const arcs = [0];
  for (let i = 1; i < points.length; i++) arcs.push(arcs[i - 1] + distance(points[i - 1], points[i]));
  const length = run.closed ? arcs[run.points.length] : arcs.at(-1)!;
  if (length <= 0) return [];
  const count = Math.max(1, Math.round(length / hand.strokePx));
  const base = run.closed ? length + random() * (length / count) : 0;
  const cuts = Array.from({ length: count + 1 }, (_, k) => {
    const jitter = k === 0 || k === count ? 0 : (random() - 0.5) * 0.4 * (length / count);
    return base + (k * length) / count + jitter;
  });
  const overlap = Math.min(hand.overlapPx, length / 2);
  return cuts.slice(1).map((end, k) => {
    const from = run.closed || k > 0 ? cuts[k] - overlap / 2 : cuts[k];
    const to = run.closed || k < count - 1 ? end + overlap / 2 : end;
    const taper = { start: k > 0 || run.closed || !run.continues.start, end: k < count - 1 || run.closed || !run.continues.end };
    return strokeBetween(points, arcs, from, Math.min(to, arcs.at(-1)!), hand, taper);
  }).filter((subpath) => subpath.length > 1);
}

function strokeBetween(points: LineRun['points'], arcs: readonly number[], from: number, to: number, hand: LineHand, taper: { readonly start: boolean; readonly end: boolean }): Subpath {
  const at = (arc: number) => {
    const i = Math.max(1, Math.min(arcs.length - 1, arcs.findIndex((a) => a >= arc)));
    const a = points[i - 1], b = points[i], span = arcs[i] - arcs[i - 1], t = span > 0 ? (arc - arcs[i - 1]) / span : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, weight: a.weight + (b.weight - a.weight) * t };
  };
  const inside = points.flatMap((p, i) => (arcs[i] > from && arcs[i] < to ? [{ ...p, arc: arcs[i] }] : []));
  const along = [{ ...at(from), arc: from }, ...inside, { ...at(to), arc: to }];
  return along.map(({ x, y, weight, arc }) => {
    const u = (arc - from) / (to - from || 1);
    const ease = Math.min(taper.start ? subjectSmoothStep(u / 0.2) : 1, taper.end ? subjectSmoothStep((1 - u) / 0.25) : 1);
    const share = hand.taperFloor + (1 - hand.taperFloor) * ease;
    return { x, y, scale: Math.min(1, weight * share), pressure: hand.pressure * (0.7 + 0.3 * share) };
  });
}
