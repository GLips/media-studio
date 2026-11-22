// fold.ts: a card folding along a crease, seen straight on. A fold of φ turns the card about its crease line in 3D
// and the picture shows its orthographic shadow: along the crease nothing moves, across it lengths shrink by cos φ, so
// a fold of π mirrors the card across its crease (a flip). Folds compose planar, as their 2×2s multiply, never as
// true 3D turns: two nested 60° folds face +0.25, not −0.5. Picture axes: x right, y down, z toward the viewer.

import type { Point } from '#lib/picture/frame/models/geometry.ts';

/** A planar 2×2, rows first: [[a, b], [c, d]] maps (x, y) to (a·x + b·y, c·x + d·y). */
export type FoldMatrix = readonly [readonly [number, number], readonly [number, number]];

/**
 * The fold of `angle` radians about a crease running at `crease` radians (0: level, along +x), as the 2×2
 * u·uᵀ + cos φ·v·vᵀ, u along the crease and v across it.
 */
export function foldMatrix(angle: number, crease: number): FoldMatrix {
  const ux = Math.cos(crease), uy = Math.sin(crease), k = Math.cos(angle);
  // v = (−uy, ux): u·uᵀ + k·v·vᵀ.
  return [[ux * ux + k * uy * uy, ux * uy - k * uy * ux], [uy * ux - k * ux * uy, uy * uy + k * ux * ux]];
}

/** The fold about `pivot` as a point map: the crease runs through the pivot, which stays where it is. */
export function foldAbout(angle: number, crease: number, pivot: Point): (p: Point) => Point {
  const [[a, b], [c, d]] = foldMatrix(angle, crease);
  return (p) => {
    const dx = p.x - pivot.x, dy = p.y - pivot.y;
    return { x: pivot.x + a * dx + b * dy, y: pivot.y + c * dx + d * dy };
  };
}

/**
 * Which way a card faces after its folds and turns: `facing`, the product of its folds' cosines (above 0 its front
 * shows, below 0 its back, 0 edge-on), and `turn`, its 3D orientation (a 3×3, rows first), whose z column is the
 * front's normal. A turn in the picture plane turns the normal with the card and leaves its facing.
 */
export type FoldTurn = { readonly facing: number; readonly turn: readonly number[] };

/** A card lying flat, facing the viewer. */
export const FOLD_TURN_FLAT: FoldTurn = { facing: 1, turn: [1, 0, 0, 0, 1, 0, 0, 0, 1] };

/**
 * A fold of `angle` about a crease at `crease`, as a FoldTurn: a positive fold tips the side of the card across the
 * crease toward +v (v = the crease's direction turned a quarter clockwise on screen: below a level crease) away from
 * the viewer, so the front's normal leans toward +v.
 */
export function foldTurn(angle: number, crease: number): FoldTurn {
  const ux = Math.cos(crease), uy = Math.sin(crease), vx = -uy, vy = ux, c = Math.cos(angle), s = Math.sin(angle);
  // u·uᵀ + c·(v·vᵀ + z·zᵀ) + s·(v·zᵀ − z·vᵀ): u stays, v goes to c·v − s·z, z to s·v + c·z.
  return {
    facing: c,
    turn: [
      ux * ux + c * vx * vx, ux * uy + c * vx * vy, s * vx,
      uy * ux + c * vy * vx, uy * uy + c * vy * vy, s * vy,
      -s * vx, -s * vy, c,
    ],
  };
}

/** A turn of `rotation` radians in the picture plane (clockwise on screen, y down), as a FoldTurn. */
export function foldTurnInPlane(rotation: number): FoldTurn {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return { facing: 1, turn: [c, -s, 0, s, c, 0, 0, 0, 1] };
}

/** `outer` after `inner`: their facings multiplied, their orientations composed. */
export function foldTurnAfter(outer: FoldTurn, inner: FoldTurn): FoldTurn {
  const a = outer.turn, b = inner.turn, turn: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) turn.push(a[3 * r] * b[c] + a[3 * r + 1] * b[3 + c] + a[3 * r + 2] * b[6 + c]);
  return { facing: outer.facing * inner.facing, turn };
}

/**
 * The normal of the side of the card that shows (its front's, or its back's where it faces away), unit, picture
 * axes: z toward the viewer. Edge-on, the front's.
 */
export function foldShownNormal({ facing, turn }: FoldTurn): { readonly x: number; readonly y: number; readonly z: number } {
  const side = facing < 0 ? -1 : 1, x = turn[2] * side, y = turn[5] * side, z = turn[8] * side, length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}
