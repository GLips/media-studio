// paint-group-frame-state.ts: the one place motion's frame for a group becomes the renderer's frame state. Motion
// writes PaintGroupFrame, a sum of what a group's frame can say (laid by a placement, bent by a warp, its marks as
// written at an epoch or live), and this turns it into StampGroupFrameState as the renderer reads it today.
//
// Negative space: no visibility yet. Motion writes none, so a group is always fully shown.

import type { StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
import type { StampGroupFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { CompiledStampGroup } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';

/**
 * A group's frame as motion writes it. `lay`: its rigid placement about `pivot`, after `warp`. `marks`: as written at
 * boil `epoch` (written for every group compiled with a boil, 0 included, so the recipe's own boil never runs), or
 * live, compiled for this frame and named by `key`.
 */
export type PaintGroupFrame = {
  readonly lay?: { readonly placement: StampGroupPlacement; readonly pivot: StampPoint };
  readonly warp?: { readonly map: StampWarpMap; readonly key: string };
  readonly marks?: { readonly kind: 'written'; readonly epoch: number } | { readonly kind: 'live'; readonly marks: CompiledStampGroup; readonly key: string };
};

/** `frame` as the renderer's frame state, or null when it says nothing (the group as painted). */
export function stampGroupFrameStateOf({ lay, warp, marks }: PaintGroupFrame): StampGroupFrameState | null {
  if (!lay && !warp && !marks) return null;
  return {
    ...(lay && { placement: lay.placement, pivot: lay.pivot }),
    ...(warp && { warp: { map: warp.map, key: warp.key } }),
    ...(marks?.kind === 'written' && { epoch: marks.epoch }),
    ...(marks?.kind === 'live' && { live: { marks: marks.marks, key: marks.key } }),
  };
}
