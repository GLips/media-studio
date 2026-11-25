// line-edges.ts: what the line painter reads about an edge before weighting it: the depth either side, whether it lies
// on the silhouette and which way is out, which part inks an edge two parts share, and which edges the subject already
// states as lines, so none is inked twice.

import { stampRingArea, stampRingsDistance, type StampBox, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { SurfaceEvidence } from '#lib/paint/subject/models/subject-evidence.ts';
import { subjectAreaBox, type SubjectArea, type SubjectRing } from '#lib/paint/subject/models/subject-geometry.ts';
import type { PartId } from '#lib/paint/subject/models/subject-id.ts';
import type { VisibleSubjectPart } from '../subject-painter.ts';
import { lineAreaOutlines, type LineOutlinePoint } from './line-strokes.ts';

/** Depth read off the surface evidence: `nearness` 1 at the subject's nearest point, 0 at its farthest. */
export type LineDepthField = {
  readonly depthAt: (x: number, y: number) => number | undefined;
  readonly nearness: (x: number, y: number) => number | undefined;
  readonly span: number;
  /** The sample spacing, px: a probe either side of an edge reaches past it by at least this. */
  readonly cell: number;
};

export function lineDepthField(surface: SurfaceEvidence): LineDepthField {
  const { x0, y0, cell, columns, rows } = surface.layout;
  let near = Infinity, far = -Infinity;
  surface.depth.forEach((d, i) => {
    if (surface.coverage[i] > 0) { near = Math.min(near, d); far = Math.max(far, d); }
  });
  const span = Math.max(far - near, 1e-6);
  const depthAt = (x: number, y: number) => {
    const i = Math.round((x - x0) / cell), j = Math.round((y - y0) / cell);
    if (i < 0 || j < 0 || i >= columns || j >= rows) return undefined;
    const k = j * columns + i;
    return surface.coverage[k] > 0 ? surface.depth[k] : undefined;
  };
  return { depthAt, span, cell, nearness: (x, y) => { const d = depthAt(x, y); return d === undefined ? undefined : 1 - (d - near) / span; } };
}

const boxHolds = (box: StampBox, x: number, y: number, pad: number) => x >= box.x0 - pad && x <= box.x1 + pad && y >= box.y0 - pad && y <= box.y1 + pad;

/** Whether two boxes overlap. */
export const lineBoxesMeet = (a: StampBox, b: StampBox) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** An edge point's normal turned out, and the depth step across it in px (positive: what lies outside is farther). */
export type LineEdgeFacing = { readonly nx: number; readonly ny: number; readonly gap: number | undefined };

/** How the painter reads any edge point against the silhouette and the depth beside it. */
export type LineEdgeReader = {
  /** How near an edge a point must lie to count as on it, px: a traced ring wanders a pixel or two from its neighbour's. */
  readonly tolerance: number;
  /** How far either side of an edge depth is read, px: past the sample spacing, so the two reads differ. */
  readonly probe: number;
  readonly onSilhouette: (point: StampPoint) => boolean;
  /** On the silhouette, out of the figure; inside it, toward the farther surface, as an occluder's edge faces. */
  readonly facing: (point: LineOutlinePoint, onSilhouette: boolean) => LineEdgeFacing;
};

export function lineEdgeReader(silhouette: readonly SubjectRing[], step: number, depth: LineDepthField | undefined): LineEdgeReader {
  const tolerance = Math.max(2.5, step * 1.5), probe = Math.max(3, step * 2, (depth?.cell ?? 0) * 1.5);
  const onSilhouette = ({ x, y }: StampPoint) => Math.abs(stampRingsDistance(silhouette, x, y)) < tolerance;
  const facing = (p: LineOutlinePoint, edge: boolean): LineEdgeFacing => {
    const outside = depth?.depthAt(p.x + p.nx * probe, p.y + p.ny * probe), inside = depth?.depthAt(p.x - p.nx * probe, p.y - p.ny * probe);
    const gap = outside === undefined || inside === undefined ? undefined : outside - inside;
    const flip = edge ? stampRingsDistance(silhouette, p.x + p.nx * probe, p.y + p.ny * probe) > 0 : gap !== undefined && gap < 0;
    return flip ? { nx: -p.nx, ny: -p.ny, gap: gap === undefined ? undefined : -gap } : { nx: p.nx, ny: p.ny, gap };
  };
  return { tolerance, probe, onSilhouette, facing };
}

/** Where a part's outline point lies: on the silhouette, on an edge it shares with another part (inked or not by it), or free. */
export type LineContourEdge = { readonly kind: 'silhouette' } | { readonly kind: 'shared'; readonly owned: boolean } | { readonly kind: 'free' };
export type LineContourPoint = LineOutlinePoint & { readonly edge: LineContourEdge };

/** An area's size in px², its rings summed as if none were a hole: enough to tell which of two areas is the smaller. */
export const lineAreaSize = (area: SubjectArea) => area.rings.reduce((sum, ring) => sum + Math.abs(stampRingArea(ring)), 0);

/**
 * Each visible part's outline, each point labelled. The part in front inks a shared edge, judged by the depth either
 * side summed over the whole edge, else the smaller part, as an eye sits on a head. Pass every visible part, replaced
 * ones too, so ownership never shifts when one is replaced.
 */
export function lineContourOutlines(parts: readonly VisibleSubjectPart[], reader: LineEdgeReader, step: number, depth: LineDepthField | undefined): ReadonlyMap<PartId, readonly LineContourPoint[][]> {
  const { tolerance, probe } = reader;
  const boxes = new Map(parts.map((part) => [part.id, subjectAreaBox(part.visibility.geometry)]));
  const sizes = new Map(parts.map((part) => [part.id, lineAreaSize(part.visibility.geometry)]));
  const neighbourOf = (self: PartId, p: LineOutlinePoint) => parts.find((other) => other.id !== self
    && boxHolds(boxes.get(other.id)!, p.x, p.y, tolerance) && Math.abs(stampRingsDistance(other.visibility.geometry.rings, p.x, p.y)) < tolerance)?.id;
  const gapAt = (p: LineOutlinePoint) => {
    const outside = depth?.depthAt(p.x + p.nx * probe, p.y + p.ny * probe), inside = depth?.depthAt(p.x - p.nx * probe, p.y - p.ny * probe);
    return outside === undefined || inside === undefined ? undefined : outside - inside;
  };
  const sides = new Map(parts.map((part) => [part.id, lineAreaOutlines(part.visibility.geometry, step).map((outline) => outline.map((p) => {
    const silhouette = reader.onSilhouette(p);
    return { p, silhouette, other: silhouette ? undefined : neighbourOf(part.id, p) };
  }))]));
  // One verdict per pair, over its whole edge: point by point, depth noise would ink stretches twice or not at all.
  const pairGap = new Map<string, number>();
  for (const [id, outlines] of sides) {
    for (const { p, other } of outlines.flat()) {
      const gap = other === undefined ? undefined : gapAt(p);
      if (other !== undefined && gap !== undefined) pairGap.set(`${id}|${other}`, (pairGap.get(`${id}|${other}`) ?? 0) + gap);
    }
  }
  const inFront = (self: PartId, other: PartId) => {
    const mine = pairGap.get(`${self}|${other}`) ?? 0, theirs = pairGap.get(`${other}|${self}`) ?? 0;
    if (mine !== theirs) return mine > theirs;
    return sizes.get(self)! < sizes.get(other)! || (sizes.get(self) === sizes.get(other) && self < other);
  };
  return new Map([...sides].map(([id, outlines]) => [id, outlines.map((outline) => outline.map(({ p, silhouette, other }): LineContourPoint => {
    if (silhouette) return { ...p, edge: { kind: 'silhouette' } };
    return { ...p, edge: other === undefined ? { kind: 'free' } : { kind: 'shared', owned: inFront(id, other) } };
  }))]));
}

/** Lines a subject states, indexed to ask whether a point lies on one. */
export type LineStatedEdges = { readonly covers: (point: StampPoint) => boolean };

export function lineStatedEdges(points: readonly StampPoint[], tolerance: number): LineStatedEdges {
  const cellOf = (x: number, y: number) => `${Math.floor(x / tolerance)},${Math.floor(y / tolerance)}`;
  const cells = new Map<string, StampPoint[]>();
  for (const p of points) {
    const key = cellOf(p.x, p.y), cell = cells.get(key);
    if (cell) cell.push(p);
    else cells.set(key, [p]);
  }
  const covers = ({ x, y }: StampPoint) => {
    const i = Math.floor(x / tolerance), j = Math.floor(y / tolerance);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (cells.get(`${i + di},${j + dj}`)?.some((q) => Math.hypot(q.x - x, q.y - y) < tolerance)) return true;
      }
    }
    return false;
  };
  return { covers };
}
