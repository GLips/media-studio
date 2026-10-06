// stamp-sheet-damp-report.ts: the damp windows a solve reads when asked (`studio paint check --solve`), once an entry
// has landed: for a wash's last, when the paper it wetted is damp; for a bloom, when its footprint is damp again. Each
// is read off the wet field from that landing on, where the field keeps each texel's latest wetting, so the laws give
// every texel's matte and set steps exactly. A wash's core is its wash-law applications' touches together and its
// prewet's contact, weighed by neither fluid, region nor clip.

import { stampDampFirstWidth, stampDampStep, stampDampWindow } from '../models/stamp-damp-histogram.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { stampSheetWashSpans, type StampSheetProgram } from '../models/stamp-sheet-program.ts';
import {
  STAMP_SHEET_SHARE, STAMP_SHEET_STEP, stampSheetRegimeOf, type StampSheetDampReport, type StampSheetDampWindow, type StampSheetMoment,
} from '../models/stamp-sheet-schedule.ts';
import { clearStampTarget } from './stamp-paint-gpu.ts';
import type { StampSheetSolveGpu } from './stamp-sheet-load.ts';
import type { StampSheetCore } from './stamp-sheet-reductions.ts';
import type { StampSheetPrepare, StampSheetSteps } from './stamp-sheet-steps.ts';

/**
 * Where a run stands once entry `k` has landed, as its damp report reads it: model time now, what its wash touched
 * (null for nothing on the stage), and a later model time as a moment of the entry's clock.
 */
export type StampSheetDampReportAt = { tau: number; touched: StampPixelBox | null; moment: (tau: number) => StampSheetMoment };

/**
 * A run's damp report over its loaded GPU work: `coreOf` and `touchOf`, an entry's core and the work laying its touch,
 * as its decision reads them.
 */
export function createStampSheetDampReport({ program, gpu, steps, coreOf, touchOf }: {
  program: StampSheetProgram; gpu: StampSheetSolveGpu; steps: StampSheetSteps; coreOf: (k: number) => StampSheetCore | null; touchOf: (k: number) => StampSheetPrepare;
}) {
  const { washes, entries, clock } = program, { last } = stampSheetWashSpans(program);

  /**
   * When `core`, its touch laid by `touch`, is damp over STAMP_SHEET_SHARE of its wetted weight (what met water), from
   * `at.tau` on: its first step that holds to the first after its last, or never at once, at most how much and when.
   * Null where none of it holds water, or all of that has set by then.
   */
  const windowOf = async (core: StampSheetCore, touch: StampSheetPrepare, at: StampSheetDampReportAt): Promise<StampSheetDampWindow | null> => {
    const { tau } = at, totals = await steps.totalsAt(core, tau, touch, null), wetted = totals.weight - totals.never;
    if (wetted <= 0 || totals.latestSet === null || totals.latestSet <= tau) return null;
    const histogram = await steps.histogramAt(core, tau, 0, stampDampFirstWidth(stampDampStep(totals.latestSet, tau)));
    const found = await stampDampWindow(histogram, STAMP_SHEET_SHARE * wetted, ({ start, width }) => steps.histogramAt(core, tau, start, width));
    const moment = (step: number) => at.moment(tau + step * STAMP_SHEET_STEP);
    if (found.kind === 'uneven') return { kind: 'uneven', share: found.most.weight / wetted, at: moment(found.most.step) };
    return { kind: 'damp', from: moment(found.from), to: moment(found.to + 1) };
  };

  /** Wash `w`'s core once its last entry `k` has landed (`touched`, where it touched), with the work laying it. */
  const washCoreOf = (k: number, w: number, touched: StampPixelBox): { core: StampSheetCore; touch: StampSheetPrepare } => {
    const { prewet } = washes[w], region = gpu.prewetRegion(w), { targets } = gpu;
    const own = entries.flatMap(({ wash, deposit }, j) => (j <= k && wash === w && gpu.bank.get(deposit)!.wash ? [j] : []));
    return {
      core: { box: touched, fluid: null, within: null, clipped: false, prewet: prewet && region ? { region, fluid: gpu.fluidOf(prewet.held) } : null },
      touch: (encoder) => {
        clearStampTarget(encoder, targets.core.view);
        for (const j of own) {
          const { deposit } = entries[j], loaded = gpu.bank.get(deposit)!;
          if (loaded.box) gpu.drawing.drawTouch(encoder, deposit, loaded, loaded.box, targets.core.view, true);
        }
      },
    };
  };

  return {
    /**
     * What entry `k` of wash `w` reads as it lands `at`, where its paper dries by its laws: for a bloom, when its
     * footprint is damp again; for its wash's last, when what the wash wetted is damp. None under `instant` or `never`.
     */
    async after(k: number, w: number, at: StampSheetDampReportAt): Promise<StampSheetDampReport> {
      if (stampSheetRegimeOf(clock, entries[k].orderTime) !== 'drying') return { wash: null, rewet: null };
      const core = entries[k].bloom ? coreOf(k) : null, rewet = core && await windowOf(core, touchOf(k), at);
      const wash = last[w] === k && washes[w].wetHistory && at.touched ? washCoreOf(k, w, at.touched) : null;
      return { wash: wash && await windowOf(wash.core, wash.touch, at), rewet };
    },
  };
}
