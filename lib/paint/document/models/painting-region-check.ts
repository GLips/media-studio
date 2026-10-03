// painting-region-check.ts: a document's shapes held to what the engine can paint: regions of rings that don't cross,
// edges with positive widths, boundaries on their outlines, and fields whose geometry is finite. Each problem carries
// the box of the shape it's about, document px.

import { STAMP_BOUNDARY_ON_OUTLINE, stampPathsRunAlong } from '#lib/paint/painting/models/stamp-area-boundaries.ts';
import { stampPaintFieldProblem } from '#lib/paint/painting/models/stamp-paint-field.ts';
import { stampPolygonDistance, stampRegionPolygon, type StampBox, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { Amount, Boundary, Edge, EdgedRegion, Field, Region, Ring } from './painting-document.ts';
import { isPaintingList, paintingBoxUnion, type PaintingProblemList } from './painting-problem.ts';

/** The least area a ring encloses, px², below which it paints nothing a reader would mean. */
const LEAST_RING_AREA = 0.01;

/** `field` within its owner, after `prefix`: `area` and `region` make `area.region`. */
export const paintingField = (prefix: string, field: string) => (prefix && field ? `${prefix}.${field}` : prefix || field);

const finitePoint = ({ x, y }: StampPoint) => Number.isFinite(x) && Number.isFinite(y);

/** The box round the finite ones of `points`, grown by `pad`; none when no point is finite. */
export function paintingPointsBox(points: Iterable<StampPoint>, pad = 0): StampBox | undefined {
  let box: StampBox | undefined;
  for (const point of points) {
    if (finitePoint(point)) box = paintingBoxUnion(box, { x0: point.x - pad, y0: point.y - pad, x1: point.x + pad, y1: point.y + pad });
  }
  return box;
}

/** `region`'s rings: a polygon's own, an ellipse traced as one, no chord straying 0.1 px from it. */
export function paintingRegionRings(region: Region): readonly Ring[] {
  if (region.kind === 'polygon') return region.rings;
  return [stampRegionPolygon({ kind: 'ellipse', x: region.center.x, y: region.center.y, radiusX: region.radiusX, radiusY: region.radiusY })];
}

/** The box round `region`. */
export function paintingRegionBox(region: Region, pad = 0): StampBox | undefined {
  if (region.kind === 'ellipse') {
    const { center, radiusX, radiusY } = region;
    return paintingPointsBox([{ x: center.x - radiusX, y: center.y - radiusY }, { x: center.x + radiusX, y: center.y + radiusY }], pad);
  }
  return paintingPointsBox(region.rings.flat(), pad);
}

/** Whether (x, y) lies inside `rings`, read even-odd: a ring inside another is a hole. */
export function paintingInsideRings(rings: readonly Ring[], x: number, y: number): boolean {
  return rings.filter((ring) => stampPolygonDistance(ring, x, y) > 0).length % 2 === 1;
}

const ringArea = (ring: Ring) => Math.abs(ring.reduce((sum, a, i) => {
  const b = ring[(i + 1) % ring.length];
  return sum + a.x * b.y - b.x * a.y;
}, 0)) / 2;

/** The side of line a→b point p lies on: positive left, negative right, 0 on it. */
const side = (a: StampPoint, b: StampPoint, p: StampPoint) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

/** Whether rings `a` and `b` cross: some segment of each strictly crosses one of the other. Touching isn't crossing. */
function ringsCross(a: Ring, b: Ring): boolean {
  const boxA = paintingPointsBox(a), boxB = paintingPointsBox(b);
  if (!boxA || !boxB || boxA.x1 < boxB.x0 || boxB.x1 < boxA.x0 || boxA.y1 < boxB.y0 || boxB.y1 < boxA.y0) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const r = b[j], s = b[(j + 1) % b.length];
      if (side(p, q, r) * side(p, q, s) < 0 && side(r, s, p) * side(r, s, q) < 0) return true;
    }
  }
  return false;
}

/** Problems in `region`, `field` its place in `owner`. Returns whether it's a shape the other checks can read. */
export function checkPaintingRegion(list: PaintingProblemList, owner: string, field: string, region: Region): boolean {
  const kind: string = region.kind;
  if (region.kind === 'ellipse') {
    const box = paintingRegionBox(region);
    if (!finitePoint(region.center)) list.error(owner, paintingField(field, 'center'), "the ellipse's centre isn't finite");
    else if (!(region.radiusX > 0 && Number.isFinite(region.radiusX))) list.error(owner, paintingField(field, 'radiusX'), `${region.radiusX} isn't above 0`, box);
    else if (!(region.radiusY > 0 && Number.isFinite(region.radiusY))) list.error(owner, paintingField(field, 'radiusY'), `${region.radiusY} isn't above 0`, box);
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
    const at = paintingField(field, `rings[${i}]`), box = paintingPointsBox(ring);
    if (ring.length < 3 || !ring.every(finitePoint)) list.error(owner, at, `a ring needs at least 3 finite points, not ${ring.filter(finitePoint).length}`, box);
    else if (!(ringArea(ring) > LEAST_RING_AREA)) list.error(owner, at, `encloses ${ringArea(ring)} px², and a ring needs more than ${LEAST_RING_AREA}`, box);
    else return;
    valid = false;
  });
  if (!valid) return false;
  region.rings.forEach((ring, j) => region.rings.slice(0, j).forEach((other, i) => {
    if (!ringsCross(other, ring)) return;
    list.error(owner, paintingField(field, `rings[${j}]`), `crosses ring ${i}: rings lie side by side or inside each other; take an overlap's union in TS`, paintingBoxUnion(paintingPointsBox(other), paintingPointsBox(ring)));
    valid = false;
  }));
  return valid;
}

