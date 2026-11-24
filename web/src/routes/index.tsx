import { createFileRoute } from '@tanstack/react-router';
import { loadProjectSummaries, ProjectRowsPending, ProjectsDashboardPage, StudioSidebarLayout } from '#web/features/projects/index.ts';

export const Route = createFileRoute('/')({
  loader: ({ context }) => loadProjectSummaries(context.queryClient),
  component: () => <StudioSidebarLayout><ProjectsDashboardPage /></StudioSidebarLayout>,
  pendingComponent: () => <StudioSidebarLayout><ProjectRowsPending /></StudioSidebarLayout>,
});
