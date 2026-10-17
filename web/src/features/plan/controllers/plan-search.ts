// plan-search.ts: the plan page's URL, `/projects/<p>/plan?scene=label&note=12`, so a reload or a copied link lands on
// the scene and the thread the reviewer had open.
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { optionalSearchParam, useRouteSearchWriter, type RouteSearchWriting } from '#web/shared/route-search.ts';

const ThreadId = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)));

export const PlanSearch = Schema.Struct({
  /** The scene in focus, by its storyboard id: where `S` signs off, and `J` `K` step from. */
  scene: optionalSearchParam(Schema.String),
  /** The thread in focus. */
  note: optionalSearchParam(ThreadId),
  /** The thread's filter; absent is `active` (all but resolved). */
  filter: optionalSearchParam(Schema.Literals(['active', 'open', 'all'])),
});
export type PlanSearch = typeof PlanSearch.Type;

export const planSearchValidator = Schema.toStandardSchemaV1(PlanSearch);

export type SetPlanSearch = (patch: PlanSearch) => void;

/** Opening a thread is a place Back returns to; the scene follows the keys and the playhead, and replaces. */
const PLAN_SEARCH_WRITING: RouteSearchWriting<PlanSearch> = {
  pushed: ['note'],
  withoutDefaults: ({ filter, ...rest }) => ({ ...rest, ...(filter !== undefined && filter !== 'active' && { filter }) }),
};

export function usePlanSearch(): readonly [PlanSearch, SetPlanSearch] {
  const search = useSearch({ from: '/projects/$project/plan' });
  const navigate = useNavigate({ from: '/projects/$project/plan' });
  return [search, useRouteSearchWriter(navigate, PLAN_SEARCH_WRITING)];
}
