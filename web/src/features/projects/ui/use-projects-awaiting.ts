import { reviewPlanMayAwaitYou, reviewProjectWaitingCount, reviewRowAwaitsYou, type ReviewProjectRow, type ReviewProjectSummary } from '#lib/output/review/models/review-dashboard.ts';
import { useProjectsPlanSignoffs } from '#web/features/storyboard/index.ts';
import { useProjectSummaries } from '../controllers/project-queries.ts';

/** A project and what in it waits on the reviewer: the rows, and how many things, as the tab title counts them. */
export type ProjectAwaiting = { summary: ReviewProjectSummary; rows: ReviewProjectRow[]; waiting: number };

const projectHasRender = ({ summary }: ProjectAwaiting) => summary.rows.some((row) => row.on === 'file');

/** The order the index's Projects and the sidebar list them in: those with nothing rendered last, out of the way. */
export const projectsRenderedFirst = (projects: readonly ProjectAwaiting[]): ProjectAwaiting[] =>
  [...projects.filter(projectHasRender), ...projects.filter((project) => !projectHasRender(project))];

/** Every project with what waits in it, the most recently active first. Resolves only the plans that may wait. */
export function useProjectsAwaiting(): { projects: ProjectAwaiting[]; now: number } {
  const { summaries, now } = useProjectSummaries();
  const plans = useProjectsPlanSignoffs(summaries.flatMap(({ project, rows }) => rows.flatMap((row) => (row.on === 'plan' && reviewPlanMayAwaitYou(row) ? [{ project, signoffs: row.signoffs }] : []))));
  const projects = summaries.map((summary) => {
    const signoffs = plans.get(summary.project) ?? null;
    return { summary, rows: summary.rows.filter((row) => reviewRowAwaitsYou(row, signoffs)), waiting: reviewProjectWaitingCount(summary, signoffs) };
  });
  return { projects, now };
}
