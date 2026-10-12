import { createFileRoute } from '@tanstack/react-router';
import { ProjectRowsPending, ProjectsDashboardPage, projectSummariesQueryOptions } from '#web/features/projects/index.ts';

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(projectSummariesQueryOptions),
  component: ProjectsDashboardPage,
  pendingComponent: ProjectRowsPending,
});
