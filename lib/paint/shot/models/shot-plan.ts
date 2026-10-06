// shot-plan.ts: the order a shot draws in each frame. Every drawable, a plane or one item of an instanced plane, sorts
// by its depth that frame far to near; on equal depths planes come first, as AUTHOR and the props' types say. A plane
// moving in depth passes another where it crosses its depth: draw order changes then, on purpose. The back is the
// farthest non-instanced plane, fixed at load, which keeps one depth (shot-depths.ts).

import { presentationValueAt } from '#lib/paint/animation/models/paint-value.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { CompiledPaintedShot } from './shot-compile.ts';
import type { InstancedPlaneProps, PlaneInstance, PlaneProps } from './shot-props.ts';

/** One thing a frame draws: a plane, or one item of an instanced plane. */
export type ShotDrawable =
  | { readonly kind: 'plane'; readonly plane: string; readonly depth: number }
  | { readonly kind: 'item'; readonly plane: string; readonly item: PlaneInstance };

/**
 * A frame's drawables far to near: `planes` (the shot's, as written), each at `depthOf` it, its depth that frame, and
 * each instanced plane's `items` at the frame's moment, by depth. On equal depths planes come first, in written order,
 * then items, by their plane's written order and then their own.
 */
export function shotDrawableOrder(
  planes: readonly (PlaneProps | InstancedPlaneProps)[], items: ReadonlyMap<string, readonly PlaneInstance[]>, depthOf: (plane: PlaneProps) => number,
): ShotDrawable[] {
  type Placed = { readonly drawable: ShotDrawable; readonly depth: number; readonly item: number; readonly written: number; readonly at: number };
  const placed = planes.flatMap((plane, written): Placed[] => {
    if (plane.kind !== 'instanced') {
      const depth = depthOf(plane);
      return [{ drawable: { kind: 'plane', plane: plane.id, depth }, depth, item: 0, written, at: 0 }];
    }
    return (items.get(plane.id) ?? []).map((item, at) => ({ drawable: { kind: 'item', plane: plane.id, item }, depth: item.depth, item: 1, written, at }));
  });
  return placed.toSorted((a, b) => b.depth - a.depth || a.item - b.item || a.written - b.written || a.at - b.at).map(({ drawable }) => drawable);
}

/** `shot`'s drawables at moment `at` far to near (shotDrawableOrder): its planes at their depths then, its instanced planes' `items`. */
export function shotDrawablesAt(shot: Pick<CompiledPaintedShot, 'planes' | 'written'>, items: ReadonlyMap<string, readonly PlaneInstance[]>, at: PaintMoment): ShotDrawable[] {
  const depthOf = new Map(shot.planes.map(({ id, depth }) => [id, depth]));
  return shotDrawableOrder(shot.written, items, (plane) => presentationValueAt(depthOf.get(plane.id)!, at));
}
