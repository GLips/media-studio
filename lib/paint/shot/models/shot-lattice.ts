// shot-lattice.ts: the lattices a shot lays its sheets through (ENGINE 6.2), purely: triangles from where a point
// lies on the plane back to where its sheet holds it, and each vertex's travel over the shutter. A film's marks were
// solved posed at the frame's moment; where they pose otherwise at the moment laid (an exposure, a shutter's end),
// the lattice carries the solved paint there: each rest point lies where the marks then put it and is read where the
// solve put it.
//
// A lattice whose maps are all similarities is one cell, exact; a warp's is cells STAMP_WARP_CELL apart. A vertex's
// travel is stampTravel's, the one producer an old painting's groups share.

import { paintSimilarityBox, paintSimilarityInverse, paintSimilarityScale } from '#lib/paint/animation/models/paint-similarity.ts';
import { paintingPoseFitOver, paintingPoseMap, paintingPoseText, type PaintingNodePose } from '#lib/paint/document/models/painting-pose.ts';
import { stampTravel, type StampTravelEnd } from '#lib/paint/painting/models/stamp-frame-plan.ts';
import { STAMP_WARP_CELL, stampWarpCells, stampWarpTriangles, type StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';

/**
 * A lattice: its triangles, four floats a vertex (where it lies, plane px; where it's read, sheet px), and each
 * vertex's travel over the shutter, plane px, two floats a vertex (null: it lies still).
 */
export type ShotLattice = { readonly triangles: Float32Array; readonly travel: Float32Array | null };

/** A sheet as it lies at one moment: its placement (document px to plane px), and a film's marks' map then. */
export type ShotSheetAt = { readonly place: PaintingNodePose; readonly marks: PaintingNodePose };

/** The shutter's ends, when the frame gathers what moves over it. */
export type ShotShutterAt<T> = { readonly open: T; readonly close: T } | null;

type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

const boxOf = ({ x0, y0, x1, y1 }: StampBox): Box => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });

const grownBox = ({ x, y, w, h }: Box, by: number): Box => ({ x: x - by, y: y - by, w: w + 2 * by, h: h + 2 * by });

/**
 * The lattice over `box` (rest points) laid by `dest`, read at `sample` (rest points as they are when null), with
 * each vertex's `travel` from its rest point. `warped`: cells a warp needs, else one.
 */
function shotLatticeOver(box: Box, warped: boolean, dest: StampWarpMap, sample: StampWarpMap | null, travel: StampWarpMap | null): ShotLattice {
  const { columns, rows } = warped ? stampWarpCells(box.w, box.h, STAMP_WARP_CELL) : { columns: 1, rows: 1 };
  const triangles = stampWarpTriangles(dest, box, columns, rows), travels = travel ? new Float32Array(triangles.length / 2) : null;
  for (let v = 0; v < triangles.length; v += 4) {
    const rest = { x: triangles[v + 2], y: triangles[v + 3] };
    if (travels) {
      const moved = travel!(rest);
      travels[v / 2] = moved.x;
      travels[v / 2 + 1] = moved.y;
    }
    if (sample) {
      const read = sample(rest);
      triangles[v + 2] = read.x;
      triangles[v + 3] = read.y;
    }
  }
  return { triangles, travel: travels };
}

const isWarp = (...poses: readonly PaintingNodePose[]) => poses.some(({ kind }) => kind === 'warp');

const poseEnd = (pose: PaintingNodePose): StampTravelEnd => ({ map: paintingPoseMap(pose), key: paintingPoseText(pose) });

/** How far `ends` lay each end apart (stampTravel): null without a shutter or where they lie alike. */
const travelOf = <T,>(ends: ShotShutterAt<T>, endOf: (end: T) => StampTravelEnd) => (ends && stampTravel(endOf(ends.open), endOf(ends.close))?.travel) ?? null;

/**
 * Sheet px laid by a placement: `box` (sheet px) where `at` puts it, read where it is, tracing its travel between
 * `shutter`'s ends. A card's lattice, the ground's, and a film's whose marks pose alike when laid as when solved.
 */
export function shotPlacedLattice(box: StampBox, at: PaintingNodePose, shutter: ShotShutterAt<PaintingNodePose>): ShotLattice {
  const warped = isWarp(at, ...(shutter ? [shutter.open, shutter.close] : []));
  // A pixel past the box for the lay's bilinear read, which one similarity cell carries exactly.
  return shotLatticeOver(grownBox(boxOf(box), warped ? 0 : 1), warped, paintingPoseMap(at), null, travelOf(shutter, poseEnd));
}

/** Where a sheet at `each` lays a rest point: its marks' pose, then its place. */
function sheetAtMap(each: ShotSheetAt): StampWarpMap {
  const place = paintingPoseMap(each.place), marks = paintingPoseMap(each.marks);
  return (point) => place(marks(point));
}

const sheetEnd = (each: ShotSheetAt): StampTravelEnd => ({ map: sheetAtMap(each), key: `${paintingPoseText(each.place)}|${paintingPoseText(each.marks)}` });

/**
 * A film's lattice: its painted `box` (sheet px), solved posed by `solved`, laid `at` a moment, travelling over
 * `shutter`. Marks posed alike throughout lay the box by its placement; otherwise each rest point (the box mapped back
 * through `solved`'s fit over `fitBox`, the layer's paint at rest) lies where `at` puts it, read where `solved` did.
 */
export function shotFilmLattice(box: StampBox, solved: PaintingNodePose, at: ShotSheetAt, shutter: ShotShutterAt<ShotSheetAt>, fitBox: StampBox | undefined): ShotLattice {
  const text = paintingPoseText(solved), still = (each: ShotSheetAt) => paintingPoseText(each.marks) === text;
  if (still(at) && (!shutter || (still(shutter.open) && still(shutter.close)))) return shotPlacedLattice(box, at.place, shutter && { open: shutter.open.place, close: shutter.close.place });
  // The bend's stray from its fit grows the rest box to hold all the solved paint came from.
  const solvedMap = paintingPoseMap(solved), { fit, stray } = paintingPoseFitOver(solved, fitBox ?? box);
  const rest = paintSimilarityBox(paintSimilarityInverse(fit), box), pad = (stray + 1) / paintSimilarityScale(fit) + 1;
  const warped = isWarp(solved, at.place, at.marks, ...(shutter ? [shutter.open.place, shutter.open.marks, shutter.close.place, shutter.close.marks] : []));
  return shotLatticeOver(grownBox(boxOf(rest), pad), warped, sheetAtMap(at), solvedMap, travelOf(shutter, sheetEnd));
}
