// stamp-fill.ts: how a fill covers its region, flooded or in strokes (StampFillApplication).
//
// Wet paint's build converges inside a region. So a flood is its brush's strokes laid as its plan (stamp-fill-plan.ts)
// says, an edge contour at the brush's measured visible offset and ridges down what's narrower, so their paint ends on
// the outline, and rows of the same strokes across the inside, half a visible width apart, so the inside builds an
// even wash (stamp-flood-rows.ts: which way each runs, where it keeps in).
//
// A crayon or a pencil never converges: its marks and the paper between them are the look. So strokes are real
// strokes of the brush in a pattern (stamp-fill-strokes.ts), a stroke deposit like any other.

import { stampFirmStroke, type StampBrush, type StampBrushMeasuredProfile } from '#lib/paint/brush/models/stamp-brush.ts';
import {
  stampBrushEdgeOffsetMean, stampBrushEdgeReach, stampBrushMeasuredProfile, stampBrushProfileRange, type StampBrushEdgeReach,
} from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { placeStrokeStamps, stampFrozenMarks, type PlacedStamp, type StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';
import { compileStampArea, stampLostEdge, stampRegionSeed, type CompiledStampArea } from './stamp-area.ts';
import { planStampFloodRuns, type StampFloodReach, type StampFloodRuns } from './stamp-fill-plan.ts';
import { stampRowFrame, stampRowSpans, type StampFillReach, type StampFillStrokes, type StampRowFrame } from './stamp-fill-strokes.ts';
import type { CompiledStampDeposit, CompiledStampFlood } from './stamp-paint-recipe-compile.ts';
import { stampEdgeReach, stampGridUnion, stampRegionPolygon, type StampEdge, type StampGrid, type StampPoint, type StampRegion } from './stamp-region.ts';

/**
 * Rows a quarter diameter apart, at most: close enough that a tip's own falloff doesn't band. A dry brush's flood and
 * any flood's dual run this close, as no wash of theirs converges at the wider pitch.
 */
const DENSE_ROWS = 0.25;

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

/** How far `brush`'s firm stroke at `diameter` reaches toward every way by side, from its profile, as a fill keeps in by it. */
export function stampBrushFillEdge(brush: StampBrush, diameter: number): StampBrushEdgeReach {
  return stampBrushEdgeReach(stampBrushMeasuredProfile(brush), diameter, brush.name);
}

/**
 * How `brush` reaches as a fill plans with it: its profile's visible offset (both sides' mean over every heading, and
 * toward every way by side, each at any diameter), and the least diameter a ridge narrows to, the smallest its profile
 * holds. Refuses a brush with no current profile, or a diameter its profile doesn't hold.
 */
const stampBrushFillReach = (brush: StampBrush, profile: StampBrushMeasuredProfile, diameter: number): StampFloodReach => ({
  offset: (d) => stampBrushEdgeOffsetMean(profile, d, brush.name),
  edge: (d) => stampBrushEdgeReach(profile, d, brush.name),
  diameter,
  smallest: stampBrushProfileRange(profile).min,
});

/** Plans kept, the latest last: a painting floods one region by one brush for several pigments, each with its seed. */
const STAMP_FLOOD_PLANS_KEPT = 64;
const keptPlans = new Map<string, StampFloodRuns>();

/** `polygon`'s plan for `brush` at `diameter`, remembered by their content: the plan depends on no seed. */
function plannedStampFlood(polygon: readonly StampPoint[], brush: StampBrush, profile: StampBrushMeasuredProfile, diameter: number): StampFloodRuns {
  const key = `${JSON.stringify(profile.key)}\n${brush.name}\n${diameter}\n${JSON.stringify(polygon)}`;
  const plan = keptPlans.get(key) ?? planStampFloodRuns(polygon, stampBrushFillReach(brush, profile, diameter));
  keptPlans.delete(key);
  keptPlans.set(key, plan);
  if (keptPlans.size > STAMP_FLOOD_PLANS_KEPT) keptPlans.delete(keptPlans.keys().next().value!);
  return plan;
}

/** A flood placed: its strokes' stamps and its dual's; `scale`, its plan's local share of the diameter, which its flow, bloom and rim reach by point by point. */
export type StampFloodPlacement = { scale: StampGrid; stamps: PlacedStamp[]; dualStamps: PlacedStamp[] };

/**
 * Places a flood of `region` by `brush` at `diameter`: each run of its plan a firm stroke (stampFirmStroke), as its
 * profile was measured, then rows along `direction` (radians) or back, strokes too, and its dual's stamps along them
 * all, so the edge's dual is the edge stroke's own and ends where a stroke's does.
 */
export function placeStampFlood(region: StampRegion, brush: StampBrush, diameter: number, direction: number, seed: string): StampFloodPlacement {
  const polygon = stampRegionPolygon(region), profile = stampBrushMeasuredProfile(brush);
  const { cell, keepsIn, rowTurned, scale, runs } = plannedStampFlood(polygon, brush, profile, diameter);
  // Each row a stroke heading `direction`, or back where that turns a lopsided tip's shorter side to the nearer
  // outline, kept in by its own footprint the way it heads.
  const frame = stampRowFrame(polygon, direction), { left, right, painting } = frame;
  const inside = (pitch: number) => rowSegments(frame, pitch, (y) => {
    const turned = rowTurned(painting(left, y), painting(right, y)), heading = turned ? direction + Math.PI : direction;
    const spans = stampRowSpans(frame, left - cell, right + cell, y, cell, (x, yy) => keepsIn(x, yy, heading));
    return turned ? spans.map(([a, b]) => [b, a]) : spans;
  });
  // Half the visible width apart: the mean offset, as rows of the brush lay an even wash.
  const pitch = Math.max(0.5, stampBrushEdgeOffsetMean(profile, diameter, brush.name)), dense = Math.max(1, DENSE_ROWS * diameter);
  const strokes = [...runs.map(({ points }) => points), ...inside(brush.media === 'dry' ? Math.min(pitch, dense) : pitch)];
  // Each its own stroke, so a short one still lays its stamps, which a lift's spacing would skip; all turned by the
  // deposit's one start turn, as a stroke's stamps are, or rows heading alike would differ and meet in dark lines.
  const firm = stampFirmStroke(brush), stamps = strokes.flatMap((points, r) => placeStrokeStamps(points, firm, diameter, `${seed}|${r}`, seed));
  let dualStamps: PlacedStamp[] = [];
  if (brush.dual) {
    const path = [...runs.map(({ points }) => points), ...inside(dense)].flatMap((run) => run.map((point, k) => (k === 0 ? { ...point, lift: true } : point)));
    dualStamps = path.length ? placeStrokeStamps(path, brush.dual, diameter * brush.dual.scale, `${seed}|dual`) : [];
  }
  return { scale, stamps, dualStamps };
}

/**
 * A flood's edge. `barrier` (the default): a wall its paint and water stop at, its water drying against it in a rim.
 * `lost`: the region gives way over `reach` px past the outline, its line maybe `ragged`, so the wash bleeds out and
 * dries without a line. Only this says whether a flood is walled (stampDepositWalled).
 */
export type StampFloodEdge = { kind: 'barrier' } | { kind: 'lost'; reach: number; ragged?: StampEdge['ragged'] };

/**
 * How a fill lays its paint. `flood`: its brush's strokes round the outline and in rows across it (placeStampFlood),
 * its `edge` a barrier unless lost; `{ past }` floods the region grown that many diameters (stampGrownPolygon), for a
 * `within` to cut. `strokes`: the brush's real strokes in a pattern, as a crayon fills (stampFillStrokePath).
 */
export type StampFillApplication = { kind: 'flood'; edge?: StampFloodEdge; reach?: StampFillReach } | ({ kind: 'strokes' } & StampFillStrokes);

/** The edge `application` floods to: a barrier unless it says otherwise. */
export const stampFloodEdgeOf = (application: { edge?: StampFloodEdge }): StampFloodEdge => application.edge ?? { kind: 'barrier' };

/**
 * The barrier a flood of `polygon` stops at: its outline, a pixel's antialiasing wide, or ramping out over a lost
 * edge's reach (stampLostEdge), its ragged line seeded by `seed` (stampRegionSeed). Refuses a reach that isn't finite
 * and positive, and what compileStampArea refuses of an edge.
 */
export function stampFloodBarrier(polygon: readonly StampPoint[], edge: StampFloodEdge, seed: string): CompiledStampArea {
  if (edge.kind === 'barrier') return { polygon, seed: 0 };
  const { reach, ragged } = edge;
  if (!(reach > 0 && Number.isFinite(reach))) throw new Error(`stamp paint: a flood's lost edge reaches ${reach} px, and it reaches a finite distance over 0`);
  return compileStampArea({ rings: [polygon], ...stampLostEdge(reach, ragged), seed: ragged ? stampRegionSeed(seed) : 0 }, 'a flood');
}

/**
 * How far past its outline a flood lays paint: as far as its `barrier` lets any through (a lost edge's ramp, out to
 * its ragged line's furthest), so the barrier grades paint that's there rather than paper. A wall lets none past its
 * antialiasing, and the flood's strokes round the outline already reach it.
 */
export const stampFloodLaidPast = (barrier: CompiledStampArea): number => (barrier.edge?.soft ? stampEdgeReach(barrier.edge) - (barrier.inset ?? 0) : 0);

/**
 * Rows `step` apart across `frame`'s region, each split into segments by `spans` (in the frame), every segment a start
 * and an end in the painting, in the order `spans` gives them.
 */
function rowSegments({ top, bottom, painting }: StampRowFrame, step: number, spans: (y: number) => [number, number][]): StampStrokePoint[][] {
  const segments: StampStrokePoint[][] = [];
  for (let y = top + step / 2; y < bottom; y += step) for (const [a, b] of spans(y)) segments.push([painting(a, y), painting(b, y)]);
  return segments;
}

/**
 * A fill of several outer rings as one deposit: `parts`, each ring's laid by its own placement, their stamps joined in
 * order; a flood stopped at `area` (the ringed area, so holes stay bare), its local scale the union of theirs.
 */
export function stampFillPartsJoined(parts: readonly CompiledStampDeposit[], area: CompiledStampArea): CompiledStampDeposit {
  const [first] = parts;
  const joined = parts.length === 1 ? first : {
    ...first, stamps: stampFrozenMarks(parts.flatMap(({ stamps }) => stamps)), dualStamps: stampFrozenMarks(parts.flatMap(({ dualStamps }) => dualStamps)),
  };
  if (first.kind !== 'flood') return joined;
  const flood: CompiledStampFlood = { ...first.flood, barrier: area, scale: stampGridUnion(parts.flatMap((part) => (part.kind === 'flood' ? [part.flood.scale] : []))) };
  return { ...joined, kind: 'flood', flood };
}
