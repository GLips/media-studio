import { createFileRoute, redirect } from '@tanstack/react-router';
import { fetchFrozenReviewOrigin, projectPulseQueryOptions } from '#web/features/projects/index.ts';
import { PlanScreen, planSearchValidator } from '#web/features/plan/index.ts';

/** A project's plan, its storyboard.ts timed and reviewed before anything renders: `/projects/<project>/plan?scene=label`. */
export const Route = createFileRoute('/projects/$project/plan')({
  validateSearch: planSearchValidator,
  beforeLoad: async ({ params, location, preload }) => {
    if (preload) return;
    const origin = await fetchFrozenReviewOrigin({ data: { project: params.project } });
    if (origin) throw redirect({ href: origin + location.href, reloadDocument: true });
  },
  loader: ({ context, params }) => context.queryClient.ensureQueryData(projectPulseQueryOptions(params.project)),
  component: PlanRoute,
});

function PlanRoute() {
  const { project } = Route.useParams();
  // Keyed by project: another project's plan starts on a fresh clock, draft and focus.
  return <PlanScreen key={project} project={project} />;
}
