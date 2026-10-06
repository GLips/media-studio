// paint-painting-motion-warnings.ts: a StampPainting's motion judged over its camera's span (paint-motion-warnings.ts),
// as buildPaintingCamera hands them on. The judge takes the camera's own move; each group a motion node places, or
// its recipe's own `motion`, is followed on its placements, the camera held. A plane holds one depth and adds no
// motion of its own, so it isn't followed: the camera's warnings are its.
//
// Negative space: a group's visibility is the frame state's (`frameAt`), which no build sees, so nothing here pops.
// Bends and boils move paint within a group and aren't followed; nor are three planes.

import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampGroupPlacementAt } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampLaidPlanes } from '#lib/paint/painting/models/stamp-plane.ts';
import { paintPlaneSimilarity, paintStageCentre, type PaintCamera } from './paint-camera.ts';
import { paintGroupPaintedBox, type PaintMotion } from './paint-motion-compile.ts';
import { paintLaneSnapsBetween } from './paint-motion-clips.ts';
import { paintLevelPlacementAt } from './paint-motion-frame.ts';
import { paintMotionWarnings, type PaintMotionFollowed, type PaintMotionWarning } from './paint-motion-warnings.ts';
import { PAINT_SIMILARITY_IDENTITY, paintSimilarityAfter, paintSimilarityOf, type PaintSimilarity } from './paint-similarity.ts';
import type { PaintSpanFrame } from './paint-span-moments.ts';

/** Every drawable's visibility here: the frame state's is the scene's, which no build sees. */
const PAINTING_SHOWN = () => 1;

/**
 * The motion warnings of `planes` over `painting` (null: none painted) seen through `camera` at `frames`, its groups
 * placed by `motion` (null: none) or their recipes' own motion.
 */
export function paintingCameraMotionWarnings(
  camera: PaintCamera, planes: StampLaidPlanes<{ readonly depth: number }>, painting: CompiledStampPaint | null, motion: PaintMotion | null, frames: readonly PaintSpanFrame[],
): PaintMotionWarning[] {
  const centre = paintStageCentre(camera.stage), fps = motion?.animationFps ?? camera.animationFps;
  return paintMotionWarnings(camera, frames, ({ moments, cameraAt }) => {
    const followed: PaintMotionFollowed[] = [];
    for (const plane of [planes.back, ...planes.nearer]) {
      if (plane.kind !== 'painted' || !painting) continue;
      for (const group of plane.groups.map((id) => painting.groups[id])) {
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
        const placements: PaintSimilarity[] = [];
        followed.push({
          name: group.id, depthAt: () => plane.depth, box: groupBox, visibilityAt: PAINTING_SHOWN,
          placeAt: (sample, held) => paintSimilarityAfter(paintPlaneSimilarity(cameraAt(held), plane.depth, centre), (placements[sample] ??= placedAt(moments[sample]))),
          snapsBetween: (from, to) => levels.some((level) => paintLaneSnapsBetween(level.place, moments[from], moments[to], fps)),
        });
      }
    }
    return followed;
  });
}
