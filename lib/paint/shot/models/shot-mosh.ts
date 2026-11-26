// A broken video signal carries blocks from an older drawing until the next one arrives.
import { defineShotEffect, type ShotEffectProblem, type ShotEffectRead } from './shot-effect.ts';

/** Block size and horizontal throw in plane px. Age counts earlier drawings of the plane's source clock. */
export const mosh = defineShotEffect({
  name: 'mosh',
  inputs: ['source', 'second', 'ground'],
  optional: ['second', 'ground'],
  defaults: { block: 64, throwPx: 112, age: 2, seed: 7, recolor: 0.6 },
  problems: ({ block, throwPx, age, seed, recolor }) => {
    const problems: ShotEffectProblem[] = [];
    if (!(Number.isInteger(block) && block >= 4)) problems.push({ field: 'block', message: 'needs a block at least four whole pixels wide' });
    if (!(Number.isFinite(throwPx) && throwPx >= 0)) problems.push({ field: 'throwPx', message: 'needs a finite nonnegative displacement' });
    if (!(Number.isSafeInteger(age) && age >= 0)) problems.push({ field: 'age', message: 'needs a whole number of earlier drawings' });
    if (!(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 24)) problems.push({ field: 'seed', message: 'needs an unsigned 24-bit seed' });
    if (!(recolor >= 0 && recolor <= 1)) problems.push({ field: 'recolor', message: 'needs a share from zero to one' });
    return problems;
  },
  varies: () => ['drawing'],
  reads: ({ age }, given): ShotEffectRead<'source' | 'second' | 'ground'>[] => [
    { input: 'source' }, { input: given.includes('second') ? 'second' : 'source', moment: { drawingsEarlier: age } },
    ...(given.includes('ground') ? [{ input: 'ground' } as const] : []),
  ],
  grow: ({ throwPx, block }) => Math.ceil(throwPx + block),
});
