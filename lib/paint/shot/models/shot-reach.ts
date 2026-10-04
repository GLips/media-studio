// shot-reach.ts: where each plane of a shot can hold paint, as the camera build checks it (ENGINE 6.1). The opaque
// back holds paper everywhere (its paint: shot-back.ts). A nearer painted plane holds its layers' stated geometry,
// padded for paint flowing past it, grown along each occurrence's line of motion nodes by the most each can move it,
// then laid by its still lay; its ground's paper, when it lays one, over the document.
//
// Negative space: a plane laid by a callback holds its stated reach (everywhere without one), and one whose source is a
// callback or that holds a rig is checked everywhere: neither can be bounded before it's drawn. A pin or cover is
// checked once laid (shot-placement.ts).

import { paintLevelShift } from '#lib/paint/animation/models/paint-motion-reach.ts';
import type { PaintCameraPicturePlane, PaintCameraPlaneOptions } from '#lib/paint/animation/models/paint-camera.ts';
import { paintSimilarityBox, paintSimilarityOf } from '#lib/paint/animation/models/paint-similarity.ts';
import { paintingBoxUnion, paintingNodeBox } from '#lib/paint/document/models/painting-footprint.ts';
import type { StampPlaneExtent } from '#lib/paint/painting/models/stamp-plane.ts';
import { stampBoxGrown, type StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { CompiledShotPaintedPlane, CompiledShotPlane } from './shot-compile.ts';
import type { CompiledShotMotion, CompiledShotNode } from './shot-motion.ts';
import { paintedSourceNodeKeys, shotOccurrenceKey } from './shot-occurrences.ts';
import type { OccurrenceKey } from './shot-props.ts';

/**
 * How far past a layer's stated geometry its paint may lie, px: a wash's flow and blooms, its edge darkening and the
 * lay's bilinear read. Wider than any the gate's sheets paint.
 */
export const SHOT_PAINT_SPREAD = 48;

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
    reached = stampBoxGrown(reached, shotNodeShift(node, reached));
  }
  return reached;
}

/**
 * Where a still nearer painted plane's paint and paper can lie, document px moved by its nodes, before its lay: over
 * every selection it names, each occurrence's layer as the selection showing it paints it, and its paper where its
 * ground, one for them all, is paper.
 */
function paintedReach(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion): StampBox | undefined {
  const { widthPx, heightPx, ground } = plane.paints, documentBox = { x0: 0, y0: 0, x1: widthPx, y1: heightPx };
  let reach: StampBox | undefined;
  for (const { selection } of plane.ends) {
    for (const key of paintedSourceNodeKeys(selection)) {
      const place = selection.painting.tree.byKey.get(key)!, stated = place.kind === 'layer' && paintingNodeBox(place.node), held = stated && clipped(stampBoxGrown(stated, SHOT_PAINT_SPREAD), documentBox);
      if (held) reach = paintingBoxUnion(reach, shotNodeLineGrown(motion, motion.nearest.get(shotOccurrenceKey(plane.id, key)), held));
    }
  }
  if (ground === 'paper') reach = paintingBoxUnion(reach, shotNodeLineGrown(motion, motion.nodes.has(plane.id) ? plane.id : undefined, documentBox));
  return reach;
}

/**
 * A painted plane's extent for the camera, `rigged` naming the rigged occurrences: everywhere for the opaque back,
 * unchecked for a plane laid on the frame until laid (shot-placement.ts checks it then), else as the file's head says.
 */
export function shotPaintedExtent(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, rigged: ReadonlySet<OccurrenceKey>): StampPlaneExtent {
  if (plane.opaqueBack) return { kind: 'everywhere' };
  if (plane.lay.kind === 'screen') return { kind: 'unchecked', why: 'laid on the frame through the camera, it is checked where it lies once laid' };
  if (plane.lay.kind === 'moving') return plane.lay.reach ? { kind: 'box', box: plane.lay.reach } : { kind: 'everywhere' };
  if (typeof plane.source === 'function' || plane.occurrences.some(({ key }) => rigged.has(key))) return { kind: 'everywhere' };
  const reach = paintedReach(plane, motion);
  if (!reach) return { kind: 'empty' };
  const { lay } = plane.lay;
  if (!lay) return { kind: 'box', box: reach };
  return { kind: 'box', box: paintSimilarityBox(paintSimilarityOf(lay.placement, lay.pivot), reach) };
}

/** Painted plane `plane` as the camera build takes it, `rigged` naming the rigged occurrences: a picture plane held as far as its reach. */
export const shotPaintedCameraPlane = (plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, rigged: ReadonlySet<OccurrenceKey>): PaintCameraPicturePlane =>
  ({ id: plane.id, depth: plane.depth, kind: 'picture', extent: shotPaintedExtent(plane, motion, rigged) });

/** The camera build's planes for a shot's `planes`: each painted plane a picture plane held as far as its reach. */
export function shotCameraPlanes(planes: readonly CompiledShotPlane[], motion: CompiledShotMotion, rigs: ReadonlyMap<OccurrenceKey, unknown>): PaintCameraPlaneOptions[] {
  const rigged = new Set(rigs.keys());
  return planes.map((plane): PaintCameraPlaneOptions => {
    const { id, depth } = plane;
    if (plane.kind === 'three') return { id, depth, kind: 'three' };
    if (plane.kind === 'picture') return { id, depth, kind: 'picture', extent: plane.source.extent };
    return shotPaintedCameraPlane(plane, motion, rigged);
  });
}
