// shot-plan.ts: the order a shot draws in each frame. Every drawable, a plane or one item of an instanced plane, sorts
// by depth far to near; on equal depths planes come first, as AUTHOR and the props' types say. The back is the
// farthest non-instanced plane, fixed at load.

import type { InstancedPlaneProps, PlaneInstance, PlaneProps } from './shot-props.ts';

/** One thing a frame draws: a plane, or one item of an instanced plane. */
export type ShotDrawable =
  | { readonly kind: 'plane'; readonly plane: string; readonly depth: number }
  | { readonly kind: 'item'; readonly plane: string; readonly item: PlaneInstance };

/**
 * A frame's drawables far to near: `planes` (the shot's, as written) and each instanced plane's `items` at the
 * frame's moment, by depth. On equal depths planes come first, in written order, then items, by their plane's written
 * order and then their own.
 */
export function shotDrawableOrder(planes: readonly (PlaneProps | InstancedPlaneProps)[], items: ReadonlyMap<string, readonly PlaneInstance[]>): ShotDrawable[] {
  type Placed = { readonly drawable: ShotDrawable; readonly depth: number; readonly item: number; readonly written: number; readonly at: number };
  const placed = planes.flatMap((plane, written): Placed[] => {
    if (plane.kind !== 'instanced') return [{ drawable: { kind: 'plane', plane: plane.id, depth: plane.depth }, depth: plane.depth, item: 0, written, at: 0 }];
    return (items.get(plane.id) ?? []).map((item, at) => ({ drawable: { kind: 'item', plane: plane.id, item }, depth: item.depth, item: 1, written, at }));
  });
  return placed.toSorted((a, b) => b.depth - a.depth || a.item - b.item || a.written - b.written || a.at - b.at).map(({ drawable }) => drawable);
}
