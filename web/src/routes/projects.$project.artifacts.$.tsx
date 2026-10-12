import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { projectSummaryQueryOptions } from '#web/features/projects/index.ts';
import { ReviewScreen, reviewSearchValidator, reviewArtifactQueryOptions, reviewStillsFolderOpening } from '#web/features/review/index.ts';

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
    try {
      return await context.queryClient.ensureQueryData(reviewArtifactQueryOptions(params.project, path, deps.r));
    } catch (error) {
      // Only a path that isn't a file is looked up as a folder, so opening a file never waits on the project's listing.
      const { rows } = await context.queryClient.ensureQueryData(projectSummaryQueryOptions(params.project));
      const still = reviewStillsFolderOpening(rows.flatMap((row) => (row.on === 'file' ? [row.artifact] : [])), path, deps.still);
      if (still === undefined) throw error;
      throw redirect({ to: '/projects/$project/artifacts/$', params: { project: params.project, _splat: still }, search: { view: 'grid' }, replace: true });
    }
  },
  component: ReviewArtifactRoute,
});

function ReviewArtifactRoute() {
  const { project, _splat: path = '' } = Route.useParams();
  const r = Route.useSearch({ select: (search) => search.r });
  const queryClient = useQueryClient();
  const options = reviewArtifactQueryOptions(project, path, r);
  const { data: artifact } = useSuspenseQuery(options);
  // Keyed by file and render: a new render starts a fresh screen on the new bytes; the draft and `f` carry over.
  return (
    <ReviewScreen key={`${artifact.path}@${artifact.render.hash}`} artifact={artifact}
      onLoadReplacement={() => void queryClient.refetchQueries({ queryKey: options.queryKey })} />
  );
}
