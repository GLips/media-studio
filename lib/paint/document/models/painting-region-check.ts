// painting-region-check.ts: a document's shapes held to what the engine can paint: regions of rings that don't cross,
// edges with positive widths, boundaries on their outlines, and amounts whose fields are finite. Each problem carries
// the box of the shape it's about, document px.

import { STAMP_BOUNDARY_ON_OUTLINE, stampPathsRunAlong } from '#lib/paint/painting/models/stamp-area-boundaries.ts';
import { stampPaintFieldProblem } from '#lib/paint/painting/models/stamp-paint-field.ts';
import { stampPolygonDistance, stampRegionPolygon, stampRingArea, stampRingsCross, type StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { Amount, Boundary, Edge, EdgedRegion, Region, Ring } from './painting-document.ts';
import { paintingBoxUnion, paintingPointsBox, paintingRegionBox } from './painting-footprint.ts';
import { isPaintingFinitePoint, isPaintingList, isPaintingPositive, isPaintingShare, paintingField, type PaintingProblemList } from './painting-problem.ts';

/** The least area a ring encloses, px², below which it paints nothing a reader would mean. */
const LEAST_RING_AREA = 0.01;

/** `region`'s rings: a polygon's own, an ellipse traced as one, no chord straying 0.1 px from it. */
export function paintingRegionRings(region: Region): readonly Ring[] {
  if (region.kind === 'polygon') return region.rings;
  return [stampRegionPolygon({ kind: 'ellipse', x: region.center.x, y: region.center.y, radiusX: region.radiusX, radiusY: region.radiusY })];
}

/** Problems in `region`, `field` its place in `owner`. Returns whether it's a shape the other checks can read. */
export function checkPaintingRegion(list: PaintingProblemList, owner: string, field: string, region: Region): boolean {
  const kind: string = region.kind;
  if (region.kind === 'ellipse') {
    const box = paintingRegionBox(region);
    if (!isPaintingFinitePoint(region.center)) list.error(owner, paintingField(field, 'center'), "the ellipse's centre isn't finite");
    else if (!isPaintingPositive(region.radiusX)) list.error(owner, paintingField(field, 'radiusX'), `${region.radiusX} isn't above 0`, box);
    else if (!isPaintingPositive(region.radiusY)) list.error(owner, paintingField(field, 'radiusY'), `${region.radiusY} isn't above 0`, box);
    else return true;
    return false;
  }
  if (region.kind !== 'polygon') {
    list.error(owner, paintingField(field, 'kind'), `'${kind}' isn't polygon or ellipse`);
    return false;
  }
  if (!isPaintingList(region.rings) || region.rings.length === 0) {
    list.error(owner, paintingField(field, 'rings'), 'a polygon needs at least one ring');
    return false;
  }
  let valid = true;
  region.rings.forEach((ring, i) => {
    const at = paintingField(field, `rings[${i}]`), box = paintingPointsBox(ring), area = Math.abs(stampRingArea(ring));
    if (ring.length < 3 || !ring.every(isPaintingFinitePoint)) list.error(owner, at, `a ring needs at least 3 finite points, not ${ring.filter(isPaintingFinitePoint).length}`, box);
    else if (!(area > LEAST_RING_AREA)) list.error(owner, at, `encloses ${area} px², and a ring needs more than ${LEAST_RING_AREA}`, box);
    else return;
    valid = false;
  });
  if (!valid) return false;
  region.rings.forEach((ring, j) => region.rings.slice(0, j).forEach((other, i) => {
    if (!stampRingsCross(other, ring)) return;
    list.error(owner, paintingField(field, `rings[${j}]`), `crosses ring ${i}: rings lie side by side or inside each other; take an overlap's union in TS`, paintingBoxUnion(paintingPointsBox(other), paintingPointsBox(ring)));
    valid = false;
  }));
  return valid;
}

/** Problems in `edge`; `bleed` refused with `refusal`'s message where it's given. */
export function checkPaintingEdge(list: PaintingProblemList, owner: string, field: string, edge: Edge, refusal: string | null, box?: StampBox): void {
  const kind: string = edge.kind;
  if (edge.kind === 'feather' && !isPaintingPositive(edge.widthPx)) list.error(owner, paintingField(field, 'widthPx'), `${edge.widthPx} isn't above 0`, box);
  else if (edge.kind === 'bleed' && refusal) list.error(owner, field, refusal, box);
  else if (edge.kind === 'bleed' && !isPaintingPositive(edge.reachPx)) list.error(owner, paintingField(field, 'reachPx'), `${edge.reachPx} isn't above 0`, box);
  else if (kind !== 'crisp' && kind !== 'feather' && kind !== 'bleed') list.error(owner, paintingField(field, 'kind'), `'${kind}' isn't crisp, feather or bleed`, box);
  const { roughness } = edge;
  if (!roughness) return;
  if (!(roughness.amountPx >= 0 && Number.isFinite(roughness.amountPx))) list.error(owner, paintingField(field, 'roughness.amountPx'), `${roughness.amountPx} isn't a finite 0 or more`, box);
  if (!isPaintingPositive(roughness.featurePx)) list.error(owner, paintingField(field, 'roughness.featurePx'), `${roughness.featurePx} isn't above 0`, box);
}

const sameEdge = (a: Edge, b: Edge) => JSON.stringify(a) === JSON.stringify(b);

/** Problems in `boundaries` of a region whose rings are `rings`: each on one ring's outline, none sharing a stretch. */
function checkPaintingBoundaries(list: PaintingProblemList, owner: string, field: string, boundaries: readonly Boundary[], rings: readonly Ring[], refusal: string | null): void {
  const onOutline = boundaries.map(({ path, edge }, i) => {
    const at = paintingField(field, `boundaries[${i}]`), box = paintingPointsBox(path);
    checkPaintingEdge(list, owner, paintingField(at, 'edge'), edge, refusal, box);
    if (path.length < 2 || !path.every(isPaintingFinitePoint)) {
      list.error(owner, paintingField(at, 'path'), 'a boundary needs at least two finite points', box);
      return false;
    }
    const near = rings.some((ring) => path.every(({ x, y }) => Math.abs(stampPolygonDistance(ring, x, y)) <= STAMP_BOUNDARY_ON_OUTLINE));
    if (!near) list.error(owner, paintingField(at, 'path'), `a boundary strays more than ${STAMP_BOUNDARY_ON_OUTLINE} px from its outline`, box);
    return near;
  });
  boundaries.forEach((b, j) => boundaries.slice(0, j).forEach((a, i) => {
    if (!onOutline[i] || !onOutline[j] || sameEdge(a.edge, b.edge)) return;
    if (!stampPathsRunAlong(a.path, b.path) && !stampPathsRunAlong(b.path, a.path)) return;
    list.error(owner, paintingField(field, `boundaries[${j}]`), `boundaries ${i} and ${j} give one stretch two edges`, paintingBoxUnion(paintingPointsBox(a.path), paintingPointsBox(b.path)));
  }));
}

/** Problems in an edged region (an area, a clip): its region, its edge and its boundaries. Returns whether its region is readable. */
export function checkPaintingEdgedRegion(list: PaintingProblemList, owner: string, field: string, edged: EdgedRegion, refusal: string | null): boolean {
  const regionField = paintingField(field, 'region');
  if (!checkPaintingRegion(list, owner, regionField, edged.region)) return false;
  const box = paintingRegionBox(edged.region);
  if (edged.edge) checkPaintingEdge(list, owner, paintingField(field, 'edge'), edged.edge, refusal, box);
  if (edged.boundaries) checkPaintingBoundaries(list, owner, field, edged.boundaries, paintingRegionRings(edged.region), refusal);
  return true;
}

const shareProblem = (value: number) => (isPaintingShare(value) ? null : `${value} isn't within 0..1`);

/** Problems in a 0..1 share, constant or a field. */
export function checkPaintingAmount(list: PaintingProblemList, owner: string, field: string, amount: Amount, box?: StampBox): void {
  const problem = typeof amount === 'number' ? shareProblem(amount) : stampPaintFieldProblem(amount, shareProblem);
  if (problem) list.error(owner, field, typeof amount === 'number' ? problem : `a field: ${problem}`, box);
}
