// shot-trail.ts: a trail, a built-in effect (shot-effect.ts): its input now, then `count` ghosts of it as it was, each
// `every.drawings` drawings further back on the drawing clock its plane's `sourceClock` declares, and faded by `fade`
// again. A ghost is read where and as it was drawn, laid through the plane as it lay then, and seen through the
// camera as it stands now. Before the source's first drawing in the shot there's no ghost. Its studio half is
// shot-trail-gpu.ts.

import { SHOT_EFFECT_READS_MOST, defineShotEffect, type ShotEffectProblem, type ShotEffectRead } from './shot-effect.ts';

/** A trail's parameters: how many ghosts follow the input, how many drawings apart, and how much each fades past the one before. */
export type ShotTrailParams = { readonly count: number; readonly every: { readonly drawings: number }; readonly fade: number };

/**
 * `source` and `count` ghosts of it, each `every.drawings` drawings before the one after it and `fade` times as
 * visible, on a plane declaring its drawing clock: `shotPlace(trail(hand, { count: 3, every: { drawings: 1 }, fade:
 * 0.6 }), { id, depth, sourceClock: { hold: 2 } })`.
 */
export const trail = defineShotEffect({
  name: 'trail',
  inputs: ['source'],
  defaults: { count: 3, every: { drawings: 1 }, fade: 0.6 } satisfies ShotTrailParams,
  problems: ({ count, every, fade }) => {
    const problems: ShotEffectProblem[] = [];
    if (!(Number.isInteger(count) && count >= 1 && count < SHOT_EFFECT_READS_MOST)) problems.push({ field: 'count', message: `${count} isn't a whole number of ghosts from 1 to ${SHOT_EFFECT_READS_MOST - 1}` });
    if (!(Number.isInteger(every.drawings) && every.drawings >= 1)) problems.push({ field: 'every.drawings', message: `${every.drawings} isn't a whole number of drawings from 1` });
    if (!(fade >= 0 && fade <= 1)) problems.push({ field: 'fade', message: `${fade} isn't within 0..1` });
    return problems;
  },
  // The input now first, then each ghost further back.
  reads: ({ count, every }) => Array.from({ length: count + 1 }, (_, k): ShotEffectRead<'source'> => (k ? { input: 'source', moment: { drawingsEarlier: k * every.drawings } } : { input: 'source' })),
});
