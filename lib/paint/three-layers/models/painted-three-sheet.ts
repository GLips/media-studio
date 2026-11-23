// painted-three-sheet.ts: a folded sheet in three.js, its pure side. A sheet is one print cut into faces (polygons in
// the flat print's px) hinged in a tree from its root face; folding each hinge by an angle in time makes tabs, tents,
// boxes, a page turning or a map unfolding.
//
// Sheet space is the flat print's px with y turned up (x, −y) and z out of its front, its paper centred on z = 0. A
// face's matrix carries sheet space to where that face lies folded, so its mesh is built in the flat layout and
// samples the one print at its own px: the print spans the folded sheet with no seams.

import { Matrix4, Vector3 } from 'three';
import { svgPathRegions } from '#lib/paint/animation/models/figure/svg-path-figure.ts';
import { presentationValueAt, type PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { checkedStampPolygon, stampPolygonBox, stampPolygonInside, stampRingArea, stampRingsCross, type StampBox, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';

/** One closed ring in flat print px (y down): its points, or one closed SVG path's data. */
export type PaintedThreeSheetRing = readonly StampPoint[] | string;

/** A straight edge in flat print px, from one point on a face's outline to another. */
export type PaintedThreeSheetEdge = { readonly from: StampPoint; readonly to: StampPoint };

/** A face: its `outline`, and any `holes` cut through it (windows, slots), each inside the outline. */
export type PaintedThreeSheetFace = { readonly outline: PaintedThreeSheetRing; readonly holes?: readonly PaintedThreeSheetRing[] };

/**
 * The root face, which stays put while the others fold about it. `hinge`, when the sheet stands on something else (a
 * pop-up's card on its base): the edge it stands on, which gets no cut edge and is where contact darkens it.
 */
export type PaintedThreeSheetRoot = PaintedThreeSheetFace & { readonly hinge?: PaintedThreeSheetEdge };

/**
 * A face folding off another: `on`, its parent face's id (the root when left out); `hinge`, the edge they share, along
 * both outlines; `angle`, radians from flat, positive turning it toward the sheet's front. A hinge is a fold, not a
 * cut: no cut edge is drawn along it.
 */
export type PaintedThreeSheetFold = PaintedThreeSheetFace & {
  readonly id: string;
  readonly on?: string;
  readonly hinge: PaintedThreeSheetEdge;
  readonly angle: PresentationValue<number>;
};

/**
 * A sheet: `print`, the painted texture's id every face shows (`widthPx` × `heightPx`, its size), cut into `root` and
 * the faces that fold off it. `thicknessPx`: its paper, PAINTED_THREE_SHEET_THICKNESS of its height when left out.
 * A card is a sheet with no folds.
 */
export type PaintedThreeSheet = {
  readonly print: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly root: PaintedThreeSheetRoot;
  readonly folds?: readonly PaintedThreeSheetFold[];
  readonly thicknessPx?: number;
};

/** The root face's id, which no fold may take. */
export const PAINTED_THREE_SHEET_ROOT = 'root';
/** A sheet's paper thickness when it names none, of its height. */
export const PAINTED_THREE_SHEET_THICKNESS = 0.02;

/** A sheet's paper thickness, print px. */
export const paintedThreeSheetThickness = ({ heightPx, thicknessPx }: Pick<PaintedThreeSheet, 'heightPx' | 'thicknessPx'>) => thicknessPx ?? PAINTED_THREE_SHEET_THICKNESS * heightPx;

/** What an edge of a face is: `cut` through the paper, `fold`ed on a hinge to another face, or where the sheet `stand`s. */
export type PaintedThreeSheetEdgeKind = 'cut' | 'fold' | 'stand';

/** A stretch of a face's rings, of one kind; `outward` its unit normal away from the paper (y down). */
export type PaintedThreeSheetFaceEdge = { readonly from: StampPoint; readonly to: StampPoint; readonly kind: PaintedThreeSheetEdgeKind; readonly outward: StampPoint };

/** A face as cut: its `rings` (outline first, then holes; even-odd), its edges split where hinges end, and the box round it. */
export type PaintedThreeSheetFaceCut = { readonly id: string; readonly rings: readonly (readonly StampPoint[])[]; readonly edges: readonly PaintedThreeSheetFaceEdge[]; readonly box: StampBox };

/** How near a point must lie to an edge's line to be on it, print px. */
const PAINTED_THREE_SHEET_ON_EDGE = 0.5;

/** How far `p` lies from the segment `a`–`b`, and how far along it (a share, unclamped) its foot is. */
function towardSegment(p: StampPoint, a: StampPoint, b: StampPoint): { distance: number; along: number; offLine: number } {
  const ex = b.x - a.x, ey = b.y - a.y, length2 = ex * ex + ey * ey || 1, along = ((p.x - a.x) * ex + (p.y - a.y) * ey) / length2, clamped = Math.min(1, Math.max(0, along));
  return { distance: Math.hypot(p.x - a.x - ex * clamped, p.y - a.y - ey * clamped), along, offLine: Math.abs((p.x - a.x) * ey - (p.y - a.y) * ex) / Math.sqrt(length2) };
}

/** A ring traced to points, flat print px. Refuses one that isn't a single closed area, `what` naming it. */
export function paintedThreeSheetRingPoints(ring: PaintedThreeSheetRing, what: string): readonly StampPoint[] {
  const regions = typeof ring === 'string' ? svgPathRegions(ring).regions : [{ kind: 'polygon' as const, points: ring }];
  if (regions.length !== 1) throw new Error(`${what}: a ring is one closed shape, not ${regions.length}`);
  return checkedStampPolygon(regions[0], what);
}

/**
 * Ring `ring`'s segments split where any of `hinges` begins or ends along them, each piece of the kind of the hinge
 * it lies along (`cut` along none), with its outward normal; `hole` turns it, as a hole's paper lies outside it.
 */
function ringEdges(ring: readonly StampPoint[], hole: boolean, hinges: readonly { edge: PaintedThreeSheetEdge; kind: PaintedThreeSheetEdgeKind }[]): PaintedThreeSheetFaceEdge[] {
  // Outward is to the right of each segment's run on a ring turning clockwise on screen (y down), to its left otherwise.
  const turn = Math.sign(stampRingArea(ring)) * (hole ? -1 : 1);
  return ring.flatMap((a, k) => {
    const b = ring[(k + 1) % ring.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    const outward = { x: (turn * (b.y - a.y)) / length, y: (-turn * (b.x - a.x)) / length };
    const splits = hinges.flatMap(({ edge }) => [edge.from, edge.to].map((p) => towardSegment(p, a, b)).filter(({ offLine, along }) => offLine <= PAINTED_THREE_SHEET_ON_EDGE && along > 0 && along < 1).map(({ along }) => along));
    const shares = [0, ...[...new Set(splits)].toSorted((s, t) => s - t), 1], at = (s: number) => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s });
    return shares.slice(1).map((s, i) => {
      const from = at(shares[i]), to = at(s), middle = at((shares[i] + s) / 2);
      const along = hinges.find(({ edge }) => [from, middle, to].every((p) => towardSegment(p, edge.from, edge.to).distance <= PAINTED_THREE_SHEET_ON_EDGE));
      return { from, to, kind: along?.kind ?? 'cut', outward };
    });
  });
}

/** An edge as an error names it. */
const hingeText = ({ from, to }: PaintedThreeSheetEdge) => `from (${from.x}, ${from.y}) to (${to.x}, ${to.y})`;

/** A face's points' mean, sheet space (y up). */
const faceMean = (polygon: readonly StampPoint[]) => polygon.reduce<Vector3>((sum, p) => sum.add(new Vector3(p.x / polygon.length, -p.y / polygon.length, 0)), new Vector3());

/**
 * The axis a face turns about on `hinge`, in sheet space (y up): unit length, along the hinge, turning by +θ carries
 * the face's body, its points' side of the hinge, toward +z.
 */
export function paintedThreeSheetHingeAxis(hinge: PaintedThreeSheetEdge, polygon: readonly StampPoint[]): Vector3 {
  const { from, to } = hinge, middle = new Vector3((from.x + to.x) / 2, -(from.y + to.y) / 2, 0);
  const along = new Vector3(to.x - from.x, -(to.y - from.y), 0).normalize(), body = faceMean(polygon).sub(middle);
  body.addScaledVector(along, -body.dot(along)).normalize();
  return body.cross(new Vector3(0, 0, 1));
}

/** A sheet as folded: its faces, parents first; each face's cut; its paper; each face's matrix at a moment. */
export type PaintedThreeSheetFolding = {
  /** The root's id, then each fold's, every parent before its children. */
  readonly order: readonly string[];
  /** Each face as cut, by id. */
  readonly faces: ReadonlyMap<string, PaintedThreeSheetFaceCut>;
  /** Its paper's thickness, print px. */
  readonly thickness: number;
  /** Sheet space to each face's folded place at `moment`, by id: the root's is the identity. */
  readonly poseAt: (moment: PaintMoment) => ReadonlyMap<string, Matrix4>;
};

/**
 * `sheet` folded (PaintedThreeSheetFolding). Refuses a ring that isn't one closed area, a hole outside its face, a
 * fold id taken twice or the root's, a parent that isn't a face, faces that fold off each other round a loop, and a
 * hinge (or the root's) lying along none of its face's outline or its parent's.
 */
export function paintedThreeSheetFolding(sheet: PaintedThreeSheet): PaintedThreeSheetFolding {
  const what = `painted three sheet ${sheet.print}`, folds = sheet.folds ?? [], byId = new Map<string, PaintedThreeSheetFold>();
  for (const fold of folds) {
    if (fold.id === PAINTED_THREE_SHEET_ROOT || byId.has(fold.id)) throw new Error(`${what}: face id ${fold.id} is taken`);
    byId.set(fold.id, fold);
  }
  const order = [PAINTED_THREE_SHEET_ROOT], placed = new Set(order);
  while (order.length <= folds.length) {
    const ready = folds.filter((fold) => !placed.has(fold.id) && placed.has(fold.on ?? PAINTED_THREE_SHEET_ROOT));
    if (!ready.length) {
      const stuck = folds.filter((fold) => !placed.has(fold.id)), missing = stuck.find((fold) => fold.on !== undefined && !byId.has(fold.on));
      throw new Error(missing ? `${what}: face ${missing.id} folds off ${missing.on}, which is no face` : `${what}: faces ${stuck.map(({ id }) => id).join(', ')} fold off each other round a loop`);
    }
    for (const fold of ready) {
      order.push(fold.id);
      placed.add(fold.id);
    }
  }

  const faceOf = (id: string): PaintedThreeSheetFace => (id === PAINTED_THREE_SHEET_ROOT ? sheet.root : byId.get(id)!);
  // Each face's hinges: its own fold, its children's, and the root's stand.
  const ownHinge = (id: string): { edge: PaintedThreeSheetEdge; kind: PaintedThreeSheetEdgeKind }[] => {
    if (id !== PAINTED_THREE_SHEET_ROOT) return [{ edge: byId.get(id)!.hinge, kind: 'fold' }];
    return sheet.root.hinge ? [{ edge: sheet.root.hinge, kind: 'stand' }] : [];
  };
  const hingesOf = (id: string) => [
    ...ownHinge(id),
    ...folds.filter((fold) => (fold.on ?? PAINTED_THREE_SHEET_ROOT) === id).map((fold) => ({ edge: fold.hinge, kind: 'fold' as const })),
  ];
  const faces = new Map(order.map((id): [string, PaintedThreeSheetFaceCut] => {
    const face = faceOf(id), outline = paintedThreeSheetRingPoints(face.outline, `${what}'s face ${id}`), holes = (face.holes ?? []).map((hole) => paintedThreeSheetRingPoints(hole, `${what}'s face ${id}'s hole`));
    for (const hole of holes) {
      if (stampRingsCross(outline, hole) || !hole.every(({ x, y }) => stampPolygonInside(outline, x, y))) throw new Error(`${what}: face ${id} has a hole outside its outline`);
    }
    const edges = [...ringEdges(outline, false, hingesOf(id)), ...holes.flatMap((hole) => ringEdges(hole, true, []))];
    return [id, { id, rings: [outline, ...holes], edges, box: stampPolygonBox(outline) }];
  }));
  const along = (id: string, edge: PaintedThreeSheetEdge) => faces.get(id)!.edges.some((each) => each.kind !== 'cut' && [each.from, each.to].every((p) => towardSegment(p, edge.from, edge.to).distance <= PAINTED_THREE_SHEET_ON_EDGE));
  if (sheet.root.hinge && !along(PAINTED_THREE_SHEET_ROOT, sheet.root.hinge)) throw new Error(`${what}: its root's hinge ${hingeText(sheet.root.hinge)} lies along none of its outline`);
  for (const fold of folds) {
    const parent = fold.on ?? PAINTED_THREE_SHEET_ROOT;
    if (!along(fold.id, fold.hinge) || !along(parent, fold.hinge)) throw new Error(`${what}: face ${fold.id}'s hinge ${hingeText(fold.hinge)} lies along none of its outline or none of ${parent}'s`);
  }

  // Each fold turns about its hinge at mid-thickness, where both faces' paper meets: a little overlaps inside the fold.
  const turns = new Map(folds.map((fold) => {
    const { from, to } = fold.hinge, pivot = new Vector3((from.x + to.x) / 2, -(from.y + to.y) / 2, 0);
    return [fold.id, { pivot, axis: paintedThreeSheetHingeAxis(fold.hinge, faces.get(fold.id)!.rings[0]) }] as const;
  }));
  return {
    order,
    faces,
    thickness: paintedThreeSheetThickness(sheet),
    poseAt: (moment) => {
      const matrices = new Map([[PAINTED_THREE_SHEET_ROOT, new Matrix4()]]);
      for (const id of order.slice(1)) {
        const fold = byId.get(id)!, { pivot, axis } = turns.get(id)!;
        const turned = new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(new Matrix4().makeRotationAxis(axis, presentationValueAt(fold.angle, moment))).multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
        matrices.set(id, matrices.get(fold.on ?? PAINTED_THREE_SHEET_ROOT)!.clone().multiply(turned));
      }
      return matrices;
    },
  };
}

/** Texels along a face field's longer side: a texel spans 2 screen px on a face shown 512 px across. */
export const PAINTED_THREE_SHEET_FIELD_TEXELS = 256;
/** What a field holds past any stand edge or cut, print px: far enough that nothing reads as contact or edge. */
const PAINTED_THREE_SHEET_FIELD_FAR = 1e4;

/**
 * A face's distance field over its box, `columns` × `rows` texels of `cell` print px from (`x0`, `y0`), row 0 the top.
 * Per texel: distance to the nearest cut (print px, positive inside), to the nearest stand edge, and that cut's
 * outward normal (y down). Folds are in neither. Bilinear filtering keeps a straight edge's distance exact.
 */
export type PaintedThreeSheetField = { readonly x0: number; readonly y0: number; readonly columns: number; readonly rows: number; readonly cell: number; readonly values: Float32Array };

/** `face`'s distance field (PaintedThreeSheetField). */
export function paintedThreeSheetField({ rings, edges, box }: PaintedThreeSheetFaceCut): PaintedThreeSheetField {
  const cell = Math.max(box.x1 - box.x0, box.y1 - box.y0) / PAINTED_THREE_SHEET_FIELD_TEXELS;
  const columns = Math.ceil((box.x1 - box.x0) / cell), rows = Math.ceil((box.y1 - box.y0) / cell), values = new Float32Array(columns * rows * 4);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const p = { x: box.x0 + (i + 0.5) * cell, y: box.y0 + (j + 0.5) * cell };
      let cut = PAINTED_THREE_SHEET_FIELD_FAR, nearest = { x: 0, y: 0 }, stand = PAINTED_THREE_SHEET_FIELD_FAR;
      for (const { from, to, kind, outward } of edges) {
        if (kind === 'fold') continue;
        const { distance } = towardSegment(p, from, to);
        if (kind === 'stand') stand = Math.min(stand, distance);
        else if (distance < cut) [cut, nearest] = [distance, outward];
      }
      const inside = rings.reduce((within, ring) => within !== stampPolygonInside(ring, p.x, p.y), false) ? 1 : -1;
      values.set([inside * cut, stand, nearest.x, nearest.y], (j * columns + i) * 4);
    }
  }
  return { x0: box.x0, y0: box.y0, columns, rows, cell, values };
}
