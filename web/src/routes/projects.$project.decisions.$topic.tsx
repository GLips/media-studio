import { createFileRoute, notFound } from '@tanstack/react-router';
import { DecisionScreen, decisionSearchValidator, loadReviewDecision } from '#web/features/decisions/index.ts';

/** A decision an agent posted, by its topic, in the project's queue: `/projects/<project>/decisions/music-bed?c=b&view=two`. */
export const Route = createFileRoute('/projects/$project/decisions/$topic')({
  validateSearch: decisionSearchValidator,
  loader: async ({ context, params }) => {
    if (!await loadReviewDecision(context.queryClient, params.project, params.topic)) throw notFound();
  },
  component: DecisionRoute,
});

function DecisionRoute() {
  const { project, topic } = Route.useParams();
  // Keyed by project, not topic: the screen's pass carries on from one decision to the next.
  return <DecisionScreen key={project} project={project} topic={topic} />;
}
