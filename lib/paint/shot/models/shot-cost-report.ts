// shot-cost-report.ts: a PaintedShot's costs as the frame profiler logs them. The shot counts a tally per frame and
// one per warm (stamp-paint-costs.ts, the names its producers share) and hands each to `useFrameCosts()` under these
// labels; `studio profile --costs` tables them. A warning met goes in as `studio paint check` prints it
// (paintingProblemText).

import type { StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { FrameCost, FrameCosts } from '#lib/picture/profiling/models/frame-profile-entry.ts';

/** The label a frame's costs are logged under, and a warmed span's. */
export const SHOT_FRAME_COSTS_LABEL = 'stamp paint costs';
export const SHOT_WARM_COSTS_LABEL = 'stamp paint warm costs';

/** `costs` as the frame profiler logs them: every count in its printed order, the bytes kept, a note a solve or warning. */
export function shotCostsProfileEntry({ counts, solves, warnings, bytesRetained }: StampPaintCosts): FrameCosts {
  return {
    counts: [...counts].map(([name, value]): FrameCost => (name === 'bytes uploaded' ? { name, value, unit: 'bytes' } : { name, value })),
    levels: [{ name: 'bytes retained', value: bytesRetained, unit: 'bytes' }],
    notes: [...solves.map(({ program, from, entries }) => `solved ${program} from ${from}: ${entries} ${entries === 1 ? 'entry' : 'entries'}`), ...warnings],
  };
}
