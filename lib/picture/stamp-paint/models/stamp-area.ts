// stamp-area.ts: an area with an edge, the one shape a pass's `within`, masking fluid and an unmask act over, and a
// group standing before others, which reserves its shape from them as fluid no unmask of theirs can lift.
//
// An area's coverage at a point is its region's signed distance less its inset, moved by its ragged noise, ramped over
// its edge's width (STAMP_AREA_COVERAGE_WGSL on the GPU, stampAreaCoverageAt on the CPU, twins the gate holds
// together), so an inset moves the edge inward without offsetting the polygon. An inset may erase a narrow feature:
// that is what was asked for, not something to clamp.

import { checkedStampPolygon } from './stamp-deposit-compile.ts';
import { stampRegionSeed } from './stamp-fill.ts';
import type { CompiledStampMask } from './stamp-paint-recipe.ts';
import { stampEdgeReach, stampEdgeWidth, stampPolygonBox, stampPolygonDistance, type StampBox, type StampEdge, type StampPoint, type StampRegion } from './stamp-region.ts';

/**
 * An area of the painting with an edge: `region`, its edge a 1-px antialiased line unless it's soft or ragged
 * (StampEdge), moved `inset` px inward (0 when left out) by its distance from the outline.
 */
export type StampArea = { region: StampRegion; edge?: StampEdge; inset?: number };

/** An area checked: its region traced, its edge, its inset (absent for none), and its ragged edge's seed (stampRegionSeed of its owner's ID). */
export type CompiledStampArea = { polygon: readonly StampPoint[]; edge?: StampEdge; inset?: number; seed: number };

/**
 * `area` checked and traced for `what` (a mask's or a pass's full ID), its ragged edge seeded from `what`. Throws on a
 * region that isn't a shape, a negative soft width, a ragged edge without a positive scale, or a negative inset.
 */
export function compileStampArea({ region, edge, inset = 0 }: StampArea, what: string): CompiledStampArea {
  const { soft = 0, ragged } = edge ?? {};
  if (!(soft >= 0) || (ragged && !(ragged.amount >= 0 && ragged.scale > 0))) throw new Error(`stamp paint: ${what}'s edge needs a soft width of 0 or more, and a ragged amount of 0 or more at a positive scale`);
  if (!(inset >= 0 && Number.isFinite(inset))) throw new Error(`stamp paint: ${what} is inset ${inset} px, and an area is inset a finite 0 or more`);
  return { polygon: checkedStampPolygon(region, what), ...(edge && { edge }), ...(inset > 0 && { inset }), seed: stampRegionSeed(what) };
}

/** The box beyond which `area` covers nothing: its outline's, grown by how far its edge reaches, less its inset, and a pixel. */
export const stampAreaBox = (area: CompiledStampArea): StampBox => stampPolygonBox(area.polygon, stampEdgeReach(area.edge) - (area.inset ?? 0) + 1);

