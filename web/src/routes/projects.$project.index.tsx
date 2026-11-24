import { createFileRoute } from '@tanstack/react-router';
import { loadProjectSummaries, loadProjectSummary, ProjectPage, ProjectRowsPending, StudioSidebarLayout } from '#web/features/projects/index.ts';

/** A project's files, decisions and plan, beside the studio sidebar: where `◂` from any of them leads. */
export const Route = createFileRoute('/projects/$project/')({
  // The sidebar's projects load beside the page's own summary, as on the index and the library.
  loader: ({ context, params }) => Promise.all([loadProjectSummary(context.queryClient, params.project), loadProjectSummaries(context.queryClient)]),
  component: ProjectRoute,
  pendingComponent: () => <StudioSidebarLayout><ProjectRowsPending /></StudioSidebarLayout>,
});

function ProjectRoute() {
  const { project } = Route.useParams();
  return <StudioSidebarLayout><ProjectPage project={project} /></StudioSidebarLayout>;
}
