// script-search.ts: the read-along's URL, `/projects/<p>/script?line=badge&note=12`, so a reload or a copied link lands
// on the line and the thread the reviewer had open.
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { optionalSearchParam, useRouteSearchWriter, type RouteSearchWriting } from '#web/shared/route-search.ts';

const ThreadId = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)));

export const ScriptSearch = Schema.Struct({
  /** The line in focus, by its voiceover.json id: where `Space` plays from and `N` notes. */
  line: optionalSearchParam(Schema.String),
  /** The thread in focus. */
  note: optionalSearchParam(ThreadId),
  /** The thread's filter; absent is `active` (all but resolved). */
  filter: optionalSearchParam(Schema.Literals(['active', 'open', 'all'])),
});
export type ScriptSearch = typeof ScriptSearch.Type;

export const scriptSearchValidator = Schema.toStandardSchemaV1(ScriptSearch);

export type SetScriptSearch = (patch: ScriptSearch) => void;

/** Opening a thread is a place Back returns to; the line follows the playhead as it settles, and replaces. */
const SCRIPT_SEARCH_WRITING: RouteSearchWriting<ScriptSearch> = {
  pushed: ['note'],
  withoutDefaults: ({ filter, ...rest }) => ({ ...rest, ...(filter !== undefined && filter !== 'active' && { filter }) }),
};

export function useScriptSearch(): readonly [ScriptSearch, SetScriptSearch] {
  const search = useSearch({ from: '/projects/$project/script' });
  const navigate = useNavigate({ from: '/projects/$project/script' });
  return [search, useRouteSearchWriter(navigate, SCRIPT_SEARCH_WRITING)];
}
