// stamp-paint-frame-state.ts: each group's state for one frame, as data. Everything about a group that varies with
// time reaches the renderer here (its placement, the warp bending its layer, its boil epoch, its visibility, and for a
// live part its marks compiled from this frame's pose); the compiled painting holds no functions of time. Whoever
// animates a painting (paint/animation) writes it; a recipe's own `motion` and `boil` are evaluated into the same shape
// (stamp-frame-plan.ts), so the renderer reads one.
//
// Keys name what a function or a compiled group can't show by value: two frames giving one group equal keys must give
// it equal maps or marks. The checkpoint key is built from them, so a wrong key restores the wrong paint.

import type { StampGroupPlacement } from './stamp-group-motion.ts';
import type { StampWarpMap } from './stamp-group-warp.ts';
import { stampPassDeposits, type CompiledStampGroup } from './stamp-paint-recipe.ts';
import type { StampPoint } from './stamp-region.ts';

/** One group's state for one frame. Every field is optional: absent means as painted. */
export type StampGroupFrameState = {
  /** Rigid placement about `pivot` (the painting's origin when left out), after any warp. */
  placement?: StampGroupPlacement;
  pivot?: StampPoint;
  /**
   * A bend of its painted layer, applied before `placement`: `map` takes its rest space to the scene, sampled on a
   * lattice `cell` px apart (STAMP_WARP_CELL when left out); `key` names the map exactly.
   */
  warp?: { map: StampWarpMap; key: string; cell?: number };
  /** Boil epoch, re-seeding its marks; 0 or absent = as written. Only a group compiled with a `boil` can re-seed. */
  epoch?: number;
  /** 0..1, multiplying the group's lay; 1 or absent = shown, 0 = not laid at all. */
  visibility?: number;
  /**
   * LIVE: this group's marks compiled for this frame from its posed geometry, drawn in place of the group as written.
   * They must be the written group re-placed: the same id, passes and deposits by id, each revealed alike
   * (stampLiveGroupProblem), so its brushes, paint and events are the written ones'. `key` names them exactly.
   */
  live?: { marks: CompiledStampGroup; key: string };
};

/** Each group's frame state by group id; a group absent is as painted. */
export type StampPaintFrameState = ReadonlyMap<string, StampGroupFrameState>;

/**
 * Why `marks` can't stand in for `written` live, or null: another id, other passes or deposits, or a deposit revealed
 * differently (a frame's events, and so its checkpoints, are the written painting's).
 */
export function stampLiveGroupProblem(written: CompiledStampGroup, marks: CompiledStampGroup): string | null {
  if (marks.id !== written.id) return `its live marks are group ${marks.id}`;
  if (marks.passes.length !== written.passes.length) return `its live marks have ${marks.passes.length} passes, not ${written.passes.length}`;
  for (const [p, pass] of written.passes.entries()) {
    const drawn = marks.passes[p], deposits = stampPassDeposits(pass), drawnDeposits = stampPassDeposits(drawn);
    if (drawn.id !== pass.id || drawn.kind !== pass.kind || drawnDeposits.length !== deposits.length) return `its live pass ${drawn.id} isn't ${pass.id} as written`;
    for (const [d, deposit] of deposits.entries()) {
      const { id, reveal } = drawnDeposits[d];
      if (id !== deposit.id) return `its live deposit ${id} isn't ${deposit.id} as written`;
      if (reveal?.at !== deposit.reveal?.at || reveal?.over !== deposit.reveal?.over) return `its live deposit ${id} is revealed differently from as written`;
    }
  }
  return null;
}
