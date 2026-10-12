import { queryOptions } from '@tanstack/react-query';
import { fetchReviewProjectSummaries, fetchReviewProjectSummary } from './project-summaries.ts';

/**
 * How often the dashboard and a project's page look again: an agent's reply or a render lands while they're open. Each
 * look costs a stat per file once every video has been hashed.
 */
const PROJECT_SUMMARY_POLL_MS = 5000;

export const projectSummariesQueryOptions = queryOptions({
  queryKey: ['review-project-summaries'],
  queryFn: () => fetchReviewProjectSummaries(),
  staleTime: 0,
  refetchInterval: PROJECT_SUMMARY_POLL_MS,
});

export const projectSummaryQueryOptions = (project: string) => queryOptions({
  queryKey: ['review-project-summary', project],
  queryFn: () => fetchReviewProjectSummary({ data: { project } }),
  staleTime: 0,
  refetchInterval: PROJECT_SUMMARY_POLL_MS,
});
