import { createFileRoute } from '@tanstack/react-router';
import { LibraryShelfPage, libraryShelfSearchValidator, loadLibraryShelf } from '#web/features/library/index.ts';
import { loadProjectSummaries, StudioSidebarLayout } from '#web/features/projects/index.ts';
import { RoutePendingPage } from '#web/shared/ui/route-pending-page.tsx';

/** The footage library: every item, newest first, and a search over what's said in them: `/library?q=agent definition`. */
export const Route = createFileRoute('/library/')({
  validateSearch: libraryShelfSearchValidator,
  // The sidebar's projects load beside the shelf, so they arrive with it rather than after.
  loader: ({ context }) => Promise.all([loadLibraryShelf(context.queryClient), loadProjectSummaries(context.queryClient)]),
  component: () => <StudioSidebarLayout><LibraryShelfPage /></StudioSidebarLayout>,
  pendingComponent: () => <StudioSidebarLayout><RoutePendingPage /></StudioSidebarLayout>,
});
