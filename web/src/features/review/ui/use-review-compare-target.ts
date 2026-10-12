import { useQuery } from '@tanstack/react-query';
import { listReviewRenderVersionsFn } from '../controllers/review-render-versions.ts';
import { useReviewScreen } from './review-screen-context.tsx';

/** One kept version of the open render's path: its `rN`, hash, when it was made and the archived copy's path. */
export type ReviewComparedVersion = Awaited<ReturnType<typeof listReviewRenderVersionsFn>>[number];

export type ReviewCompareTarget = {
  /** Oldest first. Empty until the history answers, and for a render never archived. */
  versions: readonly ReviewComparedVersion[];
  /** The open render's own entry, when it's been kept. */
  shown: ReviewComparedVersion | undefined;
  /** What `\`, `W` and `Shift+W` compare against: `vs`, else the version before the open one. */
  other: ReviewComparedVersion | undefined;
};

/** `r14`, or the hash's head for a render the history hasn't kept. */
export const reviewVersionLabelOf = (version: ReviewComparedVersion | undefined, hash: string) => (version ? `r${version.r}` : hash.slice(0, 6));

/**
 * The open render's history and the version compare is against. Refetched when a new render lands on the path, as
 * that's when the list grows.
 */
export function useReviewCompareTarget(): ReviewCompareTarget {
  const { project, artifact, status, search } = useReviewScreen();
  const newest = status?.render.hash ?? artifact.render.hash;
  const { data: versions = [] } = useQuery({
    queryKey: ['review-render-versions', project, artifact.path, newest],
    queryFn: () => listReviewRenderVersionsFn({ data: { project, path: artifact.path } }),
    staleTime: Infinity,
    retry: false,
  });
  const at = versions.findIndex((v) => v.hash === artifact.render.hash);
  const shown = at >= 0 ? versions[at] : undefined;
  const before = at >= 0 ? versions[at - 1] : versions.findLast((v) => v.hash !== artifact.render.hash);
  const chosen = search.vs === undefined ? undefined : versions.find((v) => v.hash === search.vs && v.hash !== artifact.render.hash);
  return { versions, shown, other: chosen ?? before };
}
