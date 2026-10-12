import { useQuery } from '@tanstack/react-query';
import { projectPulseHashOf } from '#lib/output/review/models/project-pulse.ts';
import { reviewRenderVersionsQueryOptions } from '../controllers/review-queries.ts';
import type { listReviewRenderVersionsFn } from '../controllers/review-render-versions.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { useReviewSplices } from './use-review-threads.ts';

/** One kept version of the open render's path: its `rN`, hash, when it was made and the archived copy's path. */
export type ReviewComparedVersion = Awaited<ReturnType<typeof listReviewRenderVersionsFn>>[number];

/** What `\` compares against: a kept version, or the open cut itself without the slices laid into it (`asRendered`). */
export type ReviewCompareTarget = ReviewComparedVersion & { asRendered: boolean };

export type ReviewRenderVersions = {
  /** Oldest first. Empty until the history answers, and for a render never archived. */
  versions: readonly ReviewComparedVersion[];
  /** The open render's own entry, when it's been kept. */
  shown: ReviewComparedVersion | undefined;
  /**
   * What `\`, `W` and `Shift+W` compare against: `vs`, else the open cut as rendered while slices are laid into it,
   * else the version before the open one.
   */
  other: ReviewCompareTarget | undefined;
};

/** `r14`, `r14 as rendered`, or the hash's head for a render the history hasn't kept. */
export const reviewVersionLabelOf = (version: (ReviewComparedVersion & { asRendered?: boolean }) | undefined, hash: string) =>
  (version ? `r${version.r}${version.asRendered ? ' as rendered' : ''}` : hash.slice(0, 6));

/** The open render's kept versions and the one compare is against, fetched again when a new render lands on the path. */
export function useReviewRenderVersions(): ReviewRenderVersions {
  const { project, artifact, pulse, search } = useReviewScreen();
  const newest = projectPulseHashOf(pulse, artifact.path) ?? artifact.render.hash;
  const { data: versions = [] } = useQuery(reviewRenderVersionsQueryOptions(project, artifact.path, newest));
  const at = versions.findIndex((v) => v.hash === artifact.render.hash);
  const shown = at >= 0 ? versions[at] : undefined;
  const before = at >= 0 ? versions[at - 1] : versions.findLast((v) => v.hash !== artifact.render.hash);
  // The cut bare is a target only while something is laid over it; `vs` naming its own hash picks it.
  const { laid } = useReviewSplices();
  const asRendered = shown && laid.length > 0 ? { ...shown, asRendered: true } : undefined;
  const chosen = search.vs === undefined || search.vs === artifact.render.hash ? undefined : versions.find((v) => v.hash === search.vs);
  const fallback = before && { ...before, asRendered: false };
  return { versions, shown, other: (chosen && { ...chosen, asRendered: false }) ?? asRendered ?? fallback };
}
