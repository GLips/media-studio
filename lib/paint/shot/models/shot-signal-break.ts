import { defineShotEffect, type ShotEffectProblem } from './shot-effect.ts';

const NO_HITS: readonly number[] = [];

const DEFAULTS = { hits: NO_HITS, decay: 0.25, tear: 160, fringe: 12, dropout: 0.48, posterize: true };

/** Split and tear a foreground and optional backing together. Hits are scene seconds, decay is seconds.
 * Dropout opens the composite onto the plane behind it. Posterize coarsens its colour at peak signal loss.
 */
export const signalBreak = defineShotEffect({
  name: 'signalBreak', inputs: ['source', 'under'], optional: ['under'], extent: 'stage',
  defaults: DEFAULTS,
  varies: () => ['drawing', 'moment'],
  problems: ({ hits, decay, tear, fringe, dropout }) => {
    const problems: ShotEffectProblem[] = [];
    if (hits.length > 48 || !hits.every(Number.isFinite)) problems.push({ field: 'hits', message: 'needs at most 48 finite cue times' });
    if (!(Number.isFinite(decay) && decay > 0)) problems.push({ field: 'decay', message: 'needs a positive finite duration' });
    if (!(Number.isFinite(tear) && tear >= 0)) problems.push({ field: 'tear', message: 'needs finite nonnegative pixels' });
    if (!(Number.isFinite(fringe) && fringe >= 0)) problems.push({ field: 'fringe', message: 'needs finite nonnegative pixels' });
    if (!(dropout >= 0 && dropout <= 1)) problems.push({ field: 'dropout', message: 'needs a share within 0..1' });
    return problems;
  },
});
