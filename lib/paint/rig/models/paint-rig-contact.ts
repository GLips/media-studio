// paint-rig-contact.ts: where a rig's feet meet the ground, purely. Under each foot that shows, a soft dark ellipse
// lies on the ground between its heel and toe: tight and strong while planted, wider and fainter as the foot lifts
// (the same darkness spread over more ground). And a planted foot's drift, measured by the contact that moved least,
// so a foot rolling over its heel or toe isn't read as sliding. Plane px throughout.

import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';

/**
 * `strength`: how much a planted foot darkens the ground at the shadow's heart. `reach`, `depth`: its spread past heel
 * and toe, across and down, in foot lengths. `leastFoot`: the px length a foreshortened foot (pointing at the camera)
 * is sized as. `falloff`: exp(−falloff·d²) at d radii.
 */
export const PAINT_RIG_CONTACT_SHADOW = { strength: 0.45, reach: 0.35, depth: 0.16, leastFoot: 40, falloff: 2 } as const;

/** One foot's shadow on the ground: its heart, its radii, and how much it darkens there (0..1). */
export type PaintRigContactShadow = { readonly centre: StampPoint; readonly rx: number; readonly ry: number; readonly strength: number };

/** The ground's height (plane y) under plane x. */
export type PaintRigGround = (x: number) => number;

/** A walking line as a ground: piecewise linear through its points, level past its ends. */
export function paintRigGroundOfLine(line: readonly StampPoint[]): PaintRigGround {
  const points = line.toSorted((a, b) => a.x - b.x);
  return (x) => {
    if (x <= points[0].x) return points[0].y;
    const after = points.findIndex((p) => p.x >= x);
    if (after < 0) return points.at(-1)!.y;
    const a = points[after - 1], b = points[after];
    return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  };
}

/**
 * The shadow of a foot whose heel and toe are posed at `heel` and `toe`, `length` its rest heel-to-toe, over `ground`.
 * Lifted by h (its lower end above the ground), it grows by 1 + h / length and its strength falls by that squared; a
 * planted foot keeps the full strength wherever its contacts are.
 */
export function paintRigContactShadow(heel: StampPoint, toe: StampPoint, length: number, ground: PaintRigGround, planted: boolean): PaintRigContactShadow {
  const { strength, reach, depth, leastFoot } = PAINT_RIG_CONTACT_SHADOW, foot = Math.max(leastFoot, length);
  const x = (heel.x + toe.x) / 2, y = ground(x), lift = Math.max(0, y - Math.max(heel.y, toe.y)), spread = 1 + lift / foot;
  return {
    centre: { x, y },
    rx: (Math.abs(toe.x - heel.x) / 2 + reach * foot) * spread,
    ry: (Math.abs(toe.y - heel.y) / 2 + depth * foot) * spread,
    strength: planted ? strength : strength / (spread * spread),
  };
}

/** How far each shadow reaches before it's faded to nothing: a box round them all, plane px. */
export function paintRigShadowsBox(shadows: readonly PaintRigContactShadow[]): { x0: number; y0: number; x1: number; y1: number } {
  const span = 1.6;
  return {
    x0: Math.min(...shadows.map(({ centre, rx }) => centre.x - span * rx)), x1: Math.max(...shadows.map(({ centre, rx }) => centre.x + span * rx)),
    y0: Math.min(...shadows.map(({ centre, ry }) => centre.y - span * ry)), y1: Math.max(...shadows.map(({ centre, ry }) => centre.y + span * ry)),
  };
}

/** How much the shadows together darken plane point `p`, 0..1: each a multiply, so overlapping ones deepen without passing black. */
export function paintRigShadowAt(shadows: readonly PaintRigContactShadow[], p: StampPoint): number {
  let kept = 1;
  for (const { centre, rx, ry, strength } of shadows) {
    const dx = (p.x - centre.x) / rx, dy = (p.y - centre.y) / ry;
    kept *= 1 - strength * Math.exp(-PAINT_RIG_CONTACT_SHADOW.falloff * (dx * dx + dy * dy));
  }
  return 1 - kept;
}

/**
 * A planted foot's drift over one frame step: the move of whichever contact (heel, toe) moved least, `before` to
 * `after`. A rolling foot turns about the contact bearing its weight, which stays put, so a roll isn't slide. Summed
 * as vectors over a run, sub-pixel jitter cancels.
 */
export function paintRigFootDriftStep(before: readonly StampPoint[], after: readonly StampPoint[]): StampPoint {
  const moves = before.map((p, k) => ({ x: after[k].x - p.x, y: after[k].y - p.y }));
  return moves.reduce((least, move) => (Math.hypot(move.x, move.y) < Math.hypot(least.x, least.y) ? move : least));
}
