import { ReviewThreadPanel, ReviewThreadScopeProvider, type ReviewThreadScope } from '#web/features/review/index.ts';
import { formatReviewPlanNoteWhere } from '#lib/output/review/models/review-plan.ts';
import { usePlanScreen } from './plan-screen-context.tsx';
import { planSceneTitle } from './plan-timing.ts';
import { PlanNoteChange } from './plan-word-diff.tsx';

/**
 * The plan's thread, the review's own panel and composer on the plan's notes: full height beside the page, its notes
 * in plan order, those whose quote is gone in a group of their own, each under its words the diff of its field reworded
 * since. A note's place on the page is drawn by the page.
 */
export function PlanThread() {
  const { project, threads, ops, draft, search, setSearch, focusedScene } = usePlanScreen();
  const { field, ...anchor } = draft.anchor.on === 'plan' ? draft.anchor : {};
  const scope: ReviewThreadScope = {
    project, subject: { on: 'plan' }, threads, ops, draft, media: null, unplacedLabel: 'moved or removed',
    noteAside: PlanNoteChange,
    search: { ...(search.note !== undefined && { note: search.note }), ...(search.filter && { filter: search.filter }) },
    setSearch: (patch) => setSearch({ ...('note' in patch && { note: patch.note }), ...('filter' in patch && { filter: patch.filter }) }),
    ...(focusedScene !== null && { draftFallback: { anchor: { on: 'plan', field: 'scene', scene: focusedScene }, label: `On scene ${planSceneTitle(focusedScene)}` } }),
    ...(field && { draftOnLabel: `On ${formatReviewPlanNoteWhere({ ...anchor, on: 'plan', field })}` }),
  };
  return (
    <ReviewThreadScopeProvider value={scope}>
      <ReviewThreadPanel />
    </ReviewThreadScopeProvider>
  );
}
