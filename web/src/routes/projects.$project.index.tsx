import { createFileRoute } from '@tanstack/react-router';
import { ProjectPage, ProjectRowsPending, projectSummaryQueryOptions } from '#web/features/projects/index.ts';

/** A project's files, decisions and script: where `◂` from any of them leads. */
export const Route = createFileRoute('/projects/$project/')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(projectSummaryQueryOptions(params.project)),
  component: ProjectRoute,
  pendingComponent: ProjectRowsPending,
});

function ProjectRoute() {
  const { project } = Route.useParams();
  return <ProjectPage project={project} />;
}
