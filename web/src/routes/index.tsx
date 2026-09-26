import { createFileRoute } from '@tanstack/react-router';
import { ProjectsPage, projectListingsQueryOptions } from '#web/features/projects/index.ts';

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(projectListingsQueryOptions),
  component: ProjectsPage,
});
