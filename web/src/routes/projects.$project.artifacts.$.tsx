import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ReviewScreen, reviewArtifactQueryOptions } from '#web/features/review/index.ts';

/** The review of one file of a project, by its path there: `/projects/<project>/artifacts/out/video.mp4`. */
export const Route = createFileRoute('/projects/$project/artifacts/$')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(reviewArtifactQueryOptions(params.project, params._splat ?? '')),
  component: ReviewArtifactRoute,
});

function ReviewArtifactRoute() {
  const { project, _splat: path = '' } = Route.useParams();
  const queryClient = useQueryClient();
  const options = reviewArtifactQueryOptions(project, path);
  const { data: artifact } = useSuspenseQuery(options);
  // Keyed by render: loading the replacement starts a fresh review of the new bytes, its notes placed on them.
  return <ReviewScreen key={artifact.render.hash} artifact={artifact} onLoadReplacement={() => void queryClient.refetchQueries({ queryKey: options.queryKey })} />;
}
