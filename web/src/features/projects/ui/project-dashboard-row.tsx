import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Folder, MessageSquare } from 'lucide-react';
import { reviewPlanMayAwaitYou, reviewPlanScenesAwaitYou, type ReviewProjectRow, type ReviewProjectSummary } from '#lib/output/review/models/review-dashboard.ts';
import { useProjectPlanSignoffs } from '#web/features/storyboard/index.ts';
import { colors } from '#web/shared/ui/theme.stylex.ts';
import { ProjectAge } from './project-age.tsx';
import { ProjectRow } from './project-row.tsx';
import { ProjectThreadCounts } from './project-thread-counts.tsx';
import { ProjectThumbnail } from './project-thumbnail.tsx';

const styles = stylex.create({
  // A project's name outweighs its files' names, at the same size: the awaiting rows above it hold the eye.
  name: { fontWeight: 600 },
  // A project with nothing rendered yet: listed, but out of the way of the ones with work to look at.
  unrendered: { color: colors.dim, fontWeight: 400 },
  waiting: { color: colors.caution, whiteSpace: 'nowrap' },
  glyph: { verticalAlign: 'middle', marginInlineEnd: '2px' },
});

type PlanRow = Extract<ReviewProjectRow, { on: 'plan' }>;

/**
 * `2 of 6 signed` while the plan's scenes wait (reviewPlanScenesAwaitYou); nothing otherwise, or until it resolves. A
 * plan that can't wait isn't resolved at all, so the dashboard imports only the storyboards in play.
 */
function ProjectPlanState({ project, row }: { readonly project: string; readonly row: PlanRow }) {
  return reviewPlanMayAwaitYou(row) ? <ProjectPlanStateResolved project={project} row={row} /> : null;
}

function ProjectPlanStateResolved({ project, row }: { readonly project: string; readonly row: PlanRow }) {
  const signoffs = useProjectPlanSignoffs(project, row.signoffs);
  if (!signoffs || !reviewPlanScenesAwaitYou(row, signoffs)) return null;
  const signed = signoffs.filter((s) => s.state === 'signed').length;
  return <Text component="span" size="sm" {...stylex.props(styles.waiting)}>plan {signed} of {signoffs.length} signed</Text>;
}

/** A project on the dashboard: its newest picture, its name and newest file, what waits on whom, and when it was last rendered and reviewed. */
export function ProjectDashboardRow({ summary, now }: { readonly summary: ReviewProjectSummary; readonly now: number }) {
  const { project, rows, threads, reviewedAt } = summary;
  const newest = rows.find((r) => r.on === 'file');
  const openDecisions = rows.filter((r) => r.on === 'decision' && r.state === 'open').length;
  const plan = rows.find((r) => r.on === 'plan');
  const status = (
    <>
      <ProjectThreadCounts threads={threads} />
      {openDecisions > 0 && <Text component="span" size="sm" {...stylex.props(styles.waiting)}>{openDecisions} open decision{openDecisions === 1 ? '' : 's'}</Text>}
      {plan?.on === 'plan' && <ProjectPlanState project={project} row={plan} />}
    </>
  );
  const end = (
    <>
      {newest?.on === 'file' && <ProjectAge now={now} at={newest.artifact.modified} what={newest.artifact.kind === 'video' ? 'rendered' : 'made'} />}
      {reviewedAt && <ProjectAge now={now} at={reviewedAt} what="reviewed" glyph={<MessageSquare size={10} {...stylex.props(styles.glyph)} />} />}
    </>
  );
  return (
    <ProjectRow
      target={{ project, on: 'project' }}
      thumbnail={newest?.on === 'file'
        ? <ProjectThumbnail key={newest.thumbnail.kind === 'video' ? newest.thumbnail.hash : newest.artifact.path} project={project} thumbnail={newest.thumbnail} />
        : <ProjectThumbnail glyph={<Folder size={14} />} />}
      title={<Text component="span" inherit {...stylex.props(styles.name, !newest && styles.unrendered)}>{project}</Text>}
      detail={newest?.on === 'file' && newest.artifact.path}
      status={status}
      end={end}
    />
  );
}
