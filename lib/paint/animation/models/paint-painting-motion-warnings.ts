// paint-painting-motion-warnings.ts: a StampPainting's motion judged over its camera's span (paint-motion-warnings.ts),
// as buildPaintingCamera hands them on. Each plane is followed through the camera, plane px to frame px; each group a
// motion node places, or its recipe's own `motion`, through its placements too.
//
// Negative space: a group's visibility is the frame state's (`frameAt`), which no build sees, so nothing here pops.
// Bends and boils move paint within a group and aren't followed; nor are three planes.

import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampGroupPlacementAt } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampLaidPaintedPlane, StampLaidPicturePlane, StampLaidPlanes } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import { stampStageExtent, type StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { paintPlaneSimilarity, paintStageCentre, type PaintCamera, type PaintCameraPose } from './paint-camera.ts';
import { paintGroupPaintedBox, type PaintMotion } from './paint-motion-compile.ts';
import { paintLevelPlacementAt } from './paint-motion-frame.ts';
import { paintMotionWarnings, type PaintMotionFollowed, type PaintMotionWarning } from './paint-motion-warnings.ts';
import { PAINT_SIMILARITY_IDENTITY, paintSimilarityAfter, paintSimilarityOf, type PaintSimilarity } from './paint-similarity.ts';
import type { PaintSpanFrame } from './paint-span-moments.ts';

const unionBox = (a: StampBox, b: StampBox): StampBox => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/** Every drawable's visibility here: the frame state's is the scene's, which no build sees. */
const PAINTING_SHOWN = () => 1;

/**
 * Where `plane` paints, plane px: a picture's extent (the stage for one everywhere), the back's stage, or a nearer
 * painted plane's groups' `painted` boxes together; null for one with none.
 */
function paintingPlaneBox(plane: StampLaidPaintedPlane | StampLaidPicturePlane, back: boolean, painted: readonly StampBox[], stage: StampStage): StampBox | null {
  if (plane.kind === 'picture') {
    if (plane.extent.kind === 'box') return plane.extent.box;
    return plane.extent.kind === 'everywhere' ? stampStageExtent(stage) : null;
  }
  if (back) return stampStageExtent(stage);
  return painted.reduce<StampBox | null>((all, each) => (all ? unionBox(all, each) : each), null);
}

/**
 * The motion warnings of `planes` over `painting` (null: none painted) seen through `camera` at `frames`, its groups
 * placed by `motion` (null: none) or their recipes' own motion.
 */
export function paintingCameraMotionWarnings(
  camera: PaintCamera, planes: StampLaidPlanes<{ readonly depth: number }>, painting: CompiledStampPaint | null, motion: PaintMotion | null, frames: readonly PaintSpanFrame[],
): PaintMotionWarning[] {
  const centre = paintStageCentre(camera.stage), fps = motion?.animationFps ?? camera.animationFps;
  return paintMotionWarnings(camera, frames, (cameraAt: (sample: number) => PaintCameraPose) => {
    const followed: PaintMotionFollowed[] = [];
    for (const [index, plane] of [planes.back, ...planes.nearer].entries()) {
      const viewAt = (_moment: PaintMoment, sample: number) => paintPlaneSimilarity(cameraAt(sample), plane.depth, centre);
      if (plane.kind === 'three') continue;
      const groups = plane.kind === 'painted' && painting ? plane.groups.map((group) => painting.groups[group]) : [];
      const box = paintingPlaneBox(plane, index === 0, groups.flatMap((group) => paintGroupPaintedBox(group) ?? []), camera.stage);
      if (box) followed.push({ name: plane.id, plane: plane.id, moves: true, box, placeAt: viewAt, visibilityAt: PAINTING_SHOWN });
      for (const group of groups) {
        const levels = (motion?.nodes.get(group.id)?.levels ?? []).map((id) => motion!.nodes.get(id)!), groupBox = paintGroupPaintedBox(group);
        const placed = levels.some(({ place }) => place.length), recipe = group.motion;
        if (!groupBox || !(placed || recipe)) continue;
        // A node's levels innermost first, as the frame state composes them; a node's place and a recipe's motion never both lay a group.
        const placedAt = (moment: PaintMoment): PaintSimilarity => {
          if (!placed) return paintSimilarityOf(stampGroupPlacementAt(recipe!, moment.at), recipe!.pivot ?? { x: 0, y: 0 });
          return levels.reduce((inner, level) => {
            const place = paintLevelPlacementAt(level, moment, fps);
            return place ? paintSimilarityAfter(paintSimilarityOf(place.placement, place.pivot), inner) : inner;
          }, PAINT_SIMILARITY_IDENTITY);
        };
        followed.push({
          name: group.id, plane: plane.id, moves: true, box: groupBox, visibilityAt: PAINTING_SHOWN,
          placeAt: (moment, sample) => paintSimilarityAfter(viewAt(moment, sample), placedAt(moment)),
        });
      }
    }
    return followed;
  });
}
