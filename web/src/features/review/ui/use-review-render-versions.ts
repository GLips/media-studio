import { useQuery } from '@tanstack/react-query';
import { projectPulseHashOf } from '#lib/output/review/models/project-pulse.ts';
import { reviewRenderVersionsQueryOptions } from '../controllers/review-queries.ts';
import type { listReviewRenderVersionsFn } from '../controllers/review-render-versions.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { useReviewSplices } from './use-review-threads.ts';

/** One kept version of the open render's path: its `rN`, hash, when it was made and the archived copy's path. */
export type ReviewComparedVersion = Awaited<ReturnType<typeof listReviewRenderVersionsFn>>[number];

/** The file the open one was generated from (footage's blockout), which compare offers beside its versions. */
export type ReviewCompareReference = { reference: true; file: string; hash: string; label: string; asRendered?: never };

/**
 * What `\` compares against: a kept version, the open cut itself without the slices laid into it (`asRendered`), or
 * the file the open one was generated from.
 */
export type ReviewCompareTarget = (ReviewComparedVersion & { asRendered: boolean; reference?: never }) | ReviewCompareReference;

export type ReviewRenderVersions = {
  /** Oldest first. Empty until the history answers, and for a render never archived. */
  versions: readonly ReviewComparedVersion[];
  /** The open render's own entry, when it's been kept. */
  shown: ReviewComparedVersion | undefined;
  /**
   * What `\`, `W` and `Shift+W` compare against: `vs`, else the open cut as rendered while slices are laid into it,
   * else the version before the open one, else the file it was generated from.
   */
  other: ReviewCompareTarget | undefined;
  /** The file the open one was generated from, when it was. */
  reference: ReviewCompareReference | undefined;
};

/** `r14`, `r14 as rendered`, a reference's `blockout`, or the hash's head for a render the history hasn't kept. */
export function reviewVersionLabelOf(version: (ReviewComparedVersion & { asRendered?: boolean }) | ReviewCompareReference | undefined, hash: string): string {
  if (!version) return hash.slice(0, 6);
  if ('reference' in version) return version.label;
  return `r${version.r}${version.asRendered ? ' as rendered' : ''}`;
}

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
  const reference: ReviewCompareReference | undefined = artifact.reference && { reference: true, file: artifact.reference.path, hash: artifact.reference.hash, label: artifact.reference.label };
  const versionShown = (chosen && { ...chosen, asRendered: false }) ?? asRendered;
  const other = search.vs !== undefined && search.vs === reference?.hash ? reference : versionShown ?? fallback ?? reference;
  return { versions, shown, other, reference };
}
