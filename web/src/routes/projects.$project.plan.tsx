import { createFileRoute } from '@tanstack/react-router';
import { projectPulseQueryOptions } from '#web/features/projects/index.ts';
import { PlanScreen, planSearchValidator } from '#web/features/plan/index.ts';

/** A project's plan, its storyboard.ts timed and reviewed before anything renders: `/projects/<project>/plan?scene=label`. */
export const Route = createFileRoute('/projects/$project/plan')({
  validateSearch: planSearchValidator,
  loader: ({ context, params }) => context.queryClient.ensureQueryData(projectPulseQueryOptions(params.project)),
  component: PlanRoute,
});

function PlanRoute() {
  const { project } = Route.useParams();
  // Keyed by project: another project's plan starts on a fresh clock, draft and focus.
  return <PlanScreen key={project} project={project} />;
}
