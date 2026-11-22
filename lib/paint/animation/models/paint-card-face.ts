// paint-card-face.ts: how a folded card shows under the shot's light, purely. A card's facing (fold.ts: the product of
// its folds' cosines) says which side shows; its turn's normal, against the light, one uniform Lambert tone for the
// face, relative to the card lying flat, so a flat card is exactly its print. Pigment is never relit: the tone only
// multiplies what's laid, and a face turned toward the light brightens by at most PAINT_CARD_BRIGHTEST.
//
// Nested folds compose planar (fold.ts), so a card folded twice is shaded as an approximation, not true 3D.

import { foldShownNormal, type FoldTurn } from '#lib/picture/motion/models/fold.ts';
import type { PaintLight } from '#lib/paint/painting/models/stamp-form.ts';

/** Below this |facing| a card is edge-on: it draws nothing. A fold of exactly π/2 is. */
export const PAINT_EDGE_ON = 1e-6;

/** The most a face turned toward the light brightens its print. */
export const PAINT_CARD_BRIGHTEST = 1.05;

/** The light a face turned wholly from the light still gets, of what it would facing it: the room's bounce off paper. */
const PAINT_CARD_AMBIENT = 0.45;

/** Which side of a card shows: its front, its back, or neither, edge-on. */
export type PaintCardSide = 'front' | 'back' | 'edge';

export function paintCardSide({ facing }: FoldTurn): PaintCardSide {
  if (Math.abs(facing) < PAINT_EDGE_ON) return 'edge';
  return facing > 0 ? 'front' : 'back';
}

/** How much `light` lights a face whose normal is `normal` (picture axes, z toward the viewer). */
function lit(normal: { readonly x: number; readonly y: number; readonly z: number }, { direction, elevation }: PaintLight): number {
  const across = Math.cos(elevation), toward = normal.x * across * Math.cos(direction) + normal.y * across * Math.sin(direction) + normal.z * Math.sin(elevation);
  return PAINT_CARD_AMBIENT + (1 - PAINT_CARD_AMBIENT) * Math.max(0, toward);
}

/**
 * The tone `light` gives a card turned `turn`, the side that shows: 1 lying flat, below 1 turned from the light, up to
 * PAINT_CARD_BRIGHTEST turned toward it. A multiplier on its paper and paint alike.
 */
export function paintCardShade(turn: FoldTurn, light: PaintLight): number {
  const flat = lit({ x: 0, y: 0, z: 1 }, light);
  return Math.min(PAINT_CARD_BRIGHTEST, lit(foldShownNormal(turn), light) / flat);
}

/** |facing| below this reads as a sliver: a card held there more than a frame looks like a glitch, not a turn. */
export const PAINT_CARD_SLIVER = 0.17;
