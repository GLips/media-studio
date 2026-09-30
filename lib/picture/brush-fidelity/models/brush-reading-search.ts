// brush-reading-search.ts: the search `npm run brushes:fit` runs over an app's reading (brush-readings.ts), apart
// from how a reading is scored (lib/picture/brush-fidelity/engine/brush-reading-fit.ts paints every brush and sums
// the sheet's scores). Coordinate descent: each constant in turn tries a step either way and keeps the better, and a
// constant whose steps both lose halves its step, until every step is fine. Constants and candidates go in a fixed
// order, so the same scores give the same fit.

/**
 * How each constant is searched: within `min`..`max`, by a factor (`times`, for a scale) or an amount (`plus`) either
 * way, halved (a factor's square root) each time neither way wins, down to `finest`.
 */
export type BrushReadingRange = { min: number; max: number; step: { times: number; finest: number } | { plus: number; finest: number } };

/** A reading: named constants an importer reads every brush of its app by. */
export type BrushReading = Record<string, number>;

/** A reading's total score: lower is closer. */
export type BrushReadingScore<R extends BrushReading> = (reading: R) => Promise<number>;

export type BrushReadingFitStep = { key: string; from: number; to: number; total: number };

/** A win smaller than this is noise: a GPU may round a pixel a level differently between draws. */
const FIT_TOLERANCE = 0.005;

const rounded = (n: number) => Math.round(n * 10000) / 10000;

/**
 * The reading `score` finds best from `start`, searching only `keys` (every constant by default), with each step it
 * took. `onStep` hears each kept step as it's taken.
 */
export async function searchBrushReading<R extends BrushReading>(
  start: R, ranges: Readonly<Record<keyof R & string, BrushReadingRange>>, score: BrushReadingScore<R>,
  { keys = Object.keys(ranges) as (keyof R & string)[], maxPasses = 8, onStep }: { keys?: readonly (keyof R & string)[]; maxPasses?: number; onStep?: (step: BrushReadingFitStep) => void } = {},
): Promise<{ reading: R; total: number; steps: BrushReadingFitStep[] }> {
  let reading = { ...start }, total = await score(reading);
  const steps: BrushReadingFitStep[] = [];
  const size: Record<string, number> = Object.fromEntries(keys.map((key) => { const { step } = ranges[key]; return [key, 'times' in step ? step.times : step.plus]; }));
  const fine = (key: keyof R & string) => size[key] <= ranges[key].step.finest;
  for (let pass = 0; pass < maxPasses && !keys.every(fine); pass++) {
    for (const key of keys) {
      if (fine(key)) continue;
      const { min, max, step } = ranges[key];
      const now = reading[key] as number;
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
