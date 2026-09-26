import { createFileRoute, Outlet } from '@tanstack/react-router';
import { LabPage, labCatalogQueryOptions } from '#web/features/lab/index.ts';

export const Route = createFileRoute('/lab')({
  loader: ({ context }) => context.queryClient.ensureQueryData(labCatalogQueryOptions),
  component: LabLayoutRoute,
});

function LabLayoutRoute() {
  return <LabPage><Outlet /></LabPage>;
}
