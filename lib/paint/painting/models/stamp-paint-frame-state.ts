// stamp-paint-frame-state.ts: each group's state for one frame, as data: where it's laid, the warp bending its layer,
// which marks it draws, the time its paint reads, its visibility. The compiled painting holds no functions of time.
// Whoever animates a painting (paint/animation) writes it; a recipe's own `motion`, `boil` and keyed paint are
// evaluated into the same shape (stampPaintFrameStateAt), so the frame plan reads one, whoever wrote it.
//
// Keys name what a function or a compiled group can't show by value: two frames giving one group equal keys must give
// it equal maps or marks. A film's key is built from them, so a wrong key lays the wrong paint.

import { stampBoilEpoch, stampGroupPlacementAt, type StampGroupPlacement } from './stamp-group-motion.ts';
import type { StampWarpMap } from './stamp-group-warp.ts';
import { stampPassDeposits, type CompiledStampGroup, type CompiledStampPaint } from './stamp-paint-recipe-compile.ts';
import type { StampPoint } from './stamp-region.ts';

/** A rigid placement about `pivot` (in the painting's pixels, where it's painted), applied after any warp. */
export type StampGroupLay = { placement: StampGroupPlacement; pivot: StampPoint };

/**
 * A bend of a group's painted layer, applied before its lay: `map` takes its rest space to the scene, sampled on a
 * lattice `cell` px apart (STAMP_WARP_CELL when left out); `key` names the map exactly.
 */
export type StampGroupWarp = { map: StampWarpMap; key: string; cell?: number };

/**
 * The marks a group draws. `written`: as compiled, re-seeded at boil `epoch` (0 is as written; past 0 only for a
 * group compiled with a `boil`). `live`: its marks compiled for this frame from its posed geometry, drawn in place of
 * the written ones; they must be the written group re-placed (stampLiveGroupProblem), and `key` names them exactly.
 */
export type StampGroupMarks = { kind: 'written'; epoch: number } | { kind: 'live'; marks: CompiledStampGroup; key: string };

/**
 * The light a group gives off: its laid paint brighter than `threshold` (0..1, linear light), `amount` times over,
 * its plane's emission. The lens blooms the frame's emission once (StampLensFrame's bloom), so a glow spreads over
 * what stands in front of it, and paint a nearer plane covers gives off none.
 */
export type StampGroupGlow = { amount: number; threshold: number };

/**
 * One group's state for one frame; a field left out is as painted. A live group may be warped too: whatever bends
 * the parts it hangs from reaches it as its warp.
 */
export type StampGroupFrameState = {
  lay?: StampGroupLay;
  warp?: StampGroupWarp;
  marks?: StampGroupMarks;
  /** The scene time its keyed paint reads (the recipe's material keys). */
  paintAt?: number;
  /** 0..1, multiplying the group's lay; 0 draws none of it. */
  visibility?: number;
  glow?: StampGroupGlow;
};

/** Each group's frame state by group id; a group absent is as painted. */
export type StampPaintFrameState = ReadonlyMap<string, StampGroupFrameState>;

/**
 * A painting's frame state at scene second `at`, an exposure's moment within the frame shown at `frame` (a lens's
 * shutter, lens-shutter.ts): a drawing held on the animation grid holds through its frame (paintMoment).
 */
export type StampPaintFrameAt = (at: number, frame: number) => StampPaintFrameState;

/**
 * What `group`'s own recipe gives it `t` seconds into its scene: its motion's lay, its boil's epoch (on the animation
 * clock, stampBoilEpoch) and, while it recolours, the time its paint reads, held to its keys' span.
 */
function stampRecipeGroupState({ motion, boil, recolours }: CompiledStampGroup, t: number): StampGroupFrameState {
  return {
    ...(motion && { lay: { placement: stampGroupPlacementAt(motion, t), pivot: motion.pivot ?? { x: 0, y: 0 } } }),
    ...(boil && { marks: { kind: 'written', epoch: stampBoilEpoch(t, boil) } }),
    ...(recolours && { paintAt: Math.min(recolours.to, Math.max(recolours.from, t)) }),
  };
}

/**
 * `painting`'s frame state `t` seconds into its scene: each group's recipe's own with `given` over it. Given marks
 * replace a recipe's boil (a group its animation re-seeds counts no epochs of its own; epoch 0 draws as written). Any
 * other field written by both is an error, as is state for a group the painting doesn't have.
 */
export function stampPaintFrameStateAt(painting: CompiledStampPaint, t: number, given: StampPaintFrameState = new Map()): StampPaintFrameState {
  const unknown = [...given.keys()].filter((id) => !painting.groups.some((group) => group.id === id));
  if (unknown.length) throw new Error(`stamp paint: frame state for ${unknown.join(', ')}, which the painting has no group of`);
  const merged = new Map<string, StampGroupFrameState>();
  for (const group of painting.groups) {
    const own = stampRecipeGroupState(group, t), written = given.get(group.id) ?? {};
    for (const field of ['lay', 'warp', 'paintAt', 'visibility', 'glow'] as const) {
      if (own[field] !== undefined && written[field] !== undefined) throw new Error(`stamp paint: ${group.id}'s frame state gives its ${field}, and so does its recipe; one writes it`);
    }
    const state: StampGroupFrameState = Object.fromEntries(Object.entries({ ...own, ...written }).filter(([, value]) => value !== undefined));
    if (Object.keys(state).length) merged.set(group.id, state);
  }
  return merged;
}

/**
 * Why `marks` can't stand in for `written` live, or null: another id, other passes or deposits. Its paint, brushes
 * and wet stages are the written group's, by deposit.
 */
export function stampLiveGroupProblem(written: CompiledStampGroup, marks: CompiledStampGroup): string | null {
  if (marks.id !== written.id) return `its live marks are group ${marks.id}`;
  if (marks.passes.length !== written.passes.length) return `its live marks have ${marks.passes.length} passes, not ${written.passes.length}`;
  for (const [p, pass] of written.passes.entries()) {
    const drawn = marks.passes[p], deposits = stampPassDeposits(pass), drawnDeposits = stampPassDeposits(drawn);
    if (drawn.id !== pass.id || drawn.kind !== pass.kind || drawnDeposits.length !== deposits.length) return `its live pass ${drawn.id} isn't ${pass.id} as written`;
    for (const [d, deposit] of deposits.entries()) {
      const { id } = drawnDeposits[d];
      if (id !== deposit.id) return `its live deposit ${id} isn't ${deposit.id} as written`;
    }
  }
  return null;
}
