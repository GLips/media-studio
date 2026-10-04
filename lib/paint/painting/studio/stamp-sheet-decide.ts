// stamp-sheet-decide.ts: when one application lands (ENGINE 3.5), read off the wet field over its core: at τ0 for
// `wet`, failing there (wetness only falls); at the first 1 ms step a damp histogram finds for `damp`; once the core's
// latest texel sets for `dry`; then checked by the field's own law, a millisecond at a time while f32 rounding keeps
// it from holding. A bloom must find open paint on workable paper under its core. The CPU decides in f64.
//
// At a fixed `at`, and under `instant` or `never`, `damp` and `dry` are judged at τ0 alone, but `dry` under
// `instant`: τ0 is the GPU's f32 set time, which rounding may leave a texel workable at.

import { stampDampFirstStep, stampDampFirstWidth, stampDampStep } from '../models/stamp-damp-histogram.ts';
import {
  STAMP_SHEET_SHARE, STAMP_SHEET_STEP, STAMP_SHEET_VERIFY_STEPS, stampSheetAtFails, stampSheetEmptyCore, stampSheetGrid, stampSheetHeld, stampSheetHolds,
  stampSheetNearRounding, stampSheetUnreachable, stampSheetVerifyFault, stampSheetWetUnreachable, stampSheetWithinRounding, stampSheetWontBloom,
  type StampSheetLift, type StampSheetRegime, type StampSheetShortfall, type StampSheetTotals,
} from '../models/stamp-sheet-schedule.ts';
import type { StampSheetWetness } from '../models/stamp-sheet-program.ts';
import { StampSheetRefusal } from '../models/stamp-sheet-refusal.ts';
import type { StampSheetCore } from './stamp-sheet-reductions.ts';
import type { StampSheetPrepare, StampSheetSteps } from './stamp-sheet-steps.ts';

/**
 * An application as its decision reads it: its name, rule, bloom water (null for none), core (null off the stage),
 * the work laying its touch and marking open paint; for a failure's message, the names after it and the lifts since
 * its sheet's last drying (read if a `wet` fails); how its paper dries; its fixed `at` (null for none).
 */
export type StampSheetDecideInput = {
  name: string; on: StampSheetWetness | null; bloom: number | null; core: StampSheetCore | null; touch: StampSheetPrepare; open: StampSheetPrepare;
  unscheduled: readonly string[]; lifts: () => readonly StampSheetLift[]; regime: StampSheetRegime; fixed: number | null;
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
  if (on === 'wet') {
    if (!stampSheetHolds('wet', first)) return wetUnreachable(steps, input, core, { tau: tau0, held: stampSheetHeld('wet', first), totals: first });
    if (stampSheetNearRounding('wet', first, false)) warnings.push(stampSheetWithinRounding(name, 'wet'));
  } else if (on) {
    if (input.fixed !== null && !stampSheetHolds(on, first)) throw new StampSheetRefusal(stampSheetAtFails(name, input.fixed, on, stampSheetHeld(on, first) / first.weight));
    const decided = await firstHolding(steps, input, on, core, tau0, first);
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
 * The first time from `tau0` the reductions say `on` (`damp` or `dry`) holds over `core` (`first`, its totals at
 * `tau0`). Throws the application's failure, mapped where it held most, where it never does.
 */
async function firstHolding(steps: StampSheetSteps, input: StampSheetDecideInput, on: Exclude<StampSheetWetness, 'wet'>, core: StampSheetCore, tau0: number, first: StampSheetTotals): Promise<number> {
  if (stampSheetHolds(on, first)) return tau0;
  if (input.regime === 'never' || (input.regime === 'instant' && on !== 'dry')) return unreachable(steps, input, on, core, { tau: tau0, held: stampSheetHeld(on, first), totals: first });
  if (on === 'dry') return stampSheetGrid(tau0, first.latestSet ?? tau0);
  if (first.latestSet !== null) {
    const last = stampDampStep(first.latestSet, tau0), need = STAMP_SHEET_SHARE * first.weight;
    const histogram = await steps.histogramAt(core, tau0, 0, stampDampFirstWidth(last));
    const { step, most } = await stampDampFirstStep(histogram, need, ({ start, width }) => steps.histogramAt(core, tau0, start, width));
    if (step !== null) return tau0 + step * STAMP_SHEET_STEP;
    return unreachable(steps, input, on, core, { tau: tau0 + most.step * STAMP_SHEET_STEP, held: most.weight, totals: first });
  }
  return unreachable(steps, input, on, core, { tau: tau0, held: stampSheetHeld(on, first), totals: first });
}

/** Throws `input`'s failure from this prefix: its rule `on` held over `held` at most, at `tau`, mapped there. */
async function unreachable(steps: StampSheetSteps, input: StampSheetDecideInput, on: Exclude<StampSheetWetness, 'wet'>, core: StampSheetCore, at: StampSheetShortfall): Promise<never> {
  const boxes = await steps.failureAt(core, at.tau, on);
  throw new StampSheetRefusal(stampSheetUnreachable(input.name, on, at, boxes, input.unscheduled, input.regime));
}

/** Throws `input`'s failure where its `wet` falls short as it lands, at τ0 (`at.tau`): mapped there, the lifts it crosses named. */
async function wetUnreachable(steps: StampSheetSteps, input: StampSheetDecideInput, core: StampSheetCore, at: StampSheetShortfall): Promise<never> {
  const boxes = await steps.failureAt(core, at.tau, 'wet');
  throw new StampSheetRefusal(stampSheetWetUnreachable(input.name, at, boxes, input.lifts(), input.unscheduled, input.regime, input.fixed !== null));
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