/** Problems in `edge`; `bleed` refused with `refusal`'s message where it's given. */
export function checkPaintingEdge(list: PaintingProblemList, owner: string, field: string, edge: Edge, refusal: string | null, box?: StampBox): void {
  const kind: string = edge.kind;
  if (edge.kind === 'feather' && !(edge.widthPx > 0 && Number.isFinite(edge.widthPx))) list.error(owner, paintingField(field, 'widthPx'), `${edge.widthPx} isn't above 0`, box);
  else if (edge.kind === 'bleed' && refusal) list.error(owner, field, refusal, box);
  else if (edge.kind === 'bleed' && !(edge.reachPx > 0 && Number.isFinite(edge.reachPx))) list.error(owner, paintingField(field, 'reachPx'), `${edge.reachPx} isn't above 0`, box);
  else if (kind !== 'crisp' && kind !== 'feather' && kind !== 'bleed') list.error(owner, paintingField(field, 'kind'), `'${kind}' isn't crisp, feather or bleed`, box);
  const { roughness } = edge;
  if (!roughness) return;
  if (!(roughness.amountPx >= 0 && Number.isFinite(roughness.amountPx))) list.error(owner, paintingField(field, 'roughness.amountPx'), `${roughness.amountPx} isn't a finite 0 or more`, box);
  if (!(roughness.featurePx > 0 && Number.isFinite(roughness.featurePx))) list.error(owner, paintingField(field, 'roughness.featurePx'), `${roughness.featurePx} isn't above 0`, box);
}

const sameEdge = (a: Edge, b: Edge) => JSON.stringify(a) === JSON.stringify(b);

/** Problems in `boundaries` of a region whose rings are `rings`: each on one ring's outline, none sharing a stretch. */
function checkPaintingBoundaries(list: PaintingProblemList, owner: string, field: string, boundaries: readonly Boundary[], rings: readonly Ring[], refusal: string | null): void {
  const onOutline = boundaries.map(({ path, edge }, i) => {
    const at = paintingField(field, `boundaries[${i}]`), box = paintingPointsBox(path);
    checkPaintingEdge(list, owner, paintingField(at, 'edge'), edge, refusal, box);
    if (path.length < 2 || !path.every(finitePoint)) {
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

/** Problems in an edged region (an area, a clip): its region, its edge and its boundaries. */
export function checkPaintingEdgedRegion(list: PaintingProblemList, owner: string, field: string, edged: EdgedRegion, refusal: string | null): void {
  const regionField = paintingField(field, 'region');
  if (!checkPaintingRegion(list, owner, regionField, edged.region)) return;
  const box = paintingRegionBox(edged.region);
  if (edged.edge) checkPaintingEdge(list, owner, paintingField(field, 'edge'), edged.edge, refusal, box);
  if (edged.boundaries) checkPaintingBoundaries(list, owner, field, edged.boundaries, paintingRegionRings(edged.region), refusal);
}

/** Whether `amount` is a field rather than a number. */
export const isPaintingField = <T>(amount: T | Field<T>): amount is Field<T> =>
  amount !== null && typeof amount === 'object' && 'kind' in amount && ['constant', 'linear', 'radial', 'noise'].includes(amount.kind);

/** Problems in a field: its kind, its geometry, and each end as `endProblem` judges it. */
export function checkPaintingField<T>(list: PaintingProblemList, owner: string, field: string, value: Field<T>, endProblem: (end: T) => string | null, box?: StampBox): void {
  const problem = stampPaintFieldProblem(value, endProblem);
  if (problem) list.error(owner, field, `a field: ${problem}`, box);
}

const shareProblem = (value: number) => (value >= 0 && value <= 1 ? null : `${value} isn't within 0..1`);

/** Problems in a 0..1 share, constant or a field. */
export function checkPaintingAmount(list: PaintingProblemList, owner: string, field: string, amount: Amount, box?: StampBox): void {
  if (isPaintingField(amount)) checkPaintingField(list, owner, field, amount, shareProblem, box);
  else {
    const problem = shareProblem(amount);
    if (problem) list.error(owner, field, problem, box);
  }
}
