import { useLocation, useParams } from '@tanstack/react-router';
import { reviewPlanMayAwaitYou, reviewProjectWaitingCount, type ReviewProjectSummary } from '#lib/output/review/models/review-dashboard.ts';
import { useProjectsPlanSignoffs } from '#web/features/storyboard/index.ts';
import { useStudioWaitingTitle } from '#web/shared/ui/use-studio-waiting-title.ts';
import { useProjectSummariesIfLoaded, useProjectSummaryIfLoaded } from '../controllers/project-queries.ts';

/** What waits on the reviewer across `summaries`, summed (reviewProjectWaitingCount), resolving only plans that may wait. */
function useWaitingCount(summaries: readonly ReviewProjectSummary[]): number {
  const plans = useProjectsPlanSignoffs(summaries.flatMap(({ project, rows }) =>
    rows.flatMap((row) => (row.on === 'plan' && reviewPlanMayAwaitYou(row) ? [{ project, signoffs: row.signoffs }] : []))));
  return summaries.reduce((sum, summary) => sum + reviewProjectWaitingCount(summary, plans.get(summary.project) ?? null), 0);
}

function ProjectWaitingTitle({ project }: { readonly project: string }) {
  const summary = useProjectSummaryIfLoaded(project);
  useStudioWaitingTitle(useWaitingCount(summary ? [summary] : []), project);
  return null;
}

function DashboardWaitingTitle() {
  useStudioWaitingTitle(useWaitingCount(useProjectSummariesIfLoaded() ?? []));
  return null;
}

function PlainTitle() {
  useStudioWaitingTitle(0);
  return null;
}

/**
 * The tab's title and icon: a project's screens count what waits in that project, the dashboard across every
 * project. Each reads the summary its screen already polls; any other page (a not-found) counts nothing, rather than
 * start a poll of its own.
 */
export function StudioWaitingTitle() {
  const project = useParams({ strict: false }).project;
  const dashboard = useLocation({ select: (location) => location.pathname === '/' });
  if (project !== undefined) return <ProjectWaitingTitle key={project} project={project} />;
  return dashboard ? <DashboardWaitingTitle /> : <PlainTitle />;
}
