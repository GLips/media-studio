// library-loaders.ts: what the library's routes load before they show.
import type { QueryClient } from '@tanstack/react-query';
import { libraryFlagsQueryOptions, libraryItemViewQueryOptions, libraryShelfQueryOptions } from './library-queries.ts';

export const loadLibraryShelf = (client: QueryClient) => client.ensureQueryData(libraryShelfQueryOptions);

/** The item with its transcript, and its flags; the item null when no item has the id. */
export async function loadLibraryItem(client: QueryClient, item: string) {
  const [view] = await Promise.all([client.ensureQueryData(libraryItemViewQueryOptions(item)), client.ensureQueryData(libraryFlagsQueryOptions(item))]);
  return view;
}
