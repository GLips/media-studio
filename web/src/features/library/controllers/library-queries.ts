// library-queries.ts: the library's queries. Polled, as the project pulse is: an agent flags and adds footage through
// the CLI, which writes without the app's server. The shelf and an item's flags are polled; an item's metadata and
// transcript change only when it's finished or corrected, so they're read once per visit.
import { keepPreviousData, queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Result } from 'effect';
import { applyLibraryFlagOp, type LibraryFlagsFile } from '#lib/footage/library/models/library-flags.ts';
import { changeLibraryFlagsFn, fetchLibraryFlags, fetchLibraryItemView, fetchLibraryShelf, searchLibraryFn, type LibraryFlagOpInput } from './library-reads.ts';

const LIBRARY_SHELF_POLL_MS = 3000;
const LIBRARY_FLAGS_POLL_MS = 1000;

export const libraryShelfQueryOptions = queryOptions({
  queryKey: ['library-shelf'],
  queryFn: () => fetchLibraryShelf(),
  refetchInterval: LIBRARY_SHELF_POLL_MS,
  refetchOnWindowFocus: true,
});

/** Hits for a query of at least one word; the last query's stay on show while the next one's load. */
export const librarySearchQueryOptions = (query: string) => queryOptions({
  queryKey: ['library-search', query],
  queryFn: () => searchLibraryFn({ data: { query } }),
  enabled: /[\p{L}\p{N}]/u.test(query),
  staleTime: 10_000,
  placeholderData: keepPreviousData,
});

export const libraryItemViewQueryOptions = (item: string) => queryOptions({
  queryKey: ['library-item', item],
  queryFn: () => fetchLibraryItemView({ data: { item } }),
  staleTime: Infinity,
});

const libraryFlagsQueryKey = (item: string) => ['library-flags', item] as const;

export const libraryFlagsQueryOptions = (item: string) => queryOptions({
  queryKey: libraryFlagsQueryKey(item),
  queryFn: () => fetchLibraryFlags({ data: { item } }),
  refetchInterval: LIBRARY_FLAGS_POLL_MS,
  refetchOnWindowFocus: true,
});

/** The item's flags, as the route's loader fetched them and the poll keeps them. */
export function useLibraryFlags(item: string): LibraryFlagsFile {
  return useSuspenseQuery(libraryFlagsQueryOptions(item)).data;
}

/**
 * Sends the reviewer's changes to an item's flags, shown at once by the same pure rule the server applies; the
 * server's file replaces the guess when it answers. A refused change throws its reason, which `error` holds.
 */
export function useLibraryFlagOps(item: string, durationSeconds: number) {
  const client = useQueryClient();
  const queryKey = libraryFlagsQueryKey(item);
  const send = useMutation({
    mutationKey: ['library-flag-ops', item],
    // In order: a note on a flag added a moment before has to find it there.
    scope: { id: `library-flag-ops:${item}` },
    mutationFn: (op: LibraryFlagOpInput) => changeLibraryFlagsFn({ data: { item, op } }),
    onMutate: async (op) => {
      await client.cancelQueries({ queryKey });
      client.setQueryData<LibraryFlagsFile>(queryKey, (file) => {
        if (!file) return file;
        const applied = applyLibraryFlagOp(file, op, { by: 'reviewer', now: new Date().toISOString(), durationSeconds });
        return Result.isSuccess(applied) ? applied.success.file : file;
      });
    },
    onSuccess: (file) => client.setQueryData(queryKey, file),
    onSettled: () => client.invalidateQueries({ queryKey }),
  });
  return { apply: (op: LibraryFlagOpInput) => send.mutate(op), error: send.error, reset: send.reset };
}
