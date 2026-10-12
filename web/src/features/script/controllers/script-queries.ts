import { queryOptions } from '@tanstack/react-query';
import { fetchReviewScript } from './review-script.ts';

/**
 * How often the read-along looks at the script again: an agent edits voiceover.json or re-voices while it's open, and
 * the sign-off has to dim the moment the words change. Each look reads three small files and stats the take.
 */
const REVIEW_SCRIPT_POLL_MS = 3000;

export const reviewScriptQueryOptions = (project: string) => queryOptions({
  queryKey: ['review-script', project],
  queryFn: () => fetchReviewScript({ data: { project } }),
  staleTime: 0,
  refetchInterval: REVIEW_SCRIPT_POLL_MS,
});
