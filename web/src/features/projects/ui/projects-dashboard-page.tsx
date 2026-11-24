import { Box, Code, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useHotkeys } from '@tanstack/react-hotkeys';
import { ChevronUp, Ellipsis } from 'lucide-react';
import { useRef, useState } from 'react';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { StudioPageTitle } from '#web/shared/ui/studio-page-title.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ProjectName } from './project-name.tsx';
import { ProjectPlaceRow, projectPlaceKeyOf } from './project-place-row.tsx';
import { projectListStyles, ProjectRowButton } from './project-row.tsx';
import { ProjectRowGroupLabel } from './project-row-group-label.tsx';
import { ProjectThumbnail } from './project-thumbnail.tsx';
import { STUDIO_PROJECT_FILTER_ID } from './studio-sidebar-layout.tsx';
import { useProjectsAwaiting, type ProjectAwaiting } from './use-projects-awaiting.ts';
import { useProjectRowHotkeys } from './use-project-row-hotkeys.ts';

const styles = stylex.create({
  quiet: { paddingInline: spacing.gap, paddingBlock: spacing.gap, color: colors.dim },
  project: { color: 'inherit' },
});

/** A project's awaiting rows shown before the rest fold into `N more`, so one busy project can't fill the first screen. */
const AWAITING_ROWS_PER_PROJECT = 3;

/**
 * A project's run in "Awaiting you": its name (to its page), then its first few rows, the rest folded into one row
 * that opens them in place and folds them again.
 */
function AwaitingProjectRows({ awaiting: { summary, rows, waiting }, now }: { readonly awaiting: ProjectAwaiting; readonly now: number }) {
  const { project } = summary;
  const [expanded, setExpanded] = useState(false);
  // One row more than the cap shows itself rather than a `1 more` row in its place.
  const folds = rows.length > AWAITING_ROWS_PER_PROJECT + 1;
  const shown = folds && !expanded ? rows.slice(0, AWAITING_ROWS_PER_PROJECT) : rows;
  return (
    <>
      <ProjectRowGroupLabel count={waiting}>
        <AnchorLink to="/projects/$project" params={{ project }} underline="hover" {...stylex.props(styles.project)}><ProjectName project={project} /></AnchorLink>
      </ProjectRowGroupLabel>
      {shown.map((row) => <ProjectPlaceRow key={projectPlaceKeyOf(row)} summary={summary} row={row} now={now} />)}
      {folds && (
        <ProjectRowButton
          expanded={expanded} onToggle={() => setExpanded((was) => !was)}
          thumbnail={<ProjectThumbnail glyph={expanded ? <ChevronUp size={14} /> : <Ellipsis size={14} />} />}
          title={expanded ? 'Show fewer' : `${rows.length - AWAITING_ROWS_PER_PROJECT} more`}
        />
      )}
    </>
  );
}

/**
 * The index, beside the sidebar that lists every project: what waits on you across them all (a fix to verify, an
 * agent's question, a decision, a plan handed over or changed since signed off), by project, the most recently active
 * first. `/` filters the sidebar's projects.
 */
export function ProjectsDashboardPage() {
  const { projects, now } = useProjectsAwaiting();
  const listRef = useRef<HTMLDivElement>(null);
  useProjectRowHotkeys(listRef);
  useHotkeys([
    { hotkey: '/', callback: () => document.getElementById(STUDIO_PROJECT_FILTER_ID)?.focus(), options: { meta: { group: 'dashboard', name: 'Filter projects' } } },
  ]);
  const awaiting = projects.filter(({ rows }) => rows.length > 0);
  const waiting = awaiting.reduce((sum, project) => sum + project.waiting, 0);
  return (
    <StudioShell>
      <StudioPageTitle count={waiting > 0 ? waiting : undefined}>Awaiting you</StudioPageTitle>
      <FadeScroll>
        <Box ref={listRef} {...stylex.props(projectListStyles.list, stylex.defaultMarker())}>
          {projects.length === 0 && <Text size="sm" {...stylex.props(projectListStyles.span, styles.quiet)}>No projects yet: <Code>studio new</Code></Text>}
          {projects.length > 0 && awaiting.length === 0 && <Text size="sm" {...stylex.props(projectListStyles.span, styles.quiet)}>Nothing waits on you.</Text>}
          {awaiting.map((project) => <AwaitingProjectRows key={project.summary.project} awaiting={project} now={now} />)}
        </Box>
      </FadeScroll>
    </StudioShell>
  );
}
