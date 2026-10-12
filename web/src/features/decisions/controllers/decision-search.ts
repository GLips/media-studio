// decision-search.ts: the decisions screen's URL, `/projects/<p>/decisions/<topic>?c=b&view=two&two=b,d&note=7`, so a
// reload or a copied link opens the same candidates the same way.
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { optionalSearchParam, useRouteSearchWriter, type RouteSearchWriting } from '#web/shared/route-search.ts';

export const DecisionSearch = Schema.Struct({
  /** The candidate in focus, heard and judged; absent is the first. */
  c: optionalSearchParam(Schema.String),
  /** The two-up's pair, `a,d`; absent pairs the focused candidate with the pick. */
  two: optionalSearchParam(Schema.String),
  /** Absent is the survey. */
  view: optionalSearchParam(Schema.Literals(['survey', 'two'])),
  /** `picks` shows only the picked candidates. */
  filter: optionalSearchParam(Schema.Literal('picks')),
  /** The thread in focus. */
  note: optionalSearchParam(Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)))),
});
export type DecisionSearch = typeof DecisionSearch.Type;

export const decisionSearchValidator = Schema.toStandardSchemaV1(DecisionSearch);

export type SetDecisionSearch = (patch: DecisionSearch) => void;

/** Switching views and opening a note are places Back returns to; moving focus and filtering aren't. */
const DECISION_SEARCH_WRITING: RouteSearchWriting<DecisionSearch> = {
  pushed: ['view', 'note'],
  // Leaves out the survey and an unset key, so a plain link stays plain.
  withoutDefaults: ({ view, ...rest }) => ({ ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)), ...(view === 'two' && { view }) }),
};

export function useDecisionSearch(): readonly [DecisionSearch, SetDecisionSearch] {
  const search = useSearch({ from: '/projects/$project/decisions/$topic' });
  const navigate = useNavigate({ from: '/projects/$project/decisions/$topic' });
  return [search, useRouteSearchWriter(navigate, DECISION_SEARCH_WRITING)];
}
