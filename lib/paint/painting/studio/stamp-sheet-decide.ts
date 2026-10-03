// stamp-sheet-decide.ts: when one application lands (ENGINE 3.5), read off the wet field over its core: at τ0 for
// `wet`, at the first 1 ms step a damp histogram finds for `damp`, once the core's latest texel sets for `dry`; then
// checked by the field's own law, stepping a millisecond at a time while f32 rounding keeps it from holding. A bloom
// must find open paint on workable paper under its core to spread into.
//
// The decisions are the CPU's, in f64 (models/stamp-sheet-schedule.ts); the GPU only sums.

import {
  STAMP_SHEET_SHARE, STAMP_SHEET_STEP, STAMP_SHEET_VERIFY_STEPS, stampDampFirstStep, stampDampFirstWidth, stampDampStep, stampSheetEmptyCore, stampSheetGrid,
  stampSheetHeld, stampSheetHolds, stampSheetNearRounding, stampSheetUnreachable, stampSheetVerifyFault, stampSheetWithinRounding, stampSheetWontBloom,
  type StampSheetTotals,
} from '../models/stamp-sheet-schedule.ts';
import type { StampSheetWetness } from '../models/stamp-sheet-program.ts';
import { StampSheetRefusal } from '../models/stamp-sheet-refusal.ts';
import type { StampSheetCore } from './stamp-sheet-reductions.ts';
import type { StampSheetPrepare, StampSheetSteps } from './stamp-sheet-steps.ts';

/**
 * An application as its decision reads it: its name, what it waits for, its water when it must bloom (null when it
 * needn't), its core (null for one wholly off the stage), the work laying its touch and marking open paint, and
 * the names of the applications after it, for a failure's message.
 */
export type StampSheetDecideInput = {
  name: string; on: StampSheetWetness | null; bloom: number | null; core: StampSheetCore | null;
  touch: StampSheetPrepare; open: StampSheetPrepare; unscheduled: readonly string[];
};

/** When `input` lands, no earlier than `tau0`, and what its author should hear. Throws where it can't land. */
export async function decideStampSheetEntry(steps: StampSheetSteps, input: StampSheetDecideInput, tau0: number): Promise<{ tau: number; warnings: string[] }> {
  const { name, on, bloom, core, touch, open } = input;
  if (!on && bloom === null) return { tau: tau0, warnings: [] };
  if (!core) return { tau: tau0, warnings: [stampSheetEmptyCore(name)] };
  const first = await steps.totalsAt(core, tau0, touch, null);
  if (first.weight === 0) return { tau: tau0, warnings: [stampSheetEmptyCore(name)] };
  const warnings: string[] = [];
  let tau = tau0;
  if (on) {
    const decided = await firstHolding(steps, input, core, tau0, first);
    const { at, totals, stepped } = decided === tau0 && stampSheetHolds(on, first) ? { at: tau0, totals: first, stepped: false } : await verified(steps, name, on, core, decided);
    tau = at;
    if (stampSheetNearRounding(on, totals, stepped)) warnings.push(stampSheetWithinRounding(name, on));
  }
  if (bloom !== null) {
    const { bloom: blooming } = await steps.totalsAt(core, tau, open, bloom);
    if (blooming === 0) throw new StampSheetRefusal(stampSheetWontBloom(name));
  }
  return { tau, warnings };
}

/**
 * The first time from `tau0` the reductions say `input.on` holds over `core` (`first`, its totals at `tau0`).
 * Throws the application's failure, mapped where it held most, where it never does.
 */
async function firstHolding(steps: StampSheetSteps, input: StampSheetDecideInput, core: StampSheetCore, tau0: number, first: StampSheetTotals): Promise<number> {
  const on = input.on!;
  if (stampSheetHolds(on, first)) return tau0;
  if (on === 'dry') return stampSheetGrid(tau0, first.latestSet ?? tau0);
  if (on === 'damp' && first.latestSet !== null) {
    const last = stampDampStep(first.latestSet, tau0), need = STAMP_SHEET_SHARE * first.weight;
    const histogram = await steps.histogramAt(core, tau0, 0, stampDampFirstWidth(last));
    const { step, most } = await stampDampFirstStep(histogram, need, ({ start, width }) => steps.histogramAt(core, tau0, start, width));
    if (step !== null) return tau0 + step * STAMP_SHEET_STEP;
    return unreachable(steps, input, core, { tau: tau0 + most.step * STAMP_SHEET_STEP, held: most.weight, totals: first });
  }
  return unreachable(steps, input, core, { tau: tau0, held: stampSheetHeld(on, first), totals: first });
}

/** Throws `input`'s failure from this prefix: its rule held over `held` at most, at `tau`, mapped there. */
async function unreachable(steps: StampSheetSteps, input: StampSheetDecideInput, core: StampSheetCore, at: { tau: number; held: number; totals: StampSheetTotals }): Promise<never> {
  const boxes = await steps.failureAt(core, at.tau, input.on!);
  throw new StampSheetRefusal(stampSheetUnreachable(input.name, input.on!, at, boxes, input.unscheduled));
}

/**
 * `decided` checked by the field's law, a step later each time it doesn't hold, up to STAMP_SHEET_VERIFY_STEPS:
 * the time it holds, its totals there and whether it stepped. Past that it's an engine fault.
 */
async function verified(steps: StampSheetSteps, name: string, on: StampSheetWetness, core: StampSheetCore, decided: number) {
  const check = async (n: number): Promise<{ at: number; totals: StampSheetTotals; stepped: boolean }> => {
    const at = decided + n * STAMP_SHEET_STEP, totals = await steps.totalsAt(core, at, null, null);
    if (stampSheetHolds(on, totals)) return { at, totals, stepped: n > 0 };
    if (n < STAMP_SHEET_VERIFY_STEPS) return check(n + 1);
    const share = (held: number) => held / Math.max(1, totals.weight);
    throw new Error(stampSheetVerifyFault(name, on, at, on === 'dry' ? 1 : STAMP_SHEET_SHARE, share(stampSheetHeld(on, totals))));
  };
  return check(0);
}
