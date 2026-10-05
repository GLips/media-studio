// stamp-paint-costs.ts: what painting cost, counted as it ran, in the one set of names every producer shares: the
// document's evaluations, the shot's poses, the sheet solver's solves and schedule decisions, the film store's and GPU
// cache's hits, misses and evictions, readbacks and uploads. It sits in painting, the lowest feature all of them
// import, so they count into one tally; the shot sends a frame's or a warmed span's to the profiler
// (shot-cost-report.ts), and a gate case reads one to hold what a change re-solves. Counting never changes what's drawn.

/**
 * What a tally counts, in the order a report prints them. `solves` and `entries run` come with each solve; `bytes
 * uploaded` is a size, the rest are events.
 */
export const STAMP_PAINT_COST_NAMES = [
  'evaluations made', 'evaluation memo hits', 'hidden solves skipped', 'poses made', 'pose hits', 'solves', 'entries run', 'decisions made', 'decisions reused',
  'film hits', 'film misses', 'picture hits', 'picture misses', 'film readback hits', 'film readback misses', 'checkpoint hits', 'checkpoint misses',
  'evictions', 'readbacks', 'bytes uploaded',
] as const;

export type StampPaintCostName = (typeof STAMP_PAINT_COST_NAMES)[number];

/** A count any producer adds to; a solve's two come only with the solve (StampPaintCostTally's `solved`). */
export type StampPaintCostCount = Exclude<StampPaintCostName, 'solves' | 'entries run'>;

/** One sheet program solved: `program` names it (its evaluation and sheet), `from` the first entry it re-ran, `entries` how many ran. */
export type StampPaintSolveCost = { readonly program: string; readonly from: string; readonly entries: number };

/**
 * The bytes a device's GPU cache holds (stamp-paint-gpu-cache.ts): `kept`, what passes made to find again (films,
 * pictures, checkpoints and the like), and `targets`, what passes work in.
 */
export type StampGpuCacheBytes = { readonly kept: number; readonly targets: number };

/**
 * A frame's or a warmed span's costs: every count by name, in STAMP_PAINT_COST_NAMES' order; every solve; the
 * warnings met, as `studio paint check` prints them; and the bytes the device's cache held at its end.
 */
export type StampPaintCosts = {
  readonly counts: ReadonlyMap<StampPaintCostName, number>;
  readonly solves: readonly StampPaintSolveCost[];
  readonly warnings: readonly string[];
  readonly bytes: StampGpuCacheBytes;
};

/**
 * Counts painting's costs as they happen; `take` hands over what it counted and starts again from nothing, `counted`
 * shows it and counts on.
 */
export type StampPaintCostTally = {
  readonly count: (name: StampPaintCostCount, n?: number) => void;
  readonly solved: (solve: StampPaintSolveCost) => void;
  /** A warning met as the frame drew, printed: it fails nothing, so the report is where it's seen. */
  readonly warned: (text: string) => void;
  /** The bytes the device's cache holds now: levels, the latest kept. */
  readonly retained: (bytes: StampGpuCacheBytes) => void;
  readonly take: () => StampPaintCosts;
  readonly counted: () => StampPaintCosts;
};

const noCosts = () => new Map(STAMP_PAINT_COST_NAMES.map((name) => [name, 0]));

export function createStampPaintCostTally(): StampPaintCostTally {
  let counts = noCosts(), solves: StampPaintSolveCost[] = [], warnings: string[] = [], bytes: StampGpuCacheBytes = { kept: 0, targets: 0 };
  const add = (name: StampPaintCostName, n: number) => counts.set(name, (counts.get(name) ?? 0) + n);
  return {
    count: (name, n = 1) => { add(name, n); },
    solved: (solve) => {
      solves.push(solve);
      add('solves', 1);
      add('entries run', solve.entries);
    },
    warned: (text) => { warnings.push(text); },
    retained: (held) => { bytes = held; },
    counted: () => ({ counts, solves, warnings, bytes }),
    take: () => {
      const costs = { counts, solves, warnings, bytes };
      counts = noCosts();
      solves = [];
      warnings = [];
      return costs;
    },
  };
}
