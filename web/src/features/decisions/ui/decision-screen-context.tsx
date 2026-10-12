import { createContext, useContext, type ReactNode } from 'react';
import type { ReviewCandidate, ReviewDecision } from '#lib/output/review/models/review-threads.ts';
import type { DecodedReviewOp, ReviewOps } from '#web/features/review/index.ts';
import type { DecisionSearch, SetDecisionSearch } from '../controllers/decision-search.ts';
import type { ReviewDecisionView } from '../controllers/review-decision.ts';
import type { DecisionPlayback } from './decision-playback.ts';
import type { DecisionTwoUpPair } from './decision-two-up-pair.ts';

export type DecisionScreenValue = {
  project: string;
  topic: string;
  view: ReviewDecisionView;
  decision: ReviewDecision;
  /** The candidates the survey shows: all, or with `F` only the picks. */
  shown: readonly ReviewCandidate[];
  playback: DecisionPlayback;
  search: DecisionSearch;
  setSearch: SetDecisionSearch;
  /** The candidate heard and judged, by key; null when none is on show (picks only, with no picks yet). */
  focused: string | null;
  pair: DecisionTwoUpPair;
  /** Verdicts, sign-off and the thread's notes, sent as the review's ops. */
  ops: ReviewOps;
  /** Sends a verdict or the sign-off unless the decision would refuse it (reviewDecisionRefusalOf). */
  decide: (ops: DecodedReviewOp[]) => void;
  /** Hears `key` from the time now; on the two-up, swaps it in if it isn't on show. */
  focus: (key: string) => void;
  /** Opens the two-up on `key`, or returns to the survey with null. */
  openTwoUp: (key: string | null) => void;
};

const DecisionScreenContext = createContext<DecisionScreenValue | null>(null);

/** What the decisions screen's parts share: the decision, one clock, the focus and the URL. */
export function DecisionScreenProvider({ value, children }: { readonly value: DecisionScreenValue; readonly children: ReactNode }) {
  return <DecisionScreenContext value={value}>{children}</DecisionScreenContext>;
}

export function useDecisionScreen(): DecisionScreenValue {
  const screen = useContext(DecisionScreenContext);
  if (!screen) throw new Error('useDecisionScreen is for the decisions screen\'s parts, inside its DecisionScreenProvider');
  return screen;
}
