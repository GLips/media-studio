// shot-cost-report.ts: a PaintedShot's costs as the frame profiler logs them. The shot counts a tally per frame and
// one per warm (stamp-paint-costs.ts, the names its producers share) and hands each to `useFrameCosts()` under these
// labels; `studio profile --costs` tables them. A warning met goes in as `studio paint check` prints it
// (paintingProblemText).

import type { StampKeptHeld } from '#lib/paint/painting/models/stamp-kept-memo.ts';
import type { StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { FrameCost, FrameCosts } from '#lib/picture/profiling/models/frame-profile-entry.ts';

/** The label a frame's costs are logged under, and a warmed span's. */
export const SHOT_FRAME_COSTS_LABEL = 'stamp paint costs';
export const SHOT_WARM_COSTS_LABEL = 'stamp paint warm costs';

/** A page memo's levels: how many values it keeps, and their bytes. */
const memoLevels = (name: string, { count, bytes }: StampKeptHeld): FrameCost[] => [{ name: `${name} kept`, value: count }, { name: `${name} bytes kept`, value: bytes, unit: 'bytes' }];

/**
 * `costs` as the frame profiler logs them: every count in its printed order; as levels, the GPU cache's bytes kept and
 * in targets, then each page memo's values and bytes; a note a line of a plan, a solve or a warning.
 */
export function shotCostsProfileEntry({ counts, plans, solves, warnings, bytes, kept }: StampPaintCosts): FrameCosts {
  return {
    counts: [...counts].map(([name, value]): FrameCost => (name === 'bytes uploaded' ? { name, value, unit: 'bytes' } : { name, value })),
    levels: [
      { name: 'GPU bytes kept', value: bytes.kept, unit: 'bytes' }, { name: 'GPU bytes in targets', value: bytes.targets, unit: 'bytes' },
      ...memoLevels('compiled selections', kept.compiled), ...memoLevels('posed programs', kept.posed), ...memoLevels('placements', kept.placed),
    ],
    notes: [...plans, ...solves.map(({ program, from, entries }) => `solved ${program} from ${from}: ${entries} ${entries === 1 ? 'entry' : 'entries'}`), ...warnings],
  };
}
