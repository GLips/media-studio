// brush-reading-search.ts: the search `npm run brushes:fit` runs over an app's reading (brush-readings.ts), apart
// from how a reading is scored (engine/brush-reading-fit.ts). Coordinate descent: each constant in turn tries a step
// either way and keeps the better, halving its step when both lose, until every step is fine, in a fixed order so the
// same scores give the same fit. `brushes:diagnose` draws its candidates from the same ranges (brushReadingCandidates).

/**
 * How far a constant may go and how it's stepped, for the fit and the diagnostic alike: within `min`..`max`, by a
 * `factor` (a scale) or a `step` (an amount) either way, the fit halving it (a factor's square root) each time neither
 * way wins, down to `finest`.
 */
export type BrushReadingRange =
  | { kind: 'multiplicative'; min: number; max: number; factor: number; finest: number }
  | { kind: 'additive'; min: number; max: number; step: number; finest: number };

/** A range's first stride: its factor or its step. */
const firstStride = (range: BrushReadingRange) => (range.kind === 'multiplicative' ? range.factor : range.step);

/**
 * `value` moved `strides` of `stride` along `range`: multiplied by a power of it, or added a multiple of it. Downward
 * a factor divides, so one stride down is exactly `value / stride`, bit for bit what the fit has always tried.
 */
const strideFrom = (range: BrushReadingRange, value: number, stride: number, strides: number) => {
  if (range.kind === 'additive') return value + stride * strides;
  return strides < 0 ? value / stride ** -strides : value * stride ** strides;
};

/** The diagnostic's candidates, in the range's own strides about the current value: half strides near it. */
export const BRUSH_READING_CANDIDATE_STRIDES = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5] as const;

/**
 * A constant's diagnostic candidates about `value`, ascending: BRUSH_READING_CANDIDATE_STRIDES of its range's first
 * stride, clamped to its range and rounded as the fit rounds, duplicates dropped, and `value` itself kept exactly as
 * the reading holds it, at `baseline`.
 */
export function brushReadingCandidates(range: BrushReadingRange, value: number): { values: number[]; baseline: number } {
  const moved = BRUSH_READING_CANDIDATE_STRIDES.filter((strides) => strides !== 0)
    .map((strides) => rounded(Math.min(range.max, Math.max(range.min, strideFrom(range, value, firstStride(range), strides)))));
  const values = [...new Set([...moved, value])].toSorted((a, b) => a - b);
  return { values, baseline: values.indexOf(value) };
}

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
  { keys = Object.keys(ranges).filter((key): key is keyof R & string => Object.hasOwn(ranges, key)), maxPasses = 8, onStep }: { keys?: readonly (keyof R & string)[]; maxPasses?: number; onStep?: (step: BrushReadingFitStep) => void } = {},
): Promise<{ reading: R; total: number; steps: BrushReadingFitStep[] }> {
  let reading = { ...start }, total = await score(reading);
  const steps: BrushReadingFitStep[] = [];
  const size: Record<string, number> = Object.fromEntries(keys.map((key) => [key, firstStride(ranges[key])]));
  const fine = (key: keyof R & string) => size[key] <= ranges[key].finest;
  for (let pass = 0; pass < maxPasses && !keys.every(fine); pass++) {
    for (const key of keys) {
      if (fine(key)) continue;
      const range = ranges[key], now = reading[key];
      const tries = [strideFrom(range, now, size[key], -1), strideFrom(range, now, size[key], 1)]
        .map((v) => rounded(Math.min(range.max, Math.max(range.min, v)))).filter((v, i, all) => v !== now && all.indexOf(v) === i);
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
        size[key] = range.kind === 'multiplicative' ? Math.sqrt(size[key]) : size[key] / 2;
      }
    }
  }
  return { reading, total, steps };
}
