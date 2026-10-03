// shot-reach.ts: where each plane of a shot can hold paint, as the camera build checks it (ENGINE 6.1). The back
// holds paper everywhere. A nearer painted plane holds its layers' stated geometry, padded for paint flowing past it,
// grown along each occurrence's line of motion nodes by the most each can move it, then laid by its plane's still
// lay; its ground's paper, when it lays one, over the document.
//
// Negative space: a plane laid by a callback holds its stated reach (everywhere without one), and one whose source is a
// callback or that holds a rig is checked everywhere: neither can be bounded before it's drawn.

import { paintLevelShift } from '#lib/paint/animation/models/paint-motion-reach.ts';
import type { PaintCameraPlaneOptions } from '#lib/paint/animation/models/paint-camera.ts';
import { paintSimilarityApply, paintSimilarityOf } from '#lib/paint/animation/models/paint-similarity.ts';
import { paintingBoxUnion, paintingNodeBox } from '#lib/paint/document/models/painting-footprint.ts';
import type { StampPlaneExtent } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { CompiledShotPaintedPlane, CompiledShotPlane } from './shot-compile.ts';
import type { CompiledShotMotion, CompiledShotNode } from './shot-motion.ts';
import type { OccurrenceKey } from './shot-props.ts';

/**
 * How far past a layer's stated geometry its paint may lie, px: a wash's flow and blooms, its edge darkening and the
 * lay's bilinear read. Wider than any the gate's sheets paint.
 */
export const SHOT_PAINT_SPREAD = 48;

const grown = ({ x0, y0, x1, y1 }: StampBox, by: number): StampBox => ({ x0: x0 - by, y0: y0 - by, x1: x1 + by, y1: y1 + by });

const clipped = (box: StampBox, { x0, y0, x1, y1 }: StampBox): StampBox | undefined => {
  const met = { x0: Math.max(box.x0, x0), y0: Math.max(box.y0, y0), x1: Math.min(box.x1, x1), y1: Math.min(box.y1, y1) };
  return met.x0 < met.x1 && met.y0 < met.y1 ? met : undefined;
};

/** The most `node` moves a point of `box`: its own bend and placement, its pins included, and its boil's wobble. */
export function shotNodeShift(node: CompiledShotNode, box: StampBox): number {
  return paintLevelShift(node, box, true) + (node.marks.kind === 'wobble' ? node.marks.wobble.amount : 0);
}

/** `box` grown along the line of nodes from `id` (an occurrence's nearest) out through each parent: innermost first. */
export function shotNodeLineGrown(motion: CompiledShotMotion, id: string | undefined, box: StampBox): StampBox {
  let reached = box;
  for (let node = id === undefined ? undefined : motion.nodes.get(id); node; node = node.parent === null ? undefined : motion.nodes.get(node.parent)) {
    reached = grown(reached, shotNodeShift(node, reached));
  }
  return reached;
}

/** Where a still nearer painted plane's paint and paper can lie, document px moved by its nodes, before its lay. */
function paintedReach(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion): StampBox | undefined {
  const { painting, ground } = plane.first, { widthPx, heightPx } = painting.document, documentBox = { x0: 0, y0: 0, x1: widthPx, y1: heightPx };
  let reach: StampBox | undefined;
  for (const occurrence of plane.occurrences) {
    if (occurrence.kind !== 'layer') continue;
    const place = painting.tree.byKey.get(occurrence.node)!, stated = paintingNodeBox(place.node), held = stated && clipped(grown(stated, SHOT_PAINT_SPREAD), documentBox);
    if (held) reach = paintingBoxUnion(reach, shotNodeLineGrown(motion, motion.nearest.get(occurrence.key), held));
  }
  if (ground === 'paper') reach = paintingBoxUnion(reach, shotNodeLineGrown(motion, motion.nodes.has(plane.id) ? plane.id : undefined, documentBox));
  return reach;
}

/** A painted plane's extent for the camera: everywhere for the back, else as the file's head says. */
function paintedExtent(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, rigged: ReadonlySet<OccurrenceKey>): StampPlaneExtent {
  if (plane.back) return { kind: 'everywhere' };
  if (plane.lay.kind === 'moving') return plane.lay.reach ? { kind: 'box', box: plane.lay.reach } : { kind: 'everywhere' };
  if (typeof plane.source === 'function' || plane.occurrences.some(({ key }) => rigged.has(key))) return { kind: 'everywhere' };
  const reach = paintedReach(plane, motion);
  if (!reach) return { kind: 'empty' };
  const { lay } = plane.lay;
  if (!lay) return { kind: 'box', box: reach };
  const map = paintSimilarityOf(lay.placement, lay.pivot);
  const corners = [{ x: reach.x0, y: reach.y0 }, { x: reach.x1, y: reach.y0 }, { x: reach.x0, y: reach.y1 }, { x: reach.x1, y: reach.y1 }].map((corner) => paintSimilarityApply(map, corner));
  const xs = corners.map(({ x }) => x), ys = corners.map(({ y }) => y);
  return { kind: 'box', box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } };
}

/** The camera build's planes for a shot's `planes`: each painted plane a picture plane held as far as its reach. */
export function shotCameraPlanes(planes: readonly CompiledShotPlane[], motion: CompiledShotMotion, rigs: ReadonlyMap<OccurrenceKey, unknown>): PaintCameraPlaneOptions[] {
  const rigged = new Set(rigs.keys());
  return planes.map((plane): PaintCameraPlaneOptions => {
    const { id, depth } = plane;
    if (plane.kind === 'three') return { id, depth, kind: 'three' };
    if (plane.kind === 'picture') return { id, depth, kind: 'picture', extent: plane.source.extent };
    return { id, depth, kind: 'picture', extent: paintedExtent(plane, motion, rigged) };
  });
}
