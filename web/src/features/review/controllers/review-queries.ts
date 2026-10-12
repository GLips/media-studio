// review-queries.ts: the review's queries, each fetched once per key and keyed on its part of the project pulse
// (features/projects), never polled itself.
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { projectPulseHashOf, type ProjectPulseFacts } from '#lib/output/review/models/project-pulse.ts';
import type { ReviewArtifact } from '#lib/output/review/models/review-artifact.ts';
import { fetchReviewArtifact, fetchReviewSplices } from './review-artifact.ts';
import { readReviewFileFn } from './review-ops.ts';
import { listReviewRenderVersionsFn } from './review-render-versions.ts';

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

/** Every revision's copy of the project's review file, which useReviewOps updates optimistically. */
export const reviewFileQueryPrefix = (project: string) => ['review-file', project] as const;

/**
 * The project's review file as of the pulse's `revision`. A new revision is a new key, the last one's file staying on
 * screen while it loads.
 */
export const reviewFileQueryOptions = (project: string, revision: number) => queryOptions({
  queryKey: [...reviewFileQueryPrefix(project), revision],
  queryFn: () => readReviewFileFn({ data: { project } }),
  staleTime: Infinity,
  placeholderData: keepPreviousData,
});

/**
 * The reply slices for the cut `cut` as of `revision`: a reply naming a slice moves the revision, and a new cut is a
 * new hash, which retires every slice before it.
 */
export const reviewSplicesQueryOptions = (project: string, cut: { path: string; hash: string }, revision: number) => queryOptions({
  queryKey: ['review-splices', project, cut.path, cut.hash, revision],
  queryFn: () => fetchReviewSplices({ data: { project, ...cut } }),
  staleTime: Infinity,
  placeholderData: keepPreviousData,
});

/** Every kept version of `path`, oldest first, as of `newest` (the pulse's hash for it): a new render grows the list. */
export const reviewRenderVersionsQueryOptions = (project: string, path: string, newest: string) => queryOptions({
  queryKey: ['review-render-versions', project, path, newest],
  queryFn: () => listReviewRenderVersionsFn({ data: { project, path } }),
  staleTime: Infinity,
  retry: false,
});

/**
 * The hash of a newer render at the open file's path, waiting to load; undefined when the file is still what's shown,
 * or when the URL pins a version (`r`), which is meant to be older. Undefined too while a render is writing the path:
 * its bytes may be half copied, and its snapshot not yet beside them.
 */
export function reviewReplacementHashOf(
  pulse: Pick<ProjectPulseFacts, 'files'> & { rendering?: { paths: readonly string[] } }, artifact: Pick<ReviewArtifact, 'path' | 'render'>, pinned: string | undefined,
): string | undefined {
  const now = projectPulseHashOf(pulse, artifact.path);
  if (pulse.rendering?.paths.includes(artifact.path)) return undefined;
  return pinned === undefined && now !== undefined && now !== artifact.render.hash ? now : undefined;
}
