// procreate-reading-fit.ts: the search `npm run brushes:fit` runs over a ProcreateReading (procreate-brush.ts), apart
// from how a reading is scored (lib/picture/stamp-paint/engine/stamp-brush-fit.ts paints every brush and sums the
// sheet's scores). Coordinate descent: each constant in turn tries a step either way and keeps the better, and a
// constant whose steps both lose halves its step, until every step is fine. Constants and candidates go in a fixed
// order, so the same scores give the same fit.

import type { ProcreateReading } from './procreate-brush.ts';

/**
 * How each constant is searched: within `min`..`max`, by a factor (`times`, for a scale) or an amount (`plus`) either
 * way, halved (a factor's square root) each time neither way wins, down to `finest`.
 */
export type ProcreateReadingRange = { min: number; max: number; step: { times: number; finest: number } | { plus: number; finest: number } };

export const PROCREATE_READING_RANGES: Readonly<Record<keyof ProcreateReading, ProcreateReadingRange>> = {
  taperShare: { min: 0.05, max: 1, step: { plus: 0.2, finest: 0.03 } },
  edgeWidth: { min: 0.005, max: 0.3, step: { times: 2, finest: 1.1 } },
  rimSharpness: { min: 1, max: 128, step: { times: 2, finest: 1.1 } },
  wetRim: { min: 0.1, max: 3, step: { times: 2, finest: 1.1 } },
  grainTile: { min: 0.25, max: 12, step: { times: 2, finest: 1.1 } },
  grainBrightness: { min: -1, max: 1, step: { plus: 0.4, finest: 0.05 } },
  grainDepthCurve: { min: 0.2, max: 4, step: { times: 2, finest: 1.1 } },
  glazeFlowCurve: { min: 0.2, max: 4, step: { times: 2, finest: 1.1 } },
  blendingFlowCurve: { min: 0.2, max: 4, step: { times: 2, finest: 1.1 } },
  dualScale: { min: 0.25, max: 4, step: { times: 2, finest: 1.1 } },
  spacingPower: { min: 0.25, max: 1, step: { plus: 0.15, finest: 0.02 } },
  lateralJitterScale: { min: 0.05, max: 2, step: { times: 2, finest: 1.1 } },
  lateralJitterPower: { min: 0.25, max: 1.5, step: { plus: 0.25, finest: 0.03 } },
  glazeBuildLight: { min: 0, max: 1, step: { plus: 0.5, finest: 0.06 } },
  glazeBuildUniform: { min: 0, max: 1, step: { plus: 0.5, finest: 0.06 } },
  glazeBuildIntense: { min: 0, max: 1, step: { plus: 0.5, finest: 0.06 } },
  glazeBuildHeavy: { min: 0, max: 1, step: { plus: 0.5, finest: 0.06 } },
};

/** A reading's total score: lower is closer. */
export type ProcreateReadingScore = (reading: ProcreateReading) => Promise<number>;

export type ProcreateReadingFitStep = { key: keyof ProcreateReading; from: number; to: number; total: number };

/** A win smaller than this is noise: a GPU may round a pixel a level differently between draws. */
const FIT_TOLERANCE = 0.005;

const rounded = (n: number) => Math.round(n * 10000) / 10000;

/**
 * The reading `score` finds best from `start`, searching only `keys` (every constant by default), with each step it
 * took. `onStep` hears each kept step as it's taken.
 */
export async function fitProcreateReading(
  start: ProcreateReading, score: ProcreateReadingScore,
  { keys = Object.keys(PROCREATE_READING_RANGES) as (keyof ProcreateReading)[], maxPasses = 8, onStep }: { keys?: readonly (keyof ProcreateReading)[]; maxPasses?: number; onStep?: (step: ProcreateReadingFitStep) => void } = {},
): Promise<{ reading: ProcreateReading; total: number; steps: ProcreateReadingFitStep[] }> {
  let reading = { ...start }, total = await score(reading);
  const steps: ProcreateReadingFitStep[] = [];
  const size = Object.fromEntries(keys.map((key) => [key, 'times' in PROCREATE_READING_RANGES[key].step ? (PROCREATE_READING_RANGES[key].step as { times: number }).times : (PROCREATE_READING_RANGES[key].step as { plus: number }).plus]));
  const fine = (key: keyof ProcreateReading) => size[key] <= PROCREATE_READING_RANGES[key].step.finest;
  for (let pass = 0; pass < maxPasses && !keys.every(fine); pass++) {
    for (const key of keys) {
      if (fine(key)) continue;
      const { min, max, step } = PROCREATE_READING_RANGES[key];
      const now = reading[key];
      const tries = ('times' in step ? [now / size[key], now * size[key]] : [now - size[key], now + size[key]])
        .map((v) => rounded(Math.min(max, Math.max(min, v)))).filter((v, i, all) => v !== now && all.indexOf(v) === i);
      let won: { value: number; total: number } | null = null;
      for (const value of tries) {
        const t = await score({ ...reading, [key]: value });
        if (t < total - FIT_TOLERANCE && (!won || t < won.total)) won = { value, total: t };
      }
      if (won) {
        const taken = { key, from: now, to: won.value, total: won.total };
        steps.push(taken);
        onStep?.(taken);
        reading = { ...reading, [key]: won.value };
        total = won.total;
      } else {
        size[key] = 'times' in step ? Math.sqrt(size[key]) : size[key] / 2;
      }
    }
  }
  return { reading, total, steps };
}
