import { createFileRoute } from '@tanstack/react-router';
import { LibraryShelfPage, libraryShelfSearchValidator, loadLibraryShelf } from '#web/features/library/index.ts';

/** The footage library: every item, newest first, and a search over what's said in them: `/library?q=agent definition`. */
export const Route = createFileRoute('/library/')({
  validateSearch: libraryShelfSearchValidator,
  loader: ({ context }) => loadLibraryShelf(context.queryClient),
  component: LibraryShelfPage,
});
