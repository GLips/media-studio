import { keepPreviousData, useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { reviewPlanSignoffs } from '#lib/output/review/models/review-plan.ts';
import type { ReviewSignoff } from '#lib/output/review/models/review-threads.ts';
import { projectStoryboardQueryOptions, useProjectStoryboard, useStoryboardModulesVersion } from './use-project-storyboard.ts';

/** Each scene's sign-off as it stands, in plan order. */
export type ProjectPlanSignoffs = ReturnType<typeof reviewPlanSignoffs>;

/**
 * `project`'s scenes against its plan sign-offs, worked out here because only the browser resolves a storyboard: null
 * until it loads, and for a project with no storyboard.ts or one that doesn't load.
 */
export function useProjectPlanSignoffs(project: string, signoffs: readonly ReviewSignoff[]): ProjectPlanSignoffs | null {
  const load = useProjectStoryboard(project);
  const plan = load.state === 'ready' ? load.plan : null;
  return useMemo(() => plan && reviewPlanSignoffs(plan.storyboard, plan.resolved, signoffs), [plan, signoffs]);
}

/**
 * Every listed project's scene sign-offs, by project, as useProjectPlanSignoffs works out one's (null until its
 * storyboard loads, or with none). A hot update keeps the last answer until the new one lands, so a row doesn't blink.
 */
export function useProjectsPlanSignoffs(plans: readonly { project: string; signoffs: readonly ReviewSignoff[] }[]): ReadonlyMap<string, ProjectPlanSignoffs | null> {
  const version = useStoryboardModulesVersion();
  const loaded = useQueries({
    queries: plans.map(({ project }) => ({ ...projectStoryboardQueryOptions(project, version), placeholderData: keepPreviousData })),
  }).map((q) => q.data ?? null);
  return new Map(plans.map(({ project, signoffs }, i) => {
    const plan = loaded[i];
    return [project, plan && reviewPlanSignoffs(plan.storyboard, plan.resolved, signoffs)];
  }));
}
