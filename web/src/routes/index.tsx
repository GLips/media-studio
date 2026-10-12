import { createFileRoute } from '@tanstack/react-router';
import { loadProjectSummaries, ProjectRowsPending, ProjectsDashboardPage } from '#web/features/projects/index.ts';

export const Route = createFileRoute('/')({
  loader: ({ context }) => loadProjectSummaries(context.queryClient),
  component: ProjectsDashboardPage,
  pendingComponent: ProjectRowsPending,
});
