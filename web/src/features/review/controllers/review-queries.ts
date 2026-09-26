import { queryOptions } from '@tanstack/react-query';
import { fetchReviewArtifact, fetchReviewArtifactStatus } from './review-artifact.ts';

/** How often the screen asks whether its file is still the one on disk. */
const REVIEW_STATUS_POLL_MS = 2000;

/**
 * The review as loaded. Never refetched on its own: a loaded review stays bound to one file's bytes and snapshot until
 * the person loads another version.
 */
export const reviewArtifactQueryOptions = (project: string, path: string) => queryOptions({
  queryKey: ['review-artifact', project, path],
  queryFn: () => fetchReviewArtifact({ data: { project, path } }),
  staleTime: Infinity,
  gcTime: 0,
});

export const reviewArtifactStatusQueryOptions = (project: string, path: string) => queryOptions({
  queryKey: ['review-artifact-status', project, path],
  queryFn: () => fetchReviewArtifactStatus({ data: { project, path } }),
  refetchInterval: REVIEW_STATUS_POLL_MS,
  refetchOnWindowFocus: true,
});
