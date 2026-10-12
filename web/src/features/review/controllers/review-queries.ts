import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { fetchReviewArtifact, fetchReviewStatus } from './review-artifact.ts';
import { readReviewThreadsFn } from './review-ops.ts';

/**
 * How often the screen asks after the review's revision and its file on disk. Polled, not pushed: the CLI writes
 * without the server, and a poll survives server restarts and a sleeping tab for the cost of a stat.
 */
const REVIEW_STATUS_POLL_MS = 1000;

/**
 * The review as loaded: the file, or the kept version `render` names (the URL's `r`). Never refetched on its own: a
 * loaded review stays bound to one file's bytes and snapshot until the person loads another version.
 */
export const reviewArtifactQueryOptions = (project: string, path: string, render?: string) => queryOptions({
  queryKey: ['review-artifact', project, path, render ?? null],
  queryFn: () => fetchReviewArtifact({ data: { project, path, ...(render !== undefined && { render }) } }),
  staleTime: Infinity,
  gcTime: 0,
});

export const reviewStatusQuery = (project: string, path: string) => queryOptions({
  queryKey: reviewStatusQueryKey(project, path),
  queryFn: () => fetchReviewStatus({ data: { project, path } }),
  refetchInterval: REVIEW_STATUS_POLL_MS,
  refetchOnWindowFocus: true,
});

export const reviewStatusQueryKey = (project: string, path: string) => ['review-status', project, path] as const;

/** Every revision's threads for one file, which useReviewOps updates optimistically. */
export const reviewThreadsQueryPrefix = (project: string, path: string) => ['review-threads', project, path] as const;

/**
 * The threads as of `revision` (the status poll's), placed on the open file, or on its kept version `render` when the
 * URL pins one. A revision's threads never change, so a new revision is a new key, and the last revision's stay on
 * screen while it loads.
 */
export const reviewThreadsQuery = (project: string, path: string, render: string | undefined, revision: number) => queryOptions({
  queryKey: [...reviewThreadsQueryPrefix(project, path), render ?? null, revision],
  queryFn: () => readReviewThreadsFn({ data: { project, path, ...(render !== undefined && { render }) } }),
  staleTime: Infinity,
  placeholderData: keepPreviousData,
});
