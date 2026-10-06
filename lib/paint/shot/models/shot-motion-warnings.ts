// shot-motion-warnings.ts: a compiled shot's motion judged over its span (paint-motion-warnings.ts): warnings beside a
// shot that draws, which `studio paint check` and the render print, never refusals. Each drawable (a plane, and an
// occurrence with a node or a visibility of its own) is followed as a similarity, document px to frame px: the
// camera's view after its lay after its nodes' placements.
//
// Negative space: bends (pins, sway, flutter, boil) and rigs' poses move paint within a drawable and aren't followed;
// nor are instanced planes' items, three planes, or a plane pinned to HTML, laid only as each frame measures it.

import { paintPlaneSimilarity, paintStageCentre, type PaintCameraPose } from '#lib/paint/animation/models/paint-camera.ts';
import { paintLevelPlacementAt } from '#lib/paint/animation/models/paint-motion-frame.ts';
import { paintMotionWarnings, type PaintMotionFollowed } from '#lib/paint/animation/models/paint-motion-warnings.ts';
import { PAINT_SIMILARITY_IDENTITY, paintSimilarityAfter, paintSimilarityOf, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { PaintSpanFrame } from '#lib/paint/animation/models/paint-span-moments.ts';
import { presentationValueAt, type PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import { paintingNodeBox } from '#lib/paint/document/models/painting-footprint.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import { stampStageExtent } from '#lib/paint/painting/models/stamp-stage.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane, CompiledShotPlane } from './shot-compile.ts';
import { shotPlaneLayAt, shotPlaneMomentAt } from './shot-frame-plan.ts';

/** The occurrence `key` of `plane`'s box: its node's in the first end showing it. */
function occurrenceBox(plane: CompiledShotPaintedPlane, node: string): StampBox | undefined {
  for (const { selection } of plane.ends) {
    const place = selection.painting.tree.byKey.get(node);
    if (place) return paintingNodeBox(place.node);
  }
  return undefined;
}

/** Each drawable of `shot` followed (see the file's head), `cameraAt` the camera's pose at a sample, kept. */
function followedDrawables(shot: CompiledPaintedShot, cameraAt: (sample: number) => PaintCameraPose): PaintMotionFollowed[] {
  const { camera, motion } = shot, centre = paintStageCentre(camera.stage), fps = motion.animationFps;
  const placements = new Map<string, PaintSimilarity[]>();
  const nodePlaceAt = (id: string, moment: PaintMoment, sample: number) => {
    const memo = placements.get(id) ?? [];
    placements.set(id, memo);
    memo[sample] ??= (() => {
      const place = paintLevelPlacementAt(motion.nodes.get(id)!, moment, fps);
      return place ? paintSimilarityOf(place.placement, place.pivot) : PAINT_SIMILARITY_IDENTITY;
    })();
    return memo[sample];
  };
  const visibilityOf = (plane: string, key: string) => {
    const value: PresentationValue<number> | undefined = shot.visibility.get(key);
    return (moment: PaintMoment) => (value === undefined ? 1 : presentationValueAt(value, shotPlaneMomentAt(motion, plane, moment)));
  };
  const followed: PaintMotionFollowed[] = [];
  for (const plane of shot.planes) {
    const followable = plane.kind === 'picture' || (plane.kind === 'painted' && plane.lay.kind !== 'screen');
    if (!followable) continue;
    const box = planeBox(shot, plane);
    if (!box) continue;
    // Plane px to frame px, then the plane's lay and node.
    const planeAt = (moment: PaintMoment, sample: number): PaintSimilarity => {
      const view = paintPlaneSimilarity(cameraAt(sample), presentationValueAt(plane.depth, moment), centre);
      const lay = plane.kind === 'painted' ? shotPlaneLayAt(plane, motion, moment) : PAINT_SIMILARITY_IDENTITY;
      return paintSimilarityAfter(paintSimilarityAfter(view, lay), motion.nodes.has(plane.id) ? nodePlaceAt(plane.id, moment, sample) : PAINT_SIMILARITY_IDENTITY);
    };
    followed.push({ name: plane.id, plane: plane.id, moves: true, box, placeAt: planeAt, visibilityAt: visibilityOf(plane.id, plane.id) });
    if (plane.kind !== 'painted') continue;
    for (const occurrence of plane.occurrences) {
      if (!motion.nodes.has(occurrence.key) && !shot.visibility.has(occurrence.key)) continue;
      const occurrenceBoxFound = occurrenceBox(plane, occurrence.node);
      if (!occurrenceBoxFound) continue;
      // Its nodes, nearest first, up to (not including) its plane's. One with no node of its own moves as the occurrence
      // owning its nearest does, which warns of that motion.
      const line: string[] = [];
      for (let id = motion.nearest.get(occurrence.key); id !== undefined && id !== plane.id; id = motion.nodes.get(id)!.parent ?? undefined) line.push(id);
      followed.push({
        name: occurrence.key, plane: plane.id, moves: line[0] === occurrence.key, box: occurrenceBoxFound, visibilityAt: visibilityOf(plane.id, occurrence.key),
        placeAt: (moment, sample) => line.reduceRight((outer, id) => paintSimilarityAfter(outer, nodePlaceAt(id, moment, sample)), planeAt(moment, sample)),
      });
    }
  }
  return followed;
}

/** A plane's box, plane px: a painted plane's document, a picture's extent (the stage for one everywhere); none for one empty. */
function planeBox(shot: CompiledPaintedShot, plane: CompiledShotPlane): StampBox | undefined {
  if (plane.kind === 'painted') return { x0: 0, y0: 0, x1: plane.paints.widthPx, y1: plane.paints.heightPx };
  if (plane.kind !== 'picture') return undefined;
  const { extent } = plane.source;
  if (extent.kind === 'box') return extent.box;
  return extent.kind === 'everywhere' ? stampStageExtent(shot.camera.stage) : undefined;
}

/** `shot`'s motion over `frames` judged (paint-motion-warnings.ts), as warnings by drawable. */
export function shotMotionWarnings(shot: CompiledPaintedShot, frames: readonly PaintSpanFrame[]): PaintingProblem[] {
  return paintMotionWarnings(shot.camera, frames, (cameraAt) => followedDrawables(shot, cameraAt)).map(({ name, message }) => paintingProblem('warning', name, 'motion', message));
}
