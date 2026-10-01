// stamp-paint-events.ts: a painting as its deposits in the order it's painted, each with the scene time it's settled
// by; the wet stages after a deposit (stamp-wet-stages.ts), a wash's drying included, are part of its event. A frame
// at `t` is the painting's first events all settled, then whatever of the rest shows at `t`; so a frame may start
// from a saved state of its settled prefix rather than from bare paper, and is the same whichever frame came before.

import { stampPassDeposits, type CompiledStampDeposit, type CompiledStampGroup, type CompiledStampPaint, type CompiledStampPass } from './stamp-paint-recipe-compile.ts';

/** A deposit and the scene seconds from which it's settled: wholly shown, -Infinity for one there throughout. */
export type StampPaintEvent = { group: CompiledStampGroup; pass: CompiledStampPass; deposit: CompiledStampDeposit; settledAt: number };

/** `painting`'s events in the order it paints them. */
export function stampPaintEvents(painting: CompiledStampPaint): StampPaintEvent[] {
  return painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass).map((deposit): StampPaintEvent => ({
    group, pass, deposit, settledAt: deposit.reveal ? deposit.reveal.at + deposit.reveal.over : -Infinity,
  }))));
}

/** How many of `events`, from the first, are all settled at `t`: the prefix a saved state at `t` may stand for. */
export function stampSettledEventCount(events: readonly StampPaintEvent[], t: number): number {
  const unsettled = events.findIndex((event) => event.settledAt > t);
  return unsettled < 0 ? events.length : unsettled;
}