/** The PCG hash tipNoiseAt is built on, in u32 arithmetic. */
function pcgHash(v: number): number {
  const s = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul((s >>> ((s >>> 28) + 4)) ^ s, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

/** tipNoiseAt's value at lattice point (x, y) of `seed`, -1..1, rounded to f32 before scaling as the GPU's is. */
const latticeNoise = (x: number, y: number, seed: number) => (Math.fround(pcgHash((x ^ pcgHash((y ^ pcgHash(seed)) >>> 0)) >>> 0)) / 4294967296) * 2 - 1;

/** WGSL's mix. */
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;

function edgeNoiseOctave(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  // As the GPU's vec2u(vec2i(i) + 32768): the lattice offset, its bits read unsigned.
  const cx = (ix + 32768) >>> 0, cy = (iy + 32768) >>> 0, nx = (cx + 1) >>> 0, ny = (cy + 1) >>> 0;
  return mix(mix(latticeNoise(cx, cy, seed), latticeNoise(nx, cy, seed), sx), mix(latticeNoise(cx, ny, seed), latticeNoise(nx, ny, seed), sx), sy);
}

/** STAMP_REGION_WGSL's edgeNoise on the CPU: what a ragged edge moves its outline by, at (x, y) in its scale's cells. */
export const stampEdgeNoise = (x: number, y: number, seed: number) => (edgeNoiseOctave(x, y, seed) * 2 + edgeNoiseOctave(x * 2.3, y * 2.3, (seed ^ 0x5bd1e995) >>> 0)) / 3;

/** STAMP_REGION_WGSL's edgeCoverage on the CPU: a smoothstep across `width` px centred on the outline. */
export function stampEdgeCoverage(sd: number, width: number): number {
  const t = Math.min(1, Math.max(0, sd / width + 0.5));
  return t * t * (3 - 2 * t);
}

/** How much of (x, y) `area` covers, 0..1: twin of areaCoverage in STAMP_AREA_COVERAGE_WGSL. */
export function stampAreaCoverageAt(area: CompiledStampArea, x: number, y: number): number {
  const ragged = area.edge?.ragged;
  const moved = ragged && ragged.scale > 0 ? ragged.amount * stampEdgeNoise(x / ragged.scale, y / ragged.scale, area.seed) : 0;
  return stampEdgeCoverage(stampPolygonDistance(area.polygon, x, y) - (area.inset ?? 0) + moved, stampEdgeWidth(area.edge));
}

/**
 * An area's coverage per pixel in WGSL, after STAMP_REGION_WGSL and STAMP_POLYGON_DISTANCE_WGSL: the polygon's `count`
 * points from `first`, its inset, its ragged amount and scale (scale 0 for none), its edge's width and seed.
 */
export const STAMP_AREA_COVERAGE_WGSL = /* wgsl */ `
fn areaCoverage(p: vec2f, first: u32, count: u32, inset: f32, ragged: vec2f, width: f32, seed: u32) -> f32 {
  var moved = 0.0;
  if (ragged.y > 0.0) { moved = ragged.x * edgeNoise(p.x / ragged.y, p.y / ragged.y, seed); }
  return edgeCoverage(polygonDistance(p, first, count) - inset + moved, width);
}`;

/**
 * A group standing before `groups`, painted earlier: they land as if under masking fluid over `shape` inset by
 * `overlap` px, so their paint stops that far inside it and this group's covers the seam. Static: the shape is
 * reserved before this group shows, and neither group's motion moves it.
 */
export type StampStandsBefore = { groups: readonly string[]; shape: StampRegion; overlap: number };

/** A reserve a group is held off by: `<group>/stands-before`, naming the group standing before it, and its area. */
export type StampExclusion = { id: string; area: CompiledStampArea };

/**
 * What each group is held off by, by its ID, from `groups` in painting order. Throws on a target that isn't a
 * group, is the group itself, or doesn't paint before it (groups are never reordered to suit), or a negative overlap.
 */
export function stampStandsBeforeExclusions(groups: readonly { id: string; standsBefore?: StampStandsBefore }[]): ReadonlyMap<string, readonly StampExclusion[]> {
  const at = new Map(groups.map(({ id }, index) => [id, index]));
  const exclusions = new Map<string, StampExclusion[]>();
  groups.forEach(({ id, standsBefore }, index) => {
    if (!standsBefore) return;
    const { groups: targets, shape, overlap } = standsBefore, what = `${id}/stands-before`;
    if (!(overlap >= 0 && Number.isFinite(overlap))) throw new Error(`stamp paint: ${id} stands before others with an overlap of ${overlap} px, and an overlap is a finite 0 or more`);
    const area = compileStampArea({ region: shape, inset: overlap }, what);
    for (const target of targets) {
      const position = at.get(target);
      if (position === undefined) throw new Error(`stamp paint: ${id} stands before ${JSON.stringify(target)}, which isn't a group of the painting`);
      if (target === id) throw new Error(`stamp paint: ${id} stands before itself; it stands before groups painted earlier`);
      if (position > index) throw new Error(`stamp paint: ${id} stands before ${target}, which paints after it (by order, then depth, then as written); give ${target} a lower order or a higher depth`);
      exclusions.set(target, [...(exclusions.get(target) ?? []), { id: what, area }]);
    }
  });
  return exclusions;
}

/**
 * The fluid a held-off group's deposit lands under: its own with `exclusions` masked over it last, so it composes with
 * them by max and no unmask of the group's lifts them. Deposits under the same fluid share the result, so the renderer
 * works each state out once.
 */
export function stampFluidHolder(exclusions: readonly StampExclusion[]): (fluid: CompiledStampMask | null) => CompiledStampMask | null {
  const held = new Map<CompiledStampMask | null, CompiledStampMask | null>();
  return (fluid) => {
    if (!exclusions.length) return fluid;
    if (!held.has(fluid)) held.set(fluid, exclusions.reduce<CompiledStampMask | null>((under, { id, area }) => ({ id, under, kind: 'mask', area }), fluid));
    return held.get(fluid)!;
  };
}
