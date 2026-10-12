import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect, useEffectEvent } from 'react';
import { projectPulseQueryOptions, useProjectPulse } from '#web/features/projects/index.ts';
import {
  ReviewScreen, reviewArtifactQueryOptions, reviewReplacementHashOf, reviewSearchValidator, reviewStillsFolderOpening, useReviewDraft,
} from '#web/features/review/index.ts';

/**
 * The review of one file of a project, by its path there: `/projects/<project>/artifacts/out/video.mp4?f=120`, or a
 * kept version of it with `&r=<hash>`. A folder of stills (`…/artifacts/out/stills`) opens its grid on its first still,
 * or the one `still` names.
 */
export const Route = createFileRoute('/projects/$project/artifacts/$')({
  validateSearch: reviewSearchValidator,
  loaderDeps: ({ search }) => ({ r: search.r, still: search.still }),
  loader: async ({ context, params, deps }) => {
    const path = params._splat ?? '';
    const pulse = context.queryClient.ensureQueryData(projectPulseQueryOptions(params.project));
    try {
      const [artifact] = await Promise.all([context.queryClient.ensureQueryData(reviewArtifactQueryOptions(params.project, path, deps.r)), pulse]);
      return artifact;
    } catch (error) {
      // Only a path that isn't a file is looked up as a folder, so opening a file never waits on the project's listing.
      const still = reviewStillsFolderOpening((await pulse).files, path, deps.still);
      if (still === undefined) throw error;
      throw redirect({ to: '/projects/$project/artifacts/$', params: { project: params.project, _splat: still }, search: { view: 'grid' }, replace: true });
    }
  },
  component: ReviewArtifactRoute,
});

function ReviewArtifactRoute() {
  const { project, _splat: path = '' } = Route.useParams();
  // Keyed by file: its draft is the file's, and another file starts on its own.
  return <ReviewArtifactPage key={path} project={project} path={path} />;
}

/**
 * The file's review, loading a newer render at its path by itself unless a draft is open (the header then offers it).
 * Keyed by render: a new render starts a fresh screen on the new bytes; the draft and `f` carry over.
 */
function ReviewArtifactPage({ project, path }: { readonly project: string; readonly path: string }) {
  const r = Route.useSearch({ select: (search) => search.r });
  const queryClient = useQueryClient();
  const options = reviewArtifactQueryOptions(project, path, r);
  const { data: artifact } = useSuspenseQuery(options);
  const draft = useReviewDraft(`${project}/${path}`);
  const replacement = reviewReplacementHashOf(useProjectPulse(project), artifact, r);
  const loadReplacement = () => void queryClient.refetchQueries({ queryKey: options.queryKey });
  const loadReplacementNow = useEffectEvent(loadReplacement);
  useEffect(() => {
    if (replacement !== undefined && !draft.isOpen) loadReplacementNow();
  }, [replacement, draft.isOpen]);
  return <ReviewScreen key={artifact.render.hash} artifact={artifact} draft={draft} onLoadReplacement={loadReplacement} />;
}
