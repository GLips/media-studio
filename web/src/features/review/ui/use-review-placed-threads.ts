import { useQuery } from '@tanstack/react-query';
import type { PlacedReviewThread } from '#lib/output/review/models/review-placement.ts';
import { reviewThreadsQuery } from '../controllers/review-queries.ts';
import { useReviewScreen } from './review-screen-context.tsx';

const NO_REVIEW_THREADS: readonly PlacedReviewThread[] = [];

/**
 * The project's threads placed on the file at `path` (the open one, or a still beside it), as of the revision the
 * open file's status poll last saw. The revision is the project's, so one poll keeps every file's threads current.
 */
export function useReviewPlacedThreads(path: string): readonly PlacedReviewThread[] {
  const { project, artifact, status, search } = useReviewScreen();
  // The open file at the version the URL pins; a still beside it as it is on disk.
  const render = path === artifact.path ? search.r : undefined;
  const { data } = useQuery({ ...reviewThreadsQuery(project, path, render, status?.revision ?? 0), enabled: status !== undefined });
  return data?.threads ?? NO_REVIEW_THREADS;
}
