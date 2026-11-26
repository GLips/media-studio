import { createFileRoute } from '@tanstack/react-router';
import { loadProjectSummaries, loadProjectSummary, ProjectLatestPage, ProjectRowsPending, StudioSidebarLayout } from '#web/features/projects/index.ts';

/** A project's latest: every media file it holds, newest first, what's new since the reviewer last looked marked. */
export const Route = createFileRoute('/projects/$project/latest')({
  loader: ({ context, params }) => Promise.all([loadProjectSummary(context.queryClient, params.project), loadProjectSummaries(context.queryClient)]),
  component: ProjectLatestRoute,
  pendingComponent: () => <StudioSidebarLayout><ProjectRowsPending /></StudioSidebarLayout>,
});

function ProjectLatestRoute() {
  const { project } = Route.useParams();
  // Keyed by project: another project's latest takes its own look.
  return <StudioSidebarLayout><ProjectLatestPage key={project} project={project} /></StudioSidebarLayout>;
}
