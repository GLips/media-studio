// stamp-fill.ts: strokes that cover a region, for the solid base silhouette a stamp painting builds each element on.
//
// The recipe has no area fill on purpose: a silhouette laid by the brush itself gets the brush's own edge, grain and
// rims, so its outline reads painted rather than cut. `stampFillPath` sweeps a region back and forth in rows, as a
// hand fills a shape, and `stampRegionOutline` traces its edge for a crisper rim.

import type { StampBrush } from './stamp-brush.ts';
import type { StampRegion } from './stamp-paint-recipe.ts';
import type { StampStrokePoint } from './stamp-placement.ts';

type Point = { x: number; y: number };

const ELLIPSE_STEPS = 72;

/** The region's outline as a closed polygon, its first point not repeated. */
function regionPolygon(region: StampRegion): readonly Point[] {
  if (region.kind === 'polygon') return region.points;
  return Array.from({ length: ELLIPSE_STEPS }, (_, i) => {
    const turn = (i / ELLIPSE_STEPS) * Math.PI * 2;
    return { x: region.x + Math.cos(turn) * region.radiusX, y: region.y + Math.sin(turn) * region.radiusY };
  });
}

/**
 * A region through `points`, closed and smoothed (a Catmull–Rom curve through each, `steps` points a span), for a
 * silhouette drawn from a few control points.
 */
export function stampSmoothRegion(points: readonly Point[], steps = 8): StampRegion {
  const n = points.length, at = (i: number) => points[((i % n) + n) % n];
  const curve = points.flatMap((_, i) => Array.from({ length: steps }, (_slot, k) => {
    const u = k / steps, u2 = u * u, u3 = u2 * u;
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const along = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u3);
    return { x: along(p0.x, p1.x, p2.x, p3.x), y: along(p0.y, p1.y, p2.y, p3.y) };
  }));
  return { kind: 'polygon', points: curve };
}

/** The brush as a fill sweeps it: untapered and unfading, so a silhouette is as dense in its last row as its first. */
export function stampFillBrush<B extends StampBrush>(brush: B): B {
  return { ...brush, taper: { ...brush.taper, start: 0, end: 0, size: 1, opacity: 1 }, falloff: 0 };
}

/** The region's edge, closed (its first point repeated at the end), to stroke along. */
export function stampRegionOutline(region: StampRegion): StampStrokePoint[] {
  const polygon = regionPolygon(region);
  return [...polygon, polygon[0]].map(({ x, y }) => ({ x, y }));
}

export type StampFillOptions = {
  /** Distance between rows, as a fraction of the diameter: close enough that a tip's own falloff doesn't band. */
  rows?: number;
  /** How far inside the edge the sweep turns, as a fraction of the diameter, so the stamps' own edge lands on it. */
  inset?: number;
  /** The rows' direction, radians: 0 sweeps left and right. */
  angle?: number;
  /** Whether the stroke ends by tracing the region's edge, `inset` inside it, smoothing the rows' stepped ends into its shape. */
  trace?: boolean;
};

/**
 * `polygon`'s outline moved `distance` inward along each vertex's normal, closed. Close to a sharp inward corner it can
 * cross itself, which a trace stroked along it doesn't mind.
 */
function insetPolygon(polygon: readonly Point[], distance: number): StampStrokePoint[] {
  const n = polygon.length;
  const area = polygon.reduce((sum, p, i) => sum + p.x * polygon[(i + 1) % n].y - polygon[(i + 1) % n].x * p.y, 0);
  // Inward is the normal (−dy, dx) when the shoelace area is positive, (dy, −dx) when it's negative.
  const side = area > 0 ? 1 : -1;
  const normal = (a: Point, b: Point) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (-(b.y - a.y) / length) * side, y: ((b.x - a.x) / length) * side };
  };
  const moved = polygon.map((p, i) => {
    const before = normal(polygon[(i - 1 + n) % n], p), after = normal(p, polygon[(i + 1) % n]);
    const mean = { x: before.x + after.x, y: before.y + after.y }, length = Math.hypot(mean.x, mean.y) || 1;
    const reach = distance / Math.max(0.5, length / 2);
    return { x: p.x + (mean.x / length) * reach, y: p.y + (mean.y / length) * reach };
  });
  return [...moved, moved[0]];
}

/**
 * One stroke that sweeps `region` in rows for a brush `diameter` wide, revealed row by row, then traces its edge.
 * Rows turn back into the next; where a row is split (a concave notch), the brush lifts to the next run rather than
 * cross the gap, so the silhouette is one deposit and no part of it builds on another.
 */
export function stampFillPath(region: StampRegion, diameter: number, { rows = 0.25, inset = 0.45, angle = 0, trace = true }: StampFillOptions = {}): StampStrokePoint[] {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  // Work in the rows' frame, where each row is horizontal, and turn back at the end.
  const local = regionPolygon(region).map(({ x, y }) => ({ x: x * cos + y * sin, y: -x * sin + y * cos }));
  const toPainting = (x: number, y: number): StampStrokePoint => ({ x: x * cos - y * sin, y: x * sin + y * cos });
  const top = Math.min(...local.map((p) => p.y)), bottom = Math.max(...local.map((p) => p.y));
  const edge = inset * diameter, step = Math.max(1, rows * diameter);
  const first = top + Math.min(edge, (bottom - top) / 2);
  const count = Math.max(1, Math.ceil((bottom - edge - first) / step) + 1);
  type Chain = { points: StampStrokePoint[]; span: [number, number]; rightward: boolean; row: number; first: number };
  const open: Chain[] = [], done: Chain[] = [];
  for (let r = 0; r < count; r++) {
    const y = count === 1 ? (top + bottom) / 2 : first + ((bottom - edge - first) * r) / (count - 1);
    const spans = rowSpans(local, y).map(([a, b]): [number, number] => [a + edge, b - edge]).filter(([a, b]) => b > a);
    for (const span of spans) {
      const chain = open.find((c) => c.row === r - 1 && c.span[0] < span[1] && span[0] < c.span[1]);
      if (chain) {
        chain.rightward = !chain.rightward;
        chain.points.push(...(chain.rightward ? [toPainting(span[0], y), toPainting(span[1], y)] : [toPainting(span[1], y), toPainting(span[0], y)]));
        Object.assign(chain, { span, row: r });
      } else {
        open.push({ points: [toPainting(span[0], y), toPainting(span[1], y)], span, rightward: true, row: r, first: r });
      }
    }
    for (let i = open.length - 1; i >= 0; i--) if (open[i].row < r) done.push(...open.splice(i, 1));
  }
  const chains = [...done, ...open].toSorted((p, q) => p.first - q.first).map((c) => c.points);
  if (trace) chains.push(insetPolygon(regionPolygon(region), inset * diameter));
  return chains.flatMap((points, i) => points.map((point, k) => (i > 0 && k === 0 ? { ...point, lift: true } : point)));
}

/** Where the horizontal line at `y` is inside `polygon` (even-odd), as sorted spans. */
function rowSpans(polygon: readonly Point[], y: number): [number, number][] {
  const crossings: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if ((a.y <= y) !== (b.y <= y)) crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  crossings.sort((p, q) => p - q);
  const spans: [number, number][] = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) spans.push([crossings[i], crossings[i + 1]]);
  return spans;
}
