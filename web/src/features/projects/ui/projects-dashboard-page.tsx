import { Box, Code, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Ellipsis } from 'lucide-react';
import { Fragment, useRef } from 'react';
import { reviewRowAwaitsYou, type ReviewProjectRow, type ReviewProjectSummary } from '#lib/output/review/models/review-dashboard.ts';
import { useProjectsPlanSignoffs, type ProjectPlanSignoffs } from '#web/features/storyboard/index.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useProjectSummaries } from '../controllers/project-queries.ts';
import { ProjectDashboardRow } from './project-dashboard-row.tsx';
import { ProjectPlaceRow, projectPlaceKeyOf } from './project-place-row.tsx';
import { projectListStyles, ProjectRow } from './project-row.tsx';
import { ProjectRowGroupLabel } from './project-row-group-label.tsx';
import { ProjectThumbnail } from './project-thumbnail.tsx';
import { useProjectRowHotkeys } from './use-project-row-hotkeys.ts';

const styles = stylex.create({
  label: { color: colors.dim, paddingInline: spacing.gap, paddingBlock: spacing.tight },
  more: { color: colors.dim },
  rule: { height: '1px', backgroundColor: colors.line, marginBlock: spacing.gap },
  empty: { padding: spacing.inset, color: colors.dim },
});

/** A project's awaiting rows shown before the rest fold into `+N`, so one busy project can't fill the first screen. */
const AWAITING_ROWS_PER_PROJECT = 3;

type AwaitingGroup = { summary: ReviewProjectSummary; rows: ReviewProjectRow[]; more: number };

/** "Awaiting you" by project, so each project's name shows once over its first few rows. */
const awaitingByProject = (summaries: readonly ReviewProjectSummary[], plans: ReadonlyMap<string, ProjectPlanSignoffs | null>): AwaitingGroup[] =>
  summaries.flatMap((summary) => {
    const rows = summary.rows.filter((row) => reviewRowAwaitsYou(row, plans.get(summary.project) ?? null));
    if (!rows.length) return [];
    // One row more than the cap shows itself rather than a `+1` row in its place.
    const shown = rows.length > AWAITING_ROWS_PER_PROJECT + 1 ? rows.slice(0, AWAITING_ROWS_PER_PROJECT) : rows;
    return [{ summary, rows: shown, more: rows.length - shown.length }];
  });

const projectHasRender = (summary: ReviewProjectSummary) => summary.rows.some((row) => row.on === 'file');

/**
 * The front page: what waits on you across every project (a fix to verify, an agent's question, a decision, an
 * unsigned plan), then every project, the most recently active first, and last those with nothing rendered.
 */
export function ProjectsDashboardPage() {
  const { summaries, now } = useProjectSummaries();
  const listRef = useRef<HTMLDivElement>(null);
  useProjectRowHotkeys(listRef);
  const plans = useProjectsPlanSignoffs(summaries.flatMap(({ project, rows }) => rows.flatMap((row) => (row.on === 'plan' ? [{ project, signoffs: row.signoffs }] : []))));
  const awaiting = awaitingByProject(summaries, plans);
  const projects = [...summaries.filter(projectHasRender), ...summaries.filter((summary) => !projectHasRender(summary))];
  return (
    <StudioShell start={<Text size="sm">studio</Text>}>
      <FadeScroll>
        <Stack ref={listRef} gap={0} {...stylex.props(projectListStyles.list, stylex.defaultMarker())}>
          {summaries.length === 0 && <Text size="sm" {...stylex.props(styles.empty)}><Code>studio new</Code></Text>}
          {awaiting.length > 0 && (
            <>
              <Text component="h2" size="sm" {...stylex.props(styles.label)}>Awaiting you</Text>
              {awaiting.map(({ summary, rows, more }) => (
                <Fragment key={summary.project}>
                  <ProjectRowGroupLabel>{summary.project}</ProjectRowGroupLabel>
                  {rows.map((row) => <ProjectPlaceRow key={projectPlaceKeyOf(row)} summary={summary} row={row} now={now} />)}
                  {more > 0 && (
                    <ProjectRow target={{ project: summary.project, on: 'project' }} thumbnail={<ProjectThumbnail glyph={<Ellipsis size={14} />} />}
                      title={<Text component="span" inherit {...stylex.props(styles.more)}>+{more}</Text>} />
                  )}
                </Fragment>
              ))}
              <Box aria-hidden {...stylex.props(styles.rule)} />
            </>
          )}
          {projects.map((summary) => <ProjectDashboardRow key={summary.project} summary={summary} now={now} />)}
        </Stack>
      </FadeScroll>
    </StudioShell>
  );
}
