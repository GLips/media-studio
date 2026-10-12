// decision-two-up-pair.ts: which two candidates the two-up shows. Lightroom's compare: the candidate in focus against
// the one to beat (the pick), with a new challenger swapped in for whichever side isn't the pick.
import type { ReviewCandidate } from '#lib/output/review/models/review-threads.ts';

export type DecisionTwoUpPair = readonly [string, string];

const inCandidateOrder = (candidates: readonly ReviewCandidate[], a: string, b: string): DecisionTwoUpPair => {
  const at = (key: string) => candidates.findIndex((c) => c.key === key);
  return at(a) <= at(b) ? [a, b] : [b, a];
};

/** `two=a,d` when it names two candidates, one in focus; else the focused one against the pick, or its neighbour. */
export function decisionTwoUpPairOf(candidates: readonly ReviewCandidate[], focused: string, two: string | undefined): DecisionTwoUpPair {
  const named = two?.split(',') ?? [];
  const known = (key: string) => candidates.some((c) => c.key === key);
  if (named.length === 2 && named[0] !== named[1] && named.every(known) && named.includes(focused)) return inCandidateOrder(candidates, named[0], named[1]);
  const pick = candidates.find((c) => c.verdict === 'pick' && c.key !== focused);
  const index = candidates.findIndex((c) => c.key === focused);
  const neighbour = candidates[index + 1] ?? candidates[index - 1];
  return inCandidateOrder(candidates, focused, (pick ?? neighbour).key);
}

/**
 * The pair after `key` is brought into focus: kept when it's on show, else `key` replaces the side in focus, unless
 * that side is the pick, which stays to be beaten.
 */
export function decisionTwoUpPairWith(candidates: readonly ReviewCandidate[], pair: DecisionTwoUpPair, focused: string, key: string): DecisionTwoUpPair {
  if (pair.includes(key)) return pair;
  const isPick = (k: string) => candidates.some((c) => c.key === k && c.verdict === 'pick');
  const other = pair.find((k) => k !== focused) ?? pair[1];
  const kept = isPick(focused) && !isPick(other) ? focused : other;
  return inCandidateOrder(candidates, kept, key);
}

/**
 * The candidate an arrow moves focus to. On the survey, the next one shown; on the two-up, the next challenger,
 * skipping the side that stays.
 */
export function decisionCandidateBeside(keys: readonly string[], focused: string, direction: -1 | 1, skip?: string): string | undefined {
  const from = keys.indexOf(focused);
  for (let i = from + direction; i >= 0 && i < keys.length; i += direction) if (keys[i] !== skip) return keys[i];
  return undefined;
}
