import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { librarySearchQueryOptions } from '../controllers/library-queries.ts';
import { useLibraryShelfSearch } from '../controllers/library-search.ts';

/**
 * The shelf's search: the field's own text, so typing never waits on the debounced `?q=` it writes, and the hits
 * for it. `searching` once it holds a word.
 */
export function useLibraryShelfQuery() {
  const [search, setSearch] = useLibraryShelfSearch();
  const [query, setQuery] = useState(search.q ?? '');
  const hits = useQuery(librarySearchQueryOptions(query.trim()));
  const change = (text: string) => {
    setQuery(text);
    setSearch({ q: text || undefined });
  };
  return { query, change, hits, searching: hits.isEnabled };
}
