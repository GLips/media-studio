// stamp-fill.ts: how a fill covers its region, and strokes that sweep or trace one.
//
// A fill's body isn't stamped: laid hundreds of times a pixel, a brush's build converges inside a region long before
// the sweep ends, and only its edge shows the brush. So a fill is a body worked out per pixel (fillBody, at the
// brush's converged build) under one stroke of the real brush along the contour half a diameter inside, where its
// stamps' edges touch the outline. A neck narrower than a diameter drops out of that contour and the body alone
// paints it, without shaving. The brush's dual, which varies across the body too, is stamped along the contour and
// in rows over the region.

import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampBrush } from './stamp-brush.ts';
import { placeStrokeStamps, type PlacedStamp, type StampStrokePoint } from './stamp-placement.ts';
import {
  stampDistanceGrid, stampGridAt, stampGridContours, stampGridLocalMax, stampPolygonBox, stampRegionPolygon, type StampBox, type StampGrid, type StampPoint, type StampRegion,
} from './stamp-region.ts';

/** Rows of a sweep or a fill's dual, a quarter diameter apart: close enough that a tip's own falloff doesn't band. */
const SWEEP_ROWS = 0.25;

/**
 * A region through `points`, closed and smoothed (a Catmull–Rom curve through each, `steps` points a span), for a
 * silhouette drawn from a few control points.
 */
export function stampSmoothRegion(points: readonly StampPoint[], steps = 8): StampRegion {
  const n = points.length, at = (i: number) => points[((i % n) + n) % n];
  const curve = points.flatMap((_, i) => Array.from({ length: steps }, (_slot, k) => {
    const u = k / steps, u2 = u * u, u3 = u2 * u;
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const along = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u3);
    return { x: along(p0.x, p1.x, p2.x, p3.x), y: along(p0.y, p1.y, p2.y, p3.y) };
  }));
  return { kind: 'polygon', points: curve };
}

/** The region's edge, closed (its first point repeated at the end), to stroke along. */
export function stampRegionOutline(region: StampRegion): StampStrokePoint[] {
  const polygon = stampRegionPolygon(region);
  return [...polygon, polygon[0]].map(({ x, y }) => ({ x, y }));
}

/**
 * One stroke sweeping `region` in rows `diameter` × `rows` apart along `angle` (radians, 0 left and right), each row
 * from outline to outline, lifting across a gap: for a texture laid across an element, whose look is its own stamps,
 * clipped to the element or masked.
 */
export function stampSweepPath(region: StampRegion, diameter: number, { rows = SWEEP_ROWS, angle = 0 }: { rows?: number; angle?: number } = {}): StampStrokePoint[] {
  const polygon = stampRegionPolygon(region);
  return rowRuns(polygon, angle, Math.max(1, rows * diameter), (points, y) => polygonSpans(points, y));
}

/** A fill's body as the renderer and the CPU reference lay it (STAMP_REGION_FUNCTIONS.fillBody). */
export type StampFillBody = {
  /** The region, traced (stampRegionPolygon). */
  polygon: readonly StampPoint[];
  /** The body's box: the region's own. */
  box: StampBox;
  /** How thick the region is near each point (stampGridLocalMax of its distance), which narrows the body's edge. */
  thickness: StampGrid;
  /** Half the diameter: where the edge stroke runs inside the outline. */
  inset: number;
};

/** A fill's stamps and body, placed once. */
export type StampFillPlacement = { body: StampFillBody; stamps: PlacedStamp[]; dualStamps: PlacedStamp[] };

/**
 * Places a fill of `region` by `brush` at `diameter`: its body, its edge stroke (untapered and unfading, so the
 * contour is as dense at its end as its start) and its dual's stamps, along the contour and in rows along `direction`
 * (radians) wherever the region comes within half a diameter.
 */
export function placeStampFill(region: StampRegion, brush: StampBrush, diameter: number, direction: number, seed: string): StampFillPlacement {
  const polygon = stampRegionPolygon(region), inset = diameter / 2;
  // A quarter of the inset: the contour's corners are exact to a few pixels, which the brush's own edge hides.
  const cell = Math.max(1, inset / 4);
  const distance = stampDistanceGrid(polygon, stampPolygonBox(polygon, inset + 2 * cell), cell);
  const edge = stampGridContours(distance, inset).flatMap((loop, i) =>
    [...loop, loop[0]].map(({ x, y }, k): StampStrokePoint => (i > 0 && k === 0 ? { x, y, lift: true } : { x, y })));
  const untapered = { ...brush, taper: { ...brush.taper, start: 0, end: 0, size: 1, opacity: 1 }, falloff: 0 };
  const stamps = edge.length ? placeStrokeStamps(edge, untapered, diameter, seed) : [];
  let dualStamps: PlacedStamp[] = [];
  if (brush.dual) {
    const rows = rowRuns(polygon, direction, Math.max(1, SWEEP_ROWS * diameter), (points, y) => gridSpans(distance, points, direction, y, -inset));
    const path = edge.length && rows.length ? [...edge, { ...rows[0], lift: true }, ...rows.slice(1)] : [...edge, ...rows];
    dualStamps = path.length ? placeStrokeStamps(path, brush.dual, diameter * brush.dual.scale, `${seed}|dual`) : [];
  }
  const thickness = stampGridLocalMax(distance, inset);
  return { body: { polygon, box: stampPolygonBox(polygon), thickness, inset }, stamps, dualStamps };
}

