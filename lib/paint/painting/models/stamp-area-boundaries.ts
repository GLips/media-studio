// stamp-area-boundaries.ts: named stretches of a `within`'s edge treated on purpose: kept, feathered or merged, as a
// painter cuts a rock's ridge hard against the water and loses its foot into the grass.
//
// A treatment holds in full where a point's nearest piece of outline lies on its stretch, and fades over its reach
// past the stretch's ends, so two stretches meet at a point with no notch. stampAreaCoverageAt and areaCoverage in
// WGSL read it, twins the gate holds together.

import { stampRingsDistance, type StampPoint } from './stamp-region.ts';

/**
 * `keep`: the edge holds as the within draws it. `feather`: coverage falls off over `reach` px inside the stretch,
 * on paper of any wetness. `merge`: the edge opens `reach` px past the stretch, and the technique laying the shape
 * lays water along it in the same history, so its wet paint runs on and loses its edge (wet history only).
 */
export type StampBoundaryTreatment = 'keep' | 'feather' | 'merge';

/**
 * A stretch of an area's outline, its points on that outline (within a pixel), given by the caller, never inferred.
 * Stretches meet at points: a vertex or end two share is both's. Two running along each other with different
 * treatments, or reaches, are refused.
 */
export type StampBoundary = { path: readonly StampPoint[]; treatment: StampBoundaryTreatment; reach?: number };
export type StampBoundaries = { readonly [name: string]: StampBoundary };

/** A feathered or merged stretch as the coverage reads it; a kept one compiles to nothing. */
export type CompiledStampBoundary = { name: string; path: readonly StampPoint[]; treatment: 'feather' | 'merge'; reach: number };

/** How far a boundary's point may sit off its area's outline, px. */
export const STAMP_BOUNDARY_ON_OUTLINE = 1;
/** Samples a stretch is checked at for running along another, px apart. */
const OVERLAP_STEP = 1;

/** How far (x, y) is from the open path `path`. */
export function stampPolylineDistance(path: readonly StampPoint[], x: number, y: number): number {
  let nearest = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const ex = b.x - a.x, ey = b.y - a.y, px = x - a.x, py = y - a.y;
    const along = Math.min(1, Math.max(0, (px * ex + py * ey) / (ex * ex + ey * ey || 1)));
    nearest = Math.min(nearest, (px - ex * along) ** 2 + (py - ey * along) ** 2);
  }
  return Math.sqrt(nearest);
}

/**
 * `boundaries` checked against `rings`, the outline they lie on, for `what`. Throws on a stretch of fewer than two
 * finite points, a point off every ring, a kept stretch given a reach or a treated one without a positive one, or two
 * stretches running along each other with different treatments.
 */
export function compileStampBoundaries(boundaries: StampBoundaries, rings: readonly (readonly StampPoint[])[], what: string): CompiledStampBoundary[] {
  const entries = Object.entries(boundaries);
  for (const [name, { path, treatment, reach }] of entries) {
    const label = `${what}'s boundary ${name}`;
    if (path.length < 2 || !path.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))) throw new Error(`stamp paint: ${label} needs at least two finite points`);
    const off = path.find(({ x, y }) => Math.abs(stampRingsDistance(rings, x, y)) > STAMP_BOUNDARY_ON_OUTLINE);
    if (off) throw new Error(`stamp paint: ${label} has a point at ${off.x}, ${off.y} off its area's outline; a boundary is a stretch of the outline, its points on it`);
    if (treatment === 'keep' && reach !== undefined) throw new Error(`stamp paint: ${label} is kept, and a kept edge has no reach`);
    if (treatment !== 'keep' && !(reach !== undefined && reach > 0 && Number.isFinite(reach))) throw new Error(`stamp paint: ${label} is a ${treatment}, which needs a positive reach, px`);
  }
  entries.forEach(([name, a], i) => entries.slice(i + 1).forEach(([other, b]) => {
    if (a.treatment === b.treatment && a.reach === b.reach) return;
    if (stampPathsRunAlong(a.path, b.path)) throw new Error(`stamp paint: ${what}'s boundaries ${name} (${a.treatment}) and ${other} (${b.treatment}) run along the same stretch; stretches with different treatments meet at a point`);
  }));
  return entries.flatMap(([name, { path, treatment, reach }]) => (treatment === 'keep' ? [] : [{ name, path, treatment, reach: reach! }]));
}

/** Whether `a` runs along `b` for any length: two samples of it in a row lie on `b`. */
export function stampPathsRunAlong(a: readonly StampPoint[], b: readonly StampPoint[]): boolean {
  let before = false;
  for (let i = 1; i < a.length; i++) {
    const from = a[i - 1], to = a[i], steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / OVERLAP_STEP));
    for (let k = i === 1 ? 0 : 1; k <= steps; k++) {
      const on = stampPolylineDistance(b, from.x + ((to.x - from.x) * k) / steps, from.y + ((to.y - from.y) * k) / steps) < OVERLAP_STEP / 2;
      if (on && before) return true;
      before = on;
    }
  }
  return false;
}

/** How far a merge opens the edge past the outline, at most: what an area's box grows by. */
export const stampBoundariesReach = (boundaries: readonly CompiledStampBoundary[] | undefined) =>
  Math.max(0, ...(boundaries ?? []).filter(({ treatment }) => treatment === 'merge').map(({ reach }) => reach));

/**
 * At (x, y), `sd` px inside the outline: how far merges open the edge (`open`) and how wide feathers ramp it
 * (`feather`), each a treatment's reach where it holds in full, fading past its stretch's ends. Twin of boundaryShift.
 */
export function stampBoundaryShift(boundaries: readonly CompiledStampBoundary[], sd: number, x: number, y: number): { open: number; feather: number } {
  let open = 0, feather = 0;
  for (const { path, treatment, reach } of boundaries) {
    const t = Math.min(1, Math.max(0, (stampPolylineDistance(path, x, y) - Math.abs(sd)) / reach));
    const held = (1 - t * t * (3 - 2 * t)) * reach;
    if (treatment === 'merge') open = Math.max(open, held);
    else feather = Math.max(feather, held);
  }
  return { open, feather };
}

/**
 * stampPolylineDistance and stampBoundaryShift in WGSL, after STAMP_POLYGON_DISTANCE_WGSL: a boundary is a vec4f of
 * `boundaries` (its path's first point in `points`, its count, 1 for a merge or 0 a feather, its reach), which the
 * including shader declares.
 */
export const STAMP_BOUNDARY_WGSL = /* wgsl */ `
fn polylineDistance(p: vec2f, first: u32, count: u32) -> f32 {
  var nearest = 1e30;
  for (var i = first + 1u; i < first + count; i++) {
    let a = points[i - 1u];
    let e = points[i] - a;
    let q = p - a;
    let along = clamp(dot(q, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    let d = q - e * along;
    nearest = min(nearest, dot(d, d));
  }
  return sqrt(nearest);
}
fn boundaryShift(p: vec2f, sd: f32, first: u32, count: u32) -> vec2f {
  var open = 0.0;
  var feather = 0.0;
  for (var i = first; i < first + count; i++) {
    let b = boundaries[i];
    let t = clamp((polylineDistance(p, u32(b.x), u32(b.y)) - abs(sd)) / b.w, 0.0, 1.0);
    let held = (1.0 - t * t * (3.0 - 2.0 * t)) * b.w;
    if (b.z > 0.5) { open = max(open, held); } else { feather = max(feather, held); }
  }
  return vec2f(open, feather);
}`;
