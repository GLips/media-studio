// stamp-paint-events.ts: a painting as a sequence of events in the order it's painted, each with the scene time it's
// settled by: every deposit, and each wash's end, where what works over a finished wash runs
// (stamp-wet-stages.ts). A frame at `t` is the painting's first events all settled, then whatever of the rest shows
// at `t`; so a frame may start from a saved state of its settled prefix rather than from bare paper, and is the same
// whichever frame came before it.

import { stampPassDeposits, type CompiledStampDeposit, type CompiledStampGroup, type CompiledStampPaint, type CompiledStampPass } from './stamp-paint-recipe.ts';

/**
 * A deposit, or the end of a wash, and the scene seconds from which it's settled: a deposit wholly shown (-Infinity
 * for one there throughout), a wash's end once its last deposit is.
 */
export type StampPaintEvent = { group: CompiledStampGroup; pass: CompiledStampPass; settledAt: number } & (
  | { kind: 'deposit'; deposit: CompiledStampDeposit }
  | { kind: 'washEnd' }
);

/** `painting`'s events in the order it paints them. */
export function stampPaintEvents(painting: CompiledStampPaint): StampPaintEvent[] {
  return painting.groups.flatMap((group) => group.passes.flatMap((pass): StampPaintEvent[] => {
    const deposits = stampPassDeposits(pass).map((deposit): StampPaintEvent => ({
      kind: 'deposit', group, pass, deposit, settledAt: deposit.reveal ? deposit.reveal.at + deposit.reveal.over : -Infinity,
    }));
    if (pass.kind !== 'wash') return deposits;
    return [...deposits, { kind: 'washEnd', group, pass, settledAt: Math.max(-Infinity, ...deposits.map((event) => event.settledAt)) }];
  }));
}

/** How many of `events`, from the first, are all settled at `t`: the prefix a saved state at `t` may stand for. */
export function stampSettledEventCount(events: readonly StampPaintEvent[], t: number): number {
  const unsettled = events.findIndex((event) => event.settledAt > t);
  return unsettled < 0 ? events.length : unsettled;
}
