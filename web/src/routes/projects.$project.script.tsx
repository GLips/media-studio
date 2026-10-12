import { createFileRoute } from '@tanstack/react-router';
import { loadReviewScript, ScriptScreen, scriptSearchValidator, ScriptUnvoicedScreen, useReviewScript } from '#web/features/script/index.ts';

/** A project's script read along with its take: `/projects/<project>/script?line=badge`. */
export const Route = createFileRoute('/projects/$project/script')({
  validateSearch: scriptSearchValidator,
  loader: ({ context, params }) => loadReviewScript(context.queryClient, params.project),
  component: ScriptRoute,
});

function ScriptRoute() {
  const { project } = Route.useParams();
  const script = useReviewScript(project);
  const take = script.takes[0];
  // Keyed by the take: a new read starts a fresh clock on the new audio; the draft and the line carry over.
  return take
    ? <ScriptScreen key={take.hash} project={project} script={script} take={take} />
    : <ScriptUnvoicedScreen project={project} script={script} />;
}
