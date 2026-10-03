// shot-cost-report.ts: what a PaintedShot's frame or warmed span cost, counted as it ran: evaluations, poses, sheet
// program solves (from which entry, how many entries), schedule decisions, cache hits and misses, evictions,
// readbacks and bytes. A tally per frame and one per warm; each goes to `studio profile --costs` through the frame
// profiler, and a gate case reads it to hold what a change re-solves. Counting never changes what's drawn.

import type { FrameCost, FrameCostsEntry } from '#lib/picture/profiling/models/frame-profile-entry.ts';

/** The label a frame's costs are logged under, and a warmed span's. */
export const SHOT_FRAME_COSTS_LABEL = 'stamp paint costs';
export const SHOT_WARM_COSTS_LABEL = 'stamp paint warm costs';

/** What a shot counts. `bytes uploaded` is a size; the rest are events. */
export type ShotCostCount =
  | 'evaluations made' | 'evaluation memo hits' | 'poses made' | 'pose hits' | 'decisions made' | 'decisions reused'
  | 'film hits' | 'film misses' | 'picture hits' | 'picture misses' | 'checkpoint hits' | 'checkpoint misses'
  | 'evictions' | 'readbacks' | 'bytes uploaded';

/** One sheet program solved: `program` names it (its evaluation and sheet), `from` the first entry it re-ran, `entries` how many ran. */
export type ShotSolveCost = { readonly program: string; readonly from: string; readonly entries: number };

/** A frame's or a warmed span's costs: each count, every solve, and the bytes the shot's caches held at its end. */
export type ShotCosts = { readonly counts: Readonly<Record<ShotCostCount, number>>; readonly solves: readonly ShotSolveCost[]; readonly bytesRetained: number };

/** Counts a shot's costs as they happen; `take` hands over what it counted and starts again from nothing. */
export type ShotCostTally = {
  readonly count: (name: ShotCostCount, n?: number) => void;
  readonly solved: (solve: ShotSolveCost) => void;
  /** The bytes the shot's caches hold now: a level, the latest kept. */
  readonly retained: (bytes: number) => void;
  readonly take: () => ShotCosts;
};

/** Nothing counted, in the order a report lists the counts. */
const noCounts = (): Record<ShotCostCount, number> => ({
  'evaluations made': 0, 'evaluation memo hits': 0, 'poses made': 0, 'pose hits': 0, 'decisions made': 0, 'decisions reused': 0,
  'film hits': 0, 'film misses': 0, 'picture hits': 0, 'picture misses': 0, 'checkpoint hits': 0, 'checkpoint misses': 0,
  evictions: 0, readbacks: 0, 'bytes uploaded': 0,
});

export function createShotCostTally(): ShotCostTally {
  let counts = noCounts(), solves: ShotSolveCost[] = [], bytesRetained = 0;
  return {
    count: (name, n = 1) => { counts[name] += n; },
    solved: (solve) => { solves.push(solve); },
    retained: (bytes) => { bytesRetained = bytes; },
    take: () => {
      const costs = { counts, solves, bytesRetained };
      counts = noCounts();
      solves = [];
      return costs;
    },
  };
}

/** `costs` as the frame profiler logs them: the counts with the solves and the entries they ran, the bytes kept, a note a solve. */
export function shotCostsProfileEntry({ counts, solves, bytesRetained }: ShotCosts): Pick<FrameCostsEntry, 'counts' | 'levels' | 'notes'> {
  const counted: FrameCost[] = Object.entries(counts).map(([name, value]) => (name === 'bytes uploaded' ? { name, value, unit: 'bytes' } : { name, value }));
  const solved: FrameCost[] = [{ name: 'solves', value: solves.length }, { name: 'entries run', value: solves.reduce((sum, { entries }) => sum + entries, 0) }];
  return {
    counts: [...counted.slice(0, 4), ...solved, ...counted.slice(4)],
    levels: [{ name: 'bytes retained', value: bytesRetained, unit: 'bytes' }],
    notes: solves.map(({ program, from, entries }) => `solved ${program} from ${from}: ${entries} ${entries === 1 ? 'entry' : 'entries'}`),
  };
}
