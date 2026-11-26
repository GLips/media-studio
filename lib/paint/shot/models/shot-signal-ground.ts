import { defineShotEffect } from './shot-effect.ts';

/** An opaque field of dark packets, checker fragments and phosphor noise, rerolled by its source schedule. */
export const signalGround = defineShotEffect({
  name: 'signalGround', inputs: [], extent: 'stage', defaults: { seed: 17 },
  problems: ({ seed }) => Number.isInteger(seed) && seed >= 0 && seed < 2 ** 24 ? [] : [{ field: 'seed', message: 'needs an unsigned 24-bit seed' }],
  varies: () => ['drawing'],
});
