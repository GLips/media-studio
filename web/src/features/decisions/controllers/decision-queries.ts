import { queryOptions, useIsMutating, useSuspenseQuery } from '@tanstack/react-query';
import { emptyReviewFile } from '#lib/output/review/models/review-threads.ts';
import { applyReviewOpsAsReviewer, reviewOpsMutationKey, type ReviewOpsTarget } from '#web/features/review/index.ts';
import { fetchReviewDecision, type ReviewDecisionView } from './review-decision.ts';

/** Polled like the review's status: the CLI posts and re-posts without the server, and a poll costs a few stats. */
const DECISION_POLL_MS = 1000;

const reviewDecisionQueryKey = (project: string, topic: string) => ['review-decision', project, topic] as const;

export const reviewDecisionQueryOptions = (project: string, topic: string) => queryOptions({
  queryKey: reviewDecisionQueryKey(project, topic),
  queryFn: () => fetchReviewDecision({ data: { project, topic } }),
  refetchOnWindowFocus: true,
});

/**
 * The topic's decision, polled each second. The poll holds while a verdict or a note is in flight, so it can't paint
 * the old one back over the one shown.
 */
export function useReviewDecisionView(project: string, topic: string) {
  const sending = useIsMutating({ mutationKey: reviewOpsMutationKey(project) }) > 0;
  return useSuspenseQuery({ ...reviewDecisionQueryOptions(project, topic), refetchInterval: sending ? false : DECISION_POLL_MS }).data;
}

/**
 * Where the decisions screen's ops show (verdicts, sign-off, its thread's notes): the polled decision and its threads,
 * changed by the same rules the server applies as soon as they're sent, and fetched again once the server has them.
 */
export function decisionOpsTarget(project: string, topic: string): ReviewOpsTarget {
  const queryKey = reviewDecisionQueryKey(project, topic);
  return {
    project,
    showLocally: (client, ops) => client.setQueryData<ReviewDecisionView>(queryKey, (view) => {
      if (!view?.decision) return view;
      const nextId = Math.max(view.decision.id, ...view.threads.map((t) => t.id)) + 1;
      const applied = applyReviewOpsAsReviewer({ ...emptyReviewFile(), revision: view.revision, nextId, threads: view.threads, decisions: [view.decision] }, ops);
      return applied ? { ...view, revision: applied.revision, threads: applied.threads, decision: applied.decisions[0] } : view;
    }),
    refetch: [queryKey],
  };
}
