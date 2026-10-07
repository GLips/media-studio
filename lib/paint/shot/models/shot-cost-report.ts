// shot-cost-report.ts: a PaintedShot's costs on its trace's spans. The shot counts a tally per frame and one per warm
// (stamp-paint-costs.ts, the names its producers share), each going on its frame's or warm's span whole
// (frame-costs-table.ts, which `studio profile --costs` tables) and each solve's counts on its own. A warning met
// goes in as `studio paint check` prints it (paintingProblemText).

import type { StampKeptHeld } from '#lib/paint/painting/models/stamp-kept-memo.ts';
import type { StampPaintCostName, StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { TraceAttributes } from '#lib/platform/trace/models/trace-model.ts';
import type { FrameCost, FrameCosts } from '#lib/picture/profiling/models/frame-costs-table.ts';

/** A page memo's levels: how many values it keeps, and their bytes. */
const memoLevels = (name: string, { count, bytes }: StampKeptHeld): FrameCost[] => [{ name: `${name} kept`, value: count }, { name: `${name} bytes kept`, value: bytes, unit: 'bytes' }];

/**
 * `costs` as a frame's span carries them: every count in its printed order; as levels, the GPU cache's bytes kept and
 * in targets, then each page memo's values and bytes; a note a line of a plan, a solve or a warning.
 */
export function shotFrameCosts({ counts, plans, solves, warnings, bytes, kept }: StampPaintCosts): FrameCosts {
  return {
    counts: [...counts].map(([name, value]): FrameCost => (name === 'bytes uploaded' ? { name, value, unit: 'bytes' } : { name, value })),
    levels: [
      { name: 'GPU bytes kept', value: bytes.kept, unit: 'bytes' }, { name: 'GPU bytes in targets', value: bytes.targets, unit: 'bytes' },
      ...memoLevels('compiled selections', kept.compiled), ...memoLevels('posed programs', kept.posed), ...memoLevels('placements', kept.placed),
    ],
    notes: [...plans, ...solves.map(({ program, from, entries }) => `solved ${program} from ${from}: ${entries} ${entries === 1 ? 'entry' : 'entries'}`), ...warnings],
  };
}

/** A count's unit in a trace: bytes for a size, else how many times it happened. */
const costUnit = (name: StampPaintCostName) => (name === 'bytes uploaded' ? 'bytes' : 'times');

/** The counts in `after` past those in `before` (a tally's counts as a solve began), each that moved, as a trace's quantities. */
export function shotCostsTraceAttributes(after: ReadonlyMap<StampPaintCostName, number>, before?: ReadonlyMap<StampPaintCostName, number>): TraceAttributes {
  return Object.fromEntries([...after].flatMap(([name, value]) => {
    const moved = value - (before?.get(name) ?? 0);
    return moved ? [[name, { value: moved, unit: costUnit(name) }]] : [];
  }));
}
