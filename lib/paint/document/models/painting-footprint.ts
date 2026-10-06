// painting-footprint.ts: the box a problem points at, in document px: the geometry it's about as the source states it
// (an application's points or area, a region), grown by half its widest brush. Stated geometry, not a compiled
// deposit's support: checks run before anything compiles, and the box is what an author reads. Each reads only what's
// there, so a broken shape still gets the box of its finite points.

import { stampPolygonBox, type StampBox, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { DepositGeometry, LayerNode, Region, Wash } from './painting-document.ts';
import { isPaintingFinitePoint, isPaintingList } from './painting-problem.ts';
import { isPaintingGroup } from './painting-tree.ts';

/** The box holding both, either possibly absent. */
export function paintingBoxUnion(a: StampBox | undefined, b: StampBox | undefined): StampBox | undefined {
  if (!a || !b) return a ?? b;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/** The box round the finite ones of `points`, grown by `pad`; none when no point is finite. */
export function paintingPointsBox(points: readonly StampPoint[], pad = 0): StampBox | undefined {
  const finite = points.filter(isPaintingFinitePoint);
  return finite.length > 0 ? stampPolygonBox(finite, pad) : undefined;
}

/** The box round `region`. */
export function paintingRegionBox(region: Region, pad = 0): StampBox | undefined {
  if (region.kind === 'ellipse') {
    const { center, radiusX, radiusY } = region;
    return paintingPointsBox([{ x: center.x - radiusX, y: center.y - radiusY }, { x: center.x + radiusX, y: center.y + radiusY }], pad);
  }
  return isPaintingList(region.rings) ? paintingPointsBox(region.rings.flat(), pad) : undefined;
}

/** The largest diameter `geometry` lays at, px: a stroke's at its widest point, a stamp's own where it states one. */
export function paintingLargestDiameter(geometry: DepositGeometry, diameterPx: number): number {
  if (geometry.kind === 'stroke' && isPaintingList(geometry.subpaths)) {
    return diameterPx * Math.max(1, ...geometry.subpaths.flat().map((point) => (Number.isFinite(point?.scale) ? point.scale ?? 1 : 1)));
  }
  if (geometry.kind === 'stamps' && isPaintingList(geometry.placements)) {
    return Math.max(diameterPx, ...geometry.placements.map((stamp) => (Number.isFinite(stamp?.diameter) ? stamp.diameter ?? 0 : 0)));
  }
  return diameterPx;
}

/** The box `geometry` may lay paint in: its points or area, grown by half its largest diameter. */
export function paintingGeometryBox(geometry: DepositGeometry, diameterPx: number): StampBox | undefined {
  const pad = (Number.isFinite(diameterPx) ? paintingLargestDiameter(geometry, diameterPx) : 0) / 2;
  if (geometry.kind === 'stroke') return isPaintingList(geometry.subpaths) ? paintingPointsBox(geometry.subpaths.flat(), pad) : undefined;
  if (geometry.kind === 'stamps') return isPaintingList(geometry.placements) ? paintingPointsBox(geometry.placements, pad) : undefined;
  return geometry.area?.region ? paintingRegionBox(geometry.area.region, pad) : undefined;
}

/** The box round everything `wash` lays. */
export const paintingWashBox = (wash: Wash): StampBox | undefined =>
  (isPaintingList(wash.applications) ? wash.applications : []).reduce<StampBox | undefined>((box, application) => paintingBoxUnion(box, paintingGeometryBox(application, application.diameterPx)), undefined);

/** The box round everything `node` lays: a layer's washes, a group's children. */
export const paintingNodeBox = (node: LayerNode): StampBox | undefined => (isPaintingGroup(node)
  ? node.children.reduce<StampBox | undefined>((box, child) => paintingBoxUnion(box, paintingNodeBox(child)), undefined)
  : (isPaintingList(node.washes) ? node.washes : []).reduce<StampBox | undefined>((box, wash) => paintingBoxUnion(box, paintingWashBox(wash)), undefined));
