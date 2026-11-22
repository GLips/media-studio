// bounce-units.ts: the bouncing ball's units, shared by the ball's model, the swell it launches into and its drawing.

import { motionCurves } from '#lib/picture/motion/models/motion.ts';

/** One frame of the reference reel (60 fps): the unit its timings were measured in. */
export const REF_F = 1 / 60;
export const TAU = 2 * Math.PI;
export const DEG = 180 / Math.PI;
export const smoothstep = motionCurves.dissolve;
