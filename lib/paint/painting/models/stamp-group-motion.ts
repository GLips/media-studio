// stamp-group-motion.ts: a group that moves or boils over its scene. A moving group is painted once in its own place,
// its paper's grain, its brushes' grain and its randomness with it, and laid where it's moved to: its texture travels
// with it rather than swimming under it (stuck). A boiling group is painted afresh every few frames, on purpose.
// The paper's photograph moves with a group only if the group lies on its own paper, a cut-out (StampGroupPaper).
//
// A placement is laid as a warp's one-cell lattice (stamp-group-warp.ts); a group that bends has a warp of its own.

import type { StampPoint } from './stamp-region.ts';
import { mapStampKeyList, stampKeyList, stampKeySpanAt, stampKeyTimesProblem, type StampKeyList } from './stamp-scene-keys.ts';

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
 * Frames per second of the animation clock unless a scene says otherwise: "on twos" is 2/24 s at any render rate.
 * Painted animation counts drawings on it (a recipe's boil here, paint/animation's writers' clocks), never in render
 * frames, so a 30 or 60 fps render samples the same drawings.
 */
export const PAINT_ANIMATION_FPS = 24;

/** The animation frame scene-or-local time `t` falls in; the epsilon puts 2/24 s on frame 2, not 1. */
export const paintAnimationFrameAt = (t: number, animationFps: number) => Math.floor(t * animationFps + 1e-6);

/**
 * A group painted anew every `every` animation frames (PAINT_ANIMATION_FPS), each time with its marks' randomness
 * seeded afresh, as hand-drawn animation boils on twos (`every: 2`). Between, it holds.
 */
export type StampGroupBoil = { every: number };

/** The boil epoch `t` seconds into the scene for a group boiling every `every` animation frames. */
export const stampBoilEpoch = (t: number, { every }: StampGroupBoil) => Math.floor(paintAnimationFrameAt(t, PAINT_ANIMATION_FPS) / every);

/** A group's motion as compiled (compileStampGroupMotion): at least one whole placement, at finite increasing times. */
export type CompiledStampGroupMotion = { keys: StampKeyList<{ at: number } & StampGroupPlacement>; pivot?: StampPoint };

/** `motion` checked: keys finite at increasing times (stamp-scene-keys.ts) with a positive scale, and a finite pivot. */
export function compileStampGroupMotion({ keys, pivot }: StampGroupMotion, groupId: string): CompiledStampGroupMotion {
  const timing = stampKeyTimesProblem(keys);
  if (timing) throw new Error(`stamp paint: ${groupId}'s motion can't be eased: ${timing}`);
  if (pivot && !(Number.isFinite(pivot.x) && Number.isFinite(pivot.y))) throw new Error(`stamp paint: ${groupId}'s motion pivot isn't finite`);
  keys.forEach((key, i) => {
    if (![key.x, key.y, key.rotation ?? 0, key.scale ?? 1].every(Number.isFinite) || !((key.scale ?? 1) > 0)) throw new Error(`stamp paint: ${groupId}'s motion key ${i} needs finite values and a positive scale`);
  });
  const placements = mapStampKeyList(stampKeyList(keys, `${groupId}'s motion`), ({ at, x, y, rotation = 0, scale = 1 }) => ({ at, x, y, rotation, scale }));
  return { keys: placements, ...(pivot && { pivot }) };
}

/** Where `motion` places its group `t` seconds into the scene: each of its key's offsets, turn and size eased. */
export function stampGroupPlacementAt({ keys }: CompiledStampGroupMotion, t: number): StampGroupPlacement {
  const { from, to, share } = stampKeySpanAt(keys, t), a = keys[from], b = keys[to];
  const eased = (u: number, v: number) => u + (v - u) * share;
  return { x: eased(a.x, b.x), y: eased(a.y, b.y), rotation: eased(a.rotation, b.rotation), scale: eased(a.scale, b.scale) };
}

/** Where a point of the group's own layer lands in the scene, placed at `placement` about `pivot`. */
export function stampGroupSceneFromLayer({ x, y, rotation, scale }: StampGroupPlacement, point: StampPoint, pivot: StampPoint = { x: 0, y: 0 }): StampPoint {
  const dx = (point.x - pivot.x) * scale, dy = (point.y - pivot.y) * scale, cos = Math.cos(rotation), sin = Math.sin(rotation);
  return { x: pivot.x + x + cos * dx - sin * dy, y: pivot.y + y + sin * dx + cos * dy };
}

/**
 * The map undoing `placement` (about the origin) as a pass reads a similarity, p ↦ (ma + i·mb)·p + (kx + i·ky): its
 * words [ma, mb, kx, ky], taking a point where the placement laid it back to where it was painted.
 */
export function stampPlacementInverseWords({ x, y, rotation, scale }: StampGroupPlacement): [number, number, number, number] {
  const ma = Math.cos(rotation) / scale, mb = -Math.sin(rotation) / scale;
  return [ma, mb, -(ma * x - mb * y), -(mb * x + ma * y)];
}
