// stamp-fill.ts: how a fill covers its region, flooded or in strokes (StampFillApplication).
//
// Wet paint's build converges inside a region, and only its edge shows the brush. So a flood is a body worked out
// per pixel (floodBody) under one stroke of the real brush along the contour half a diameter inside, where its
// stamps' edges touch the outline; a neck narrower than a diameter is the body's alone. The brush's dual is stamped
// along the contour and in rows over the region.
//
// A crayon or a pencil never converges: its marks and the paper between them are the look. So strokes are real
// strokes of the brush in a pattern (stamp-fill-strokes.ts), a stroke deposit like any other.

import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { placeStrokeStamps, type PlacedStamp, type StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';
import { rowSpans, type StampFillReach, type StampFillStrokes } from './stamp-fill-strokes.ts';
import {
  stampDistanceGrid, stampGridAt, stampGridContours, stampGridLocalMax, stampPolygonBox, stampRegionPolygon, type StampBox, type StampGrid, type StampPoint, type StampRegion,
} from './stamp-region.ts';

/** Rows of a flood's dual, a quarter diameter apart: close enough that a tip's own falloff doesn't band. */
const DUAL_ROWS = 0.25;

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

/** A flood's body as the renderer lays it (STAMP_REGION_WGSL's floodBody). */
export type StampFloodBody = {
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
export type StampFloodPlacement = { body: StampFloodBody; stamps: PlacedStamp[]; dualStamps: PlacedStamp[] };

/**
 * Places a fill of `region` by `brush` at `diameter`: its body, its edge stroke (untapered and unfading, so the
 * contour is as dense at its end as its start) and its dual's stamps, along the contour and in rows along `direction`
 * (radians) wherever the region comes within half a diameter.
 */
export function placeStampFlood(region: StampRegion, brush: StampBrush, diameter: number, direction: number, seed: string): StampFloodPlacement {
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
    const rows = rowRuns(polygon, direction, Math.max(1, DUAL_ROWS * diameter), (points, y) => rowSpans(points, direction, y, inset + cell, cell, (x, yy) => stampGridAt(distance, x, yy) > -inset));
    const path = edge.length && rows.length ? [...edge, { ...rows[0], lift: true }, ...rows.slice(1)] : [...edge, ...rows];
    dualStamps = path.length ? placeStrokeStamps(path, brush.dual, diameter * brush.dual.scale, `${seed}|dual`) : [];
  }
  const thickness = stampGridLocalMax(distance, inset);
  return { body: { polygon, box: stampPolygonBox(polygon), thickness, inset }, stamps, dualStamps };
}

/**
 * A flood body's paint: its brush's converged build, read off a straight stroke (`probe`). Toward full it has built
 * to 1; a buildToOpacity to the strongest opacity a stamp brought. `densest`: a glaze's densest stamp, its cap too, as
 * a body has no tip to take off.
 */
export type StampFloodBodyLevels = { built: number; densest: number };

export function stampFloodBodyLevels(towardFull: boolean, probe: readonly PlacedStamp[]): StampFloodBodyLevels {
  const densest = probe.reduce((most, s) => Math.max(most, s.alpha * s.opacity), 0);
  return { built: towardFull ? 1 : probe.reduce((most, s) => Math.max(most, s.opacity), 0), densest };
}

/** A straight stroke of `brush` four diameters long, for its converged build (stampFloodBodyLevels). */
export function stampFloodProbe(brush: StampBrush, diameter: number, seed: string): PlacedStamp[] {
  const untapered = { ...brush, taper: { ...brush.taper, start: 0, end: 0, size: 1, opacity: 1 }, falloff: 0 };
  return placeStrokeStamps([{ x: 0, y: 0 }, { x: diameter * 4, y: 0 }], untapered, diameter, seed);
}

/**
 * A fill's front along the normal to `direction`: its paint at (x, y) as a share, 0 ahead and 1 a diameter behind.
 * It runs from `from` to `to`, the ends of all it paints, a scattered stamp's reach past the outline too, so
 * `progress` 0 shows none of it and 1 all.
 */
export type StampFloodFront = { normal: readonly [number, number]; from: number; to: number; soft: number };

export function stampFloodFront(polygon: readonly StampPoint[], stamps: readonly PlacedStamp[], direction: number, diameter: number): StampFloodFront {
  const normal = [-Math.sin(direction), Math.cos(direction)] as const;
  let from = Infinity, to = -Infinity;
  const reach = (x: number, y: number, r: number) => {
    const along = x * normal[0] + y * normal[1];
    from = Math.min(from, along - r);
    to = Math.max(to, along + r);
  };
  for (const { x, y } of polygon) reach(x, y, 0);
  // A diameter from its centre: past a square tip's corners at any turn.
  for (const { x, y, diameter: d } of stamps) reach(x, y, d);
  return { normal, from, to, soft: diameter };
}

/** The share of a fill's paint at `p` shown with its front (StampFloodFront) at `progress`, in WGSL. */
export const STAMP_FLOOD_FRONT_SHARE_WGSL = /* wgsl */ `fn floodFrontShare(p: vec2f, normal: vec2f, start: f32, end: f32, soft: f32, progress: f32) -> f32 {
  let at = start + progress * (end - start + soft);
  return clamp((at - dot(p, normal)) / soft, 0.0, 1.0);
}`;

/**
 * How a fill lays its paint. `flood`: a converged body under the brush's edge (placeStampFlood), as wet paint floods a
 * shape; reaching `{ past }`, over the region grown that many diameters (stampGrownPolygon), so a `within` cuts it
 * solid to its own edge. `strokes`: real strokes of the brush in a pattern, as a crayon or a pencil fills one
 * (stampFillStrokePath).
 */
export type StampFillApplication = { kind: 'flood'; reach?: StampFillReach } | ({ kind: 'strokes' } & StampFillStrokes);

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

/** A seed for a region's ragged edge from its ID, as a u32 the renderer's noise reads. */
export const stampRegionSeed = (id: string) => Math.floor(seededRandom(`${id}|region`)() * 0x100000000) >>> 0;
