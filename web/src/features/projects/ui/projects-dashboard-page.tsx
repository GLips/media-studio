import { Box, Code, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Ellipsis } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ProjectDashboardRow } from './project-dashboard-row.tsx';
import { ProjectPlaceRow, projectPlaceKeyOf } from './project-place-row.tsx';
import { projectListStyles, ProjectRow } from './project-row.tsx';
import { ProjectRowGroupLabel } from './project-row-group-label.tsx';
import { ProjectThumbnail } from './project-thumbnail.tsx';
import { projectsRenderedFirst, useProjectsAwaiting, type ProjectAwaiting } from './use-projects-awaiting.ts';
import { useProjectRowHotkeys } from './use-project-row-hotkeys.ts';

const styles = stylex.create({
  section: {
    display: 'flex', alignItems: 'baseline', gap: spacing.gap, paddingInline: spacing.gap, paddingBlockEnd: spacing.tight,
    paddingBlockStart: spacing.row,
  },
  first: { paddingBlockStart: spacing.inset },
  count: { color: colors.dim, fontWeight: 400, fontVariantNumeric: 'tabular-nums' },
  quiet: { paddingInline: spacing.gap, paddingBlock: spacing.gap, color: colors.dim },
  project: { color: 'inherit' },
});

/** A project's awaiting rows shown before the rest fold into `N more`, so one busy project can't fill the first screen. */
const AWAITING_ROWS_PER_PROJECT = 3;

/** One of the index's two sections' headers: its name and how many it holds. */
function DashboardSectionHeader({ children, count, first = false }: { readonly children: ReactNode; readonly count: number; readonly first?: boolean }) {
  return (
    <Text component="h2" size="xl" fw={700} {...stylex.props(projectListStyles.span, styles.section, first && styles.first)}>
      {children}
      {count > 0 && <Text component="span" size="md" {...stylex.props(styles.count)}>{count}</Text>}
    </Text>
  );
}

/** A project's run in "Awaiting you": its name (to its page), then its first few rows, the rest folded into one. */
function AwaitingProjectRows({ awaiting: { summary, rows, waiting }, now }: { readonly awaiting: ProjectAwaiting; readonly now: number }) {
  const { project } = summary;
  // One row more than the cap shows itself rather than a `1 more` row in its place.
  const shown = rows.length > AWAITING_ROWS_PER_PROJECT + 1 ? rows.slice(0, AWAITING_ROWS_PER_PROJECT) : rows;
  const more = rows.length - shown.length;
  return (
    <>
      <ProjectRowGroupLabel count={waiting}>
        <AnchorLink to="/projects/$project" params={{ project }} underline="hover" {...stylex.props(styles.project)}>{project}</AnchorLink>
      </ProjectRowGroupLabel>
      {shown.map((row) => <ProjectPlaceRow key={projectPlaceKeyOf(row)} summary={summary} row={row} now={now} />)}
      {more > 0 && (
        <ProjectRow target={{ project, on: 'project' }} thumbnail={<ProjectThumbnail glyph={<Ellipsis size={14} />} />} title={`${more} more`} />
      )}
    </>
  );
}

/**
 * The index, beside the sidebar: what waits on you across every project (a fix to verify, an agent's question, a
 * decision, a plan handed over or changed since signed off), by project, then every project, the most recently active
 * first, and last those with nothing rendered.
 */
export function ProjectsDashboardPage() {
  const { projects, now } = useProjectsAwaiting();
  const listRef = useRef<HTMLDivElement>(null);
  useProjectRowHotkeys(listRef);
  const awaiting = projects.filter(({ rows }) => rows.length > 0);
  const waiting = awaiting.reduce((sum, project) => sum + project.waiting, 0);
  return (
    <StudioShell>
      <FadeScroll>
        <Box ref={listRef} {...stylex.props(projectListStyles.list, stylex.defaultMarker())}>
          <DashboardSectionHeader count={waiting} first>Awaiting you</DashboardSectionHeader>
          {awaiting.length === 0 && <Text size="sm" {...stylex.props(projectListStyles.span, styles.quiet)}>Nothing waits on you.</Text>}
          {awaiting.map((project) => <AwaitingProjectRows key={project.summary.project} awaiting={project} now={now} />)}
          <DashboardSectionHeader count={projects.length}>Projects</DashboardSectionHeader>
          {projects.length === 0 && <Text size="sm" {...stylex.props(projectListStyles.span, styles.quiet)}><Code>studio new</Code></Text>}
          {projectsRenderedFirst(projects).map(({ summary }) => <ProjectDashboardRow key={summary.project} summary={summary} now={now} />)}
        </Box>
      </FadeScroll>
    </StudioShell>
  );
}
