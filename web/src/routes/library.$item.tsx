import { createFileRoute, notFound } from '@tanstack/react-router';
import { LibraryItemScreen, libraryItemSearchValidator, loadLibraryItem } from '#web/features/library/index.ts';

/** One library item, watched with its transcript and flagged: `/library/<id>?t=72.4&flag=3`. */
export const Route = createFileRoute('/library/$item')({
  validateSearch: libraryItemSearchValidator,
  loader: async ({ context, params }) => {
    if (!await loadLibraryItem(context.queryClient, params.item)) throw notFound();
  },
  component: LibraryItemRoute,
});

function LibraryItemRoute() {
  const { item } = Route.useParams();
  return <LibraryItemScreen key={item} item={item} />;
}
