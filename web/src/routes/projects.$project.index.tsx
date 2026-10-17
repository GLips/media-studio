import { createFileRoute } from '@tanstack/react-router';
import { loadProjectSummary, ProjectPage, ProjectRowsPending } from '#web/features/projects/index.ts';

/** A project's files, decisions and plan: where `◂` from any of them leads. */
export const Route = createFileRoute('/projects/$project/')({
  loader: ({ context, params }) => loadProjectSummary(context.queryClient, params.project),
  component: ProjectRoute,
  pendingComponent: ProjectRowsPending,
});

function ProjectRoute() {
  const { project } = Route.useParams();
  return <ProjectPage project={project} />;
}
