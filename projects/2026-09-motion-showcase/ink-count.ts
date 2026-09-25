// The count at the foot of the ink field (ink-field.ts), where bar 4 lands it and bar 5 picks it up. Apart from the
// field because it's set on the studio's Odometer, so the field's layout stays a model a scene model can read.

import { ODOMETER_DIGIT_EM } from '../../lib/studio/api.ts';
import { archivoAdvance } from '#models/reel/ticker-layout.ts';

/**
 * The count at the field's foot, an Odometer in Archivo 900 at width 72: its digits 300 px tall (28% of the frame)
 * from x 96 on the baseline 952. `size` is the Odometer's size for that, `top` the digits' top, and `cell` a place's
 * width (its 1ch plus the tracking), for setting type after the digits.
 */
export const INK_COUNT = (() => {
  const left = 96, base = 952, weight = 900, wdth = 72, tracking = -0.02;
  const size = 300 / ODOMETER_DIGIT_EM.height;
  const cell = (archivoAdvance('0', { wght: weight, wdth }) + tracking) * size;
  return { left, base, weight, wdth, tracking, size, top: base - ODOMETER_DIGIT_EM.top * size, cell };
})();
