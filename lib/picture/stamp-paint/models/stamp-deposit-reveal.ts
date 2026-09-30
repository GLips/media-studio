// stamp-deposit-reveal.ts: how much of a compiled deposit shows at scene time `t`. Every stamp is placed once; a
// frame only chooses how many of each deposit's show, and how far a flood's front has crossed it.

import type { CompiledStampDeposit } from './stamp-paint-recipe.ts';

/**
 * How many of `deposit`'s stamps (or its dual stamps) show at `t` seconds: none before `appliedAt`, then a growing
 * prefix of them. A flood's all show from `appliedAt`: its front reveals it (stampFloodProgressAt).
 */
export function visibleStampCountAt(deposit: CompiledStampDeposit, t: number, which: 'stamps' | 'dualStamps' = 'stamps'): number {
  const stamps = deposit[which];
  const { reveal } = deposit;
  if (!reveal) return stamps.length;
  if (t < reveal.at) return 0;
  if (deposit.kind === 'flood') return stamps.length;
  const progress = revealProgress(reveal, t);
  // Stamps come in reveal order, so the count is where `progress` would sort among them.
  let low = 0, high = stamps.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (stamps[middle].reveal <= progress) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** How far a flood's front has crossed it at `t` seconds, 0..1 (STAMP_FLOOD_FRONT_SHARE_WGSL): 0 before `appliedAt`. */
export function stampFloodProgressAt(deposit: CompiledStampDeposit & { kind: 'flood' }, t: number): number {
  const { reveal } = deposit;
  if (!reveal) return 1;
  return t < reveal.at ? 0 : revealProgress(reveal, t);
}

/** Whether any of `deposit` shows at `t`: a flood once its front has started across it, though its edge stroke may have no stamps; else once a stamp shows. */
export const stampDepositShowsAt = (deposit: CompiledStampDeposit, t: number) => (deposit.kind === 'flood' ? stampFloodProgressAt(deposit, t) > 0 : visibleStampCountAt(deposit, t) > 0);

const revealProgress = ({ at, over }: { at: number; over: number }, t: number) => (over ? Math.min(1, (t - at) / over) : 1);
