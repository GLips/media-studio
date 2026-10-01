// paint-frame-state.ts: one painted group's state for one frame, as data, which the motion evaluator
// (paint-motion-frame.ts) hands the renderer. Everything that varies with time reaches the renderer here.
//
// TODO(vid-130 phase 2a): these mirror StampGroupFrameState and StampPaintFrameState as the seam branch (vid130-seam)
// lands them in paint/painting/models. On merge this file goes and its importers take the painting's.

import type { StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
import type { CompiledStampGroup } from '#lib/paint/painting/models/stamp-paint-recipe.ts';

/**
 * One group's state for one frame; every field absent means "as painted". `warp` bends its layer before `placement`
 * moves it, and its `key` names the map exactly: two frames with equal keys have equal maps.
 */
export type StampGroupFrameState = {
  /** Rigid placement about the group's pivot. */
  placement?: StampGroupPlacement;
  warp?: { map: StampWarpMap; key: string };
  /** Boil epoch, the group's marks re-seeded; 0 or absent = as written. */
  epoch?: number;
  /** 0..1, multiplies the group's lay; plan 1 builds only the slot. */
  visibility?: number;
  /** A live group's marks compiled for this frame from its posed geometry, drawn in place of the group as written. */
  live?: { marks: CompiledStampGroup; key: string };
};

/** Each group's frame state by group id; groups absent are as painted. */
export type StampPaintFrameState = ReadonlyMap<string, StampGroupFrameState>;
