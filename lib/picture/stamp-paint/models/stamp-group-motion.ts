// stamp-group-motion.ts: a group that moves or boils over its scene. A moving group is painted once in its own place,
// its paper's grain, its brushes' grain and its randomness with it, and laid where it's moved to: its texture travels
// with it rather than swimming under it (stuck). A boiling group is painted afresh every few frames, on purpose.
// The paper's photograph moves with a group only if the group lies on its own paper, a cut-out (StampGroupPaper).
//
// Negative space: a group moves rigidly. Deforming one (a raised arm) would warp its layer by a field, not a placement.

import type { StampPoint } from './stamp-region.ts';
import { stampKeyList, stampKeySpanAt, stampKeyTimesProblem, type StampKeyList } from './stamp-scene-keys.ts';

/**
 * A group's placement at a key: `at` seconds into the scene, moved `x`, `y` pixels from where it's painted, turned
 * `rotation` radians and sized `scale` about its motion's pivot.
 */
export type StampGroupPlacement = { x: number; y: number; rotation: number; scale: number };

/**
 * A group moving over the scene: its placement at each key (stamp-scene-keys.ts), eased linearly between keys and held
 * beyond them, turned and sized about `pivot` (in the painting's pixels, where it's painted; the painting's origin when left out).
 */
export type StampGroupMotion = {
  keys: readonly ({ at: number; x: number; y: number } & Partial<Pick<StampGroupPlacement, 'rotation' | 'scale'>>)[];
  pivot?: StampPoint;
};

/**
 * The paper a group's paint shows: `ground`, the painting's, staying put as the group moves; `own`, a collage's piece
 * of paper, carried with it (still, the same paper). Either way its lights lighten only its own paint; what it takes
 * out of the paint behind it is its knockout's (StampGroupScope's `knockout`).
 */
export type StampGroupPaper = 'ground' | 'own';

/**
 * A group painted anew every `every` frames, each time with its marks' randomness seeded afresh, as hand-drawn
 * animation boils on twos (`every: 2`). Between, it holds.
 */
export type StampGroupBoil = { every: number };

/** The boil epoch of frame `frame` for a group boiling every `every` frames. */
export const stampBoilEpoch = (frame: number, { every }: StampGroupBoil) => Math.floor(frame / every);

/** A group's motion as compiled (compileStampGroupMotion): at least one key, each finite at an increasing time. */
export type CompiledStampGroupMotion = { keys: StampKeyList<StampGroupMotion['keys'][number]>; pivot?: StampPoint };

/** `motion` checked: keys finite at increasing times (stamp-scene-keys.ts) with a positive scale, and a finite pivot. */
export function compileStampGroupMotion({ keys, pivot }: StampGroupMotion, groupId: string): CompiledStampGroupMotion {
  const timing = stampKeyTimesProblem(keys);
  if (timing) throw new Error(`stamp paint: ${groupId}'s motion can't be eased: ${timing}`);
  if (pivot && !(Number.isFinite(pivot.x) && Number.isFinite(pivot.y))) throw new Error(`stamp paint: ${groupId}'s motion pivot isn't finite`);
  keys.forEach((key, i) => {
    if (![key.x, key.y, key.rotation ?? 0, key.scale ?? 1].every(Number.isFinite) || !((key.scale ?? 1) > 0)) throw new Error(`stamp paint: ${groupId}'s motion key ${i} needs finite values and a positive scale`);
  });
  return { keys: stampKeyList(keys, `${groupId}'s motion`), ...(pivot && { pivot }) };
}

/** Where `motion` places its group `t` seconds into the scene: each of its key's offsets, turn and size eased. */
export function stampGroupPlacementAt({ keys }: CompiledStampGroupMotion, t: number): StampGroupPlacement {
  const { from, to, share } = stampKeySpanAt(keys, t), a = keys[from], b = keys[to];
  const eased = (u: number, v: number) => u + (v - u) * share;
  return { x: eased(a.x, b.x), y: eased(a.y, b.y), rotation: eased(a.rotation ?? 0, b.rotation ?? 0), scale: eased(a.scale ?? 1, b.scale ?? 1) };
}

/**
 * Where a pixel of the scene reads its group's own layer from, for a group placed at `placement` about `pivot`: the
 * inverse placement as rows [a, b, c] and [d, e, f], so the layer's point is (a·x + b·y + c, d·x + e·y + f).
 */
export function stampGroupLayerFromScene({ x, y, rotation, scale }: StampGroupPlacement, pivot: StampPoint = { x: 0, y: 0 }): [number, number, number, number, number, number] {
  const cos = Math.cos(rotation) / scale, sin = Math.sin(rotation) / scale;
  // Scene point p = pivot + (x, y) + R·s·(q − pivot); so q = pivot + R⁻¹(p − pivot − (x, y)) / s.
  const ox = pivot.x + x, oy = pivot.y + y;
  return [cos, sin, pivot.x - cos * ox - sin * oy, -sin, cos, pivot.y + sin * ox - cos * oy];
}

/** Where a point of the group's own layer lands in the scene, placed at `placement` about `pivot`. */
export function stampGroupSceneFromLayer({ x, y, rotation, scale }: StampGroupPlacement, point: StampPoint, pivot: StampPoint = { x: 0, y: 0 }): StampPoint {
  const dx = (point.x - pivot.x) * scale, dy = (point.y - pivot.y) * scale, cos = Math.cos(rotation), sin = Math.sin(rotation);
  return { x: pivot.x + x + cos * dx - sin * dy, y: pivot.y + y + sin * dx + cos * dy };
}
