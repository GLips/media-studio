import { useQuery } from '@tanstack/react-query';
import { reviewThreadsQuery } from '../controllers/review-queries.ts';
import type { readReviewThreadsFn } from '../controllers/review-ops.ts';
import { useReviewScreen } from './review-screen-context.tsx';

/** The project's review placed on the open file: its threads, decisions and sign-offs, as of a revision. */
export type ReviewPlacedThreads = Awaited<ReturnType<typeof readReviewThreadsFn>>;

/**
 * The review as of the status poll's revision, placed on the version shown. Waits for the first poll, so the first
 * fetch is already the newest; a new revision is a new key, the last one's threads staying on screen meanwhile.
 */
export function useReviewThreads(): ReviewPlacedThreads | undefined {
  const { project, artifact, status, search } = useReviewScreen();
  return useQuery({ ...reviewThreadsQuery(project, artifact.path, search.r, status?.revision ?? 0), enabled: status !== undefined }).data;
}