/**
 * The paint a fill's body is laid at: its brush's converged build, read off a straight stroke of it (`probe`). A glaze
 * or a build lays toward full, so it has built to 1 and keeps its densest stamp and cap; a buildToOpacity has built
 * to the strongest opacity any stamp brought, as it never lowers.
 */
export type StampFillBodyLevels = { built: number; densest: number; cap: number };

export function stampFillBodyLevels(towardFull: boolean, probe: readonly PlacedStamp[]): StampFillBodyLevels {
  const densest = probe.reduce((most, s) => Math.max(most, s.alpha * s.opacity), 0);
  return { built: towardFull ? 1 : probe.reduce((most, s) => Math.max(most, s.opacity), 0), densest, cap: densest };
}

/** A straight stroke of `brush` four diameters long, for its converged build (stampFillBodyLevels). */
export function stampFillProbe(brush: StampBrush, diameter: number, seed: string): PlacedStamp[] {
  const untapered = { ...brush, taper: { ...brush.taper, start: 0, end: 0, size: 1, opacity: 1 }, falloff: 0 };
  return placeStrokeStamps([{ x: 0, y: 0 }, { x: diameter * 4, y: 0 }], untapered, diameter, seed);
}

/**
 * How far a fill's front has crossed its region along the normal to `direction`: its paint at (x, y) as a share, 0 ahead
 * of the front and 1 a diameter behind it. `progress` 0 has shown none of it, 1 all.
 */
export type StampFillFront = { normal: readonly [number, number]; from: number; to: number; soft: number };

export function stampFillFront(polygon: readonly StampPoint[], direction: number, diameter: number): StampFillFront {
  const normal = [-Math.sin(direction), Math.cos(direction)] as const;
  const along = polygon.map(({ x, y }) => x * normal[0] + y * normal[1]);
  return { normal, from: Math.min(...along), to: Math.max(...along), soft: diameter };
}

/** The share of a fill's paint at (x, y) shown with its front at `progress`; the renderer's fillFrontShare. */
export const STAMP_FILL_FRONT_SHARE = {
  cpu: (front: StampFillFront, progress: number, x: number, y: number) => {
    const at = front.from + progress * (front.to - front.from + front.soft);
    return Math.min(1, Math.max(0, (at - (x * front.normal[0] + y * front.normal[1])) / front.soft));
  },
  wgsl: /* wgsl */ `fn fillFrontShare(p: vec2f, normal: vec2f, start: f32, end: f32, soft: f32, progress: f32) -> f32 {
  let at = start + progress * (end - start + soft);
  return clamp((at - dot(p, normal)) / soft, 0.0, 1.0);
}`,
};

/**
 * Rows `step` apart across `polygon` along `angle`, each split into runs by `spans` (in the rows' frame, where each
 * row is horizontal), joined back and forth into one path that lifts between runs.
 */
function rowRuns(polygon: readonly StampPoint[], angle: number, step: number, spans: (local: readonly StampPoint[], y: number) => [number, number][]): StampStrokePoint[] {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const local = polygon.map(({ x, y }) => ({ x: x * cos + y * sin, y: -x * sin + y * cos }));
  const toPainting = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
  const top = Math.min(...local.map((p) => p.y)), bottom = Math.max(...local.map((p) => p.y));
  const path: StampStrokePoint[] = [];
  let rightward = true;
  for (let y = top + step / 2; y < bottom; y += step) {
    const runs = spans(local, y);
    for (const [a, b] of rightward ? runs : runs.toReversed()) {
      const [start, end] = rightward ? [a, b] : [b, a];
      path.push({ ...toPainting(start, y), ...(path.length && { lift: true }) }, toPainting(end, y));
    }
    rightward = !rightward;
  }
  return path;
}

/** Where the horizontal line at `y` is inside `polygon` (even-odd), as sorted spans. */
function polygonSpans(polygon: readonly StampPoint[], y: number): [number, number][] {
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

/**
 * Where the row at `y`, in the frame turned by `angle`, has `grid` above `level`, as spans in that frame: walked a
 * grid cell at a time from a little before the region's reach to a little past it.
 */
function gridSpans(grid: StampGrid, local: readonly StampPoint[], angle: number, y: number, level: number): [number, number][] {
  const cos = Math.cos(angle), sin = Math.sin(angle), reach = -level + grid.cell;
  const x0 = Math.min(...local.map((p) => p.x)) - reach, x1 = Math.max(...local.map((p) => p.x)) + reach;
  const spans: [number, number][] = [];
  let start: number | null = null;
  for (let x = x0; x <= x1 + grid.cell; x += grid.cell) {
    const inside = x <= x1 && stampGridAt(grid, x * cos - y * sin, x * sin + y * cos) > level;
    if (inside && start === null) start = x;
    if (!inside && start !== null) {
      spans.push([start, x - grid.cell]);
      start = null;
    }
  }
  return spans.filter(([a, b]) => b > a);
}

/** A seed for a region's ragged edge from its ID, as a u32 the renderer's noise reads. */
export const stampRegionSeed = (id: string) => Math.floor(seededRandom(`${id}|region`)() * 0x100000000) >>> 0;
