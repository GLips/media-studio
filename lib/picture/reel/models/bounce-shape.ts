// bounce-shape.ts: the bouncing ball's units and its squash and stretch as a strain vector, shared by the ball's
// model and the swell it launches into.

import { motionCurves } from '#lib/picture/motion/models/motion.ts';

/** One frame of the reference reel (60 fps): the unit its timings were measured in. */
export const REF_F = 1 / 60;
export const TAU = 2 * Math.PI;
export const DEG = 180 / Math.PI;
export const smoothstep = motionCurves.dissolve;

// ---------- shape ----------

/**
 * A squash or stretch as one vector: ln(aspect) turned to twice the major axis's angle. Shapes blend by mixing these,
 * so a tall stretch passes through round into a flat squash rather than spinning, and every blend keeps the area.
 */
export type Strain = { x: number; y: number };
export const ROUND: Strain = { x: 0, y: 0 };
export const strainOf = (aspect: number, angle: number): Strain => {
  const l = Math.log(aspect);
  return { x: l * Math.cos(2 * angle), y: l * Math.sin(2 * angle) };
};
export const mixStrain = (a: Strain, b: Strain, k: number): Strain => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
export const scaleStrain = (a: Strain, k: number): Strain => ({ x: a.x * k, y: a.y * k });
export function shapeOfStrain(s: Strain) {
  const l = Math.hypot(s.x, s.y);
  return { aspect: Math.exp(l), angle: l > 1e-9 ? Math.atan2(s.y, s.x) / 2 : 0 };
}
/** How far below its centre a ball of radius `r` reaches under strain `s`. */
export function halfHeight(r: number, s: Strain) {
  const { aspect, angle } = shapeOfStrain(s), sin = Math.sin(angle), cos = Math.cos(angle);
  return r * Math.sqrt(aspect * sin * sin + (cos * cos) / aspect);
}
/** The reference's law: stretched along its velocity by 1 + speed × `k` (1 + v/107 in px per 60 fps frame). */
export const lawStrain = (vx: number, vy: number, k: number) => strainOf(1 + k * Math.hypot(vx, vy), Math.atan2(vy, vx));
