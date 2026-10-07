// stamp-paint-costs.ts: what painting cost, counted as it ran, in the one set of names every producer shares: the
// document's evaluations and compiles, the shot's poses, the sheet solver's solves and schedule decisions, the film
// store's and GPU cache's hits, misses and evictions, readbacks and uploads; and what the GPU cache and the page's memos
// keep. It sits in painting, the lowest feature all of them import, so they count into one tally; the shot sends a
// frame's or a warmed span's to the profiler (shot-cost-report.ts), and a gate case reads one to hold what a change
// re-solves. Counting never changes what's drawn.

import type { StampKeptHeld } from './stamp-kept-memo.ts';

/**
 * What a tally counts, in the order a report prints them. `solves` and `entries run` come with each solve; `bytes
 * uploaded` is a size, the rest are events.
 */
export const STAMP_PAINT_COST_NAMES = [
  'evaluations made', 'evaluation memo hits', 'selections compiled', 'selection hits', 'hidden solves skipped', 'poses made', 'pose hits', 'solves', 'entries run', 'decisions made', 'decisions reused',
  'film hits', 'film misses', 'picture hits', 'picture misses', 'film readback hits', 'film readback misses', 'checkpoint hits', 'checkpoint misses',
  'evictions', 'readbacks', 'bytes uploaded',
] as const;

export type StampPaintCostName = (typeof STAMP_PAINT_COST_NAMES)[number];

/** A count any producer adds to; a solve's two come only with the solve (StampPaintCostTally's `solved`). */
export type StampPaintCostCount = Exclude<StampPaintCostName, 'solves' | 'entries run'>;

/**
 * What the page's memos keep (stamp-kept-memo.ts), each as how many values and their bytes, roughly: `compiled`, the
 * selections compiled across evaluations; `posed`, their programs posed; `placed`, deposits' placements.
 */
export type StampPaintKept = { readonly compiled: StampKeptHeld; readonly posed: StampKeptHeld; readonly placed: StampKeptHeld };

const keptNothing: StampPaintKept = { compiled: { count: 0, bytes: 0 }, posed: { count: 0, bytes: 0 }, placed: { count: 0, bytes: 0 } };

/** One sheet program solved: `program` names it (its evaluation and sheet), `from` the first entry it re-ran, `entries` how many ran. */
export type StampPaintSolveCost = { readonly program: string; readonly from: string; readonly entries: number };

/**
 * The bytes a device's GPU cache holds (stamp-paint-gpu-cache.ts): `kept`, what passes made to find again (films,
 * pictures, checkpoints and the like), and `targets`, what passes work in.
 */
export type StampGpuCacheBytes = { readonly kept: number; readonly targets: number };

/**
 * A frame's or a warmed span's costs: every count by name, in STAMP_PAINT_COST_NAMES' order; what was planned, as
 * `studio paint check` prints it (a painting in time's key drawings); every solve; the warnings met, as `studio paint
 * check` prints them; and at its end, the bytes the device's cache held and what the page's memos kept.
 */
export type StampPaintCosts = {
  readonly counts: ReadonlyMap<StampPaintCostName, number>;
  readonly plans: readonly string[];
  readonly solves: readonly StampPaintSolveCost[];
  readonly warnings: readonly string[];
  readonly bytes: StampGpuCacheBytes;
  readonly kept: StampPaintKept;
};

/**
 * Counts painting's costs as they happen; `take` hands over what it counted and starts again from nothing, `counted`
 * shows it and counts on.
 */
export type StampPaintCostTally = {
  readonly count: (name: StampPaintCostCount, n?: number) => void;
  readonly solved: (solve: StampPaintSolveCost) => void;
  /** A line of what a load planned to solve, printed: the report says what it chose and why. */
  readonly planned: (text: string) => void;
  /** A warning met as the frame drew, printed: it fails nothing, so the report is where it's seen. */
  readonly warned: (text: string) => void;
  /** The bytes the device's cache holds now and what the page's memos keep: levels, the latest kept. */
  readonly retained: (bytes: StampGpuCacheBytes, kept: StampPaintKept) => void;
  readonly take: () => StampPaintCosts;
  readonly counted: () => StampPaintCosts;
  /**
   * Starts a wait on the GPU of kind `what`; what's returned ends it. Timed by whoever made the tally (a shot's trace),
   * never here: counting reads no clock.
   */
  readonly waiting: (what: StampPaintWait) => () => void;
};

/** A wait a tally's maker may time: a readback's mapping. */
export type StampPaintWait = 'readback';

const notTimed = () => () => {};

const noCosts = () => new Map(STAMP_PAINT_COST_NAMES.map((name) => [name, 0]));

/** A tally, its waits timed by `timeWait` (untimed unless given). */
export function createStampPaintCostTally({ timeWait = notTimed }: { timeWait?: (what: StampPaintWait) => () => void } = {}): StampPaintCostTally {
  let counts = noCosts(), plans: string[] = [], solves: StampPaintSolveCost[] = [], warnings: string[] = [], bytes: StampGpuCacheBytes = { kept: 0, targets: 0 }, kept = keptNothing;
  const add = (name: StampPaintCostName, n: number) => counts.set(name, (counts.get(name) ?? 0) + n);
  return {
    count: (name, n = 1) => { add(name, n); },
    solved: (solve) => {
      solves.push(solve);
      add('solves', 1);
      add('entries run', solve.entries);
    },
    planned: (text) => { plans.push(text); },
    warned: (text) => { warnings.push(text); },
    retained: (held, memos) => {
      bytes = held;
      kept = memos;
    },
    counted: () => ({ counts, plans, solves, warnings, bytes, kept }),
    waiting: timeWait,
    take: () => {
      const costs = { counts, plans, solves, warnings, bytes, kept };
      counts = noCosts();
      plans = [];
      solves = [];
      warnings = [];
      return costs;
    },
  };
}
