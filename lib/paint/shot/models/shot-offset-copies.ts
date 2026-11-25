// shot-offset-copies.ts: offset copies, the first built-in effect and a worked example of one (shot-effect.ts): its
// input, then `count` copies behind it, each `dx`, `dy` plane px past the one before and faded by `fade` again. The
// copies lie wherever their offsets carry them, past the input's own box. Its studio half is
// shot-offset-copies-gpu.ts.

import { SHOT_EFFECT_READS_MOST, defineShotEffect, type ShotEffectProblem } from './shot-effect.ts';

/** Offset copies' parameters: how many copies lie behind the input, the offset between each and the next, and how much each fades past the one before. */
export type ShotOffsetCopiesParams = { readonly count: number; readonly dx: number; readonly dy: number; readonly fade: number };

/**
 * `source` and `count` copies of it behind, each `dx`, `dy` plane px past the one before (to the right and down) and
 * `fade` times as visible: `shotPlace(offsetCopies(hero, { count: 3, dx: 24, fade: 0.6 }), { id, depth })`.
 */
export const offsetCopies = defineShotEffect({
  name: 'offsetCopies',
  inputs: ['source'],
  defaults: { count: 2, dx: 16, dy: 0, fade: 0.6 } satisfies ShotOffsetCopiesParams,
  problems: ({ count, dx, dy, fade }) => {
    const problems: ShotEffectProblem[] = [];
    if (!(Number.isInteger(count) && count >= 1 && count < SHOT_EFFECT_READS_MOST)) problems.push({ field: 'count', message: `${count} isn't a whole number of copies from 1 to ${SHOT_EFFECT_READS_MOST - 1}` });
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) problems.push({ field: 'dx', message: `${dx}, ${dy} isn't a finite offset` });
    if (!(fade >= 0 && fade <= 1)) problems.push({ field: 'fade', message: `${fade} isn't within 0..1` });
    return problems;
  },
  // The input first, then each copy farther back.
  reads: ({ count, dx, dy }) => Array.from({ length: count + 1 }, (_, k) => ({ input: 'source', map: { ma: 1, mb: 0, kx: k * dx, ky: k * dy } })),
});
