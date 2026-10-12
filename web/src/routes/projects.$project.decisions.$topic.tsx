import { createFileRoute, notFound } from '@tanstack/react-router';
import { DecisionScreen, decisionSearchValidator, reviewDecisionQueryOptions } from '#web/features/decisions/index.ts';

/** A decision an agent posted, by its topic: `/projects/<project>/decisions/music-bed?c=b&view=two`. */
export const Route = createFileRoute('/projects/$project/decisions/$topic')({
  validateSearch: decisionSearchValidator,
  loader: async ({ context, params }) => {
    const view = await context.queryClient.ensureQueryData(reviewDecisionQueryOptions(params.project, params.topic));
    if (!view.decision) throw notFound();
  },
  component: DecisionRoute,
});

function DecisionRoute() {
  const { project, topic } = Route.useParams();
  // Keyed by topic: another decision starts on a fresh clock and focus.
  return <DecisionScreen key={`${project}/${topic}`} project={project} topic={topic} />;
}
