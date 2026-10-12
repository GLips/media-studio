import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { reviewScriptQueryOptions, ScriptScreen, scriptSearchValidator, ScriptUnvoicedScreen } from '#web/features/script/index.ts';

/** A project's script read along with its take: `/projects/<project>/script?line=badge`. */
export const Route = createFileRoute('/projects/$project/script')({
  validateSearch: scriptSearchValidator,
  loader: ({ context, params }) => context.queryClient.ensureQueryData(reviewScriptQueryOptions(params.project)),
  component: ScriptRoute,
});

function ScriptRoute() {
  const { project } = Route.useParams();
  const { data: script } = useSuspenseQuery(reviewScriptQueryOptions(project));
  const take = script.takes[0];
  // Keyed by the take: a new read starts a fresh clock on the new audio; the draft and the line carry over.
  return take
    ? <ScriptScreen key={take.hash} project={project} script={script} take={take} />
    : <ScriptUnvoicedScreen project={project} script={script} />;
}
