// library-search.ts: the library pages' URLs. The shelf's `/library?q=agent definition` keeps a search on reload and
// Back; an item's `/library/<id>?t=72.4&flag=3&hear=system` opens at a moment, or on a flag, heard through a track.
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { optionalSearchParam, useRouteSearchWriter, type RouteSearchWriting } from '#web/shared/route-search.ts';

export const LibraryShelfSearch = Schema.Struct({
  /** Words said in an item, or in a flag's note. */
  q: optionalSearchParam(Schema.String),
});
export type LibraryShelfSearch = typeof LibraryShelfSearch.Type;
export const libraryShelfSearchValidator = Schema.toStandardSchemaV1(LibraryShelfSearch);

const LIBRARY_SHELF_SEARCH_WRITING: RouteSearchWriting<LibraryShelfSearch> = {
  pushed: [],
  debounced: ['q'],
  withoutDefaults: (search) => (search.q ? { q: search.q } : {}),
};

export function useLibraryShelfSearch(): readonly [LibraryShelfSearch, (patch: LibraryShelfSearch) => void] {
  const search = useSearch({ from: '/library/' });
  const navigate = useNavigate({ from: '/library/' });
  return [search, useRouteSearchWriter(navigate, LIBRARY_SHELF_SEARCH_WRITING)];
}

export const LibraryItemSearch = Schema.Struct({
  /** Item seconds the playhead opens at. */
  t: optionalSearchParam(Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  /** The flag in focus, by its number. */
  flag: optionalSearchParam(Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)))),
  /** The track heard, by name, when it isn't the item's usual one; a track without sound is ignored. */
  hear: optionalSearchParam(Schema.String),
});
export type LibraryItemSearch = typeof LibraryItemSearch.Type;
export const libraryItemSearchValidator = Schema.toStandardSchemaV1(LibraryItemSearch);

const LIBRARY_ITEM_SEARCH_WRITING: RouteSearchWriting<LibraryItemSearch> = {
  pushed: [],
  // The playhead is written as it settles; a flag opened is a place.
  debounced: ['t'],
  withoutDefaults: (search) => Object.fromEntries(Object.entries(search).filter(([, value]) => value !== undefined)),
};

export function useLibraryItemSearch(): readonly [LibraryItemSearch, (patch: LibraryItemSearch) => void] {
  const search = useSearch({ from: '/library/$item' });
  const navigate = useNavigate({ from: '/library/$item' });
  return [search, useRouteSearchWriter(navigate, LIBRARY_ITEM_SEARCH_WRITING)];
}
