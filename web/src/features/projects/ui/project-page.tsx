import { Box, Code, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Fragment, useRef } from 'react';
import type { ReviewProjectRow } from '#lib/output/review/models/review-dashboard.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useProjectSummary } from '../controllers/project-queries.ts';
import { ProjectThreadCounts } from './project-thread-counts.tsx';
import { ProjectPlaceRow, projectFileFolderOf, projectPlaceKeyOf } from './project-place-row.tsx';
import { ProjectStillsFolderRow } from './project-stills-folder-row.tsx';
import { projectListStyles } from './project-row.tsx';
import { ProjectRowGroupLabel } from './project-row-group-label.tsx';
import { useProjectRowHotkeys } from './use-project-row-hotkeys.ts';

const styles = stylex.create({
  rule: { height: '1px', backgroundColor: colors.line, marginBlockStart: spacing.tight, marginBlockEnd: spacing.gap },
  empty: { padding: spacing.inset, color: colors.dim },
});

/** The page's groups, in order: the project's own notes pinned first, then its files, decisions and script. */
const PROJECT_PAGE_GROUPS = ['project', 'file', 'decision', 'script'] as const satisfies readonly ReviewProjectRow['on'][];

const stillsIn = (rows: readonly ReviewProjectRow[]) => rows.filter((row) => row.on === 'file' && row.artifact.kind === 'still').length;

const rowThreadsWaiting = ({ threads }: ReviewProjectRow) => threads.open + threads.addressed + threads.asks;

/** A kind's rows split into runs, each under its label: files by folder, the most notes waiting first; other kinds whole. */
function projectPageRuns(rows: readonly ReviewProjectRow[]): { label?: string; rows: ReviewProjectRow[] }[] {
  const runs = new Map<string | undefined, ReviewProjectRow[]>();
  for (const row of rows) {
    // `/` names the project's root, so its files don't read as the folder labelled above them.
    const label = row.on === 'file' ? projectFileFolderOf(row.artifact.path) || '/' : undefined;
    runs.set(label, [...(runs.get(label) ?? []), row]);
  }
  const waiting = (run: readonly ReviewProjectRow[]) => run.reduce((sum, row) => sum + rowThreadsWaiting(row), 0);
  return [...runs].map(([label, run]) => ({ label, rows: run })).toSorted((a, b) => waiting(b.rows) - waiting(a.rows));
}

/**
 * A project's page: its files by folder, its decisions and its script, each a row that opens it, a rule between kinds.
 * Files with notes waiting come first, in the folder with the most waiting first, then the newest; decisions keep open first.
 */
export function ProjectPage({ project }: { readonly project: string }) {
  const { summary, now } = useProjectSummary(project);
  const listRef = useRef<HTMLDivElement>(null);
  useProjectRowHotkeys(listRef);
  const groups = PROJECT_PAGE_GROUPS
    .map((on) => summary.rows.filter((row) => row.on === on))
    .map((rows) => (rows[0]?.on === 'file' ? rows.toSorted((a, b) => Number(rowThreadsWaiting(b) > 0) - Number(rowThreadsWaiting(a) > 0)) : rows))
    .filter((rows) => rows.length > 0);
  return (
    <StudioShell start={<><Text size="sm">{project}</Text><ProjectThreadCounts threads={summary.threads} /></>}>
      <FadeScroll>
        <Stack ref={listRef} gap={0} {...stylex.props(projectListStyles.list, stylex.defaultMarker())}>
          {summary.rows.length === 0 && <Text size="sm" {...stylex.props(styles.empty)}><Code>studio render {project}</Code></Text>}
          {groups.map((rows, i) => (
            <Fragment key={rows[0].on}>
              {i > 0 && <Box aria-hidden {...stylex.props(styles.rule)} />}
              {projectPageRuns(rows).map((run) => (
                <Fragment key={run.label ?? ''}>
                  {run.label && <ProjectRowGroupLabel>{run.label}</ProjectRowGroupLabel>}
                  {run.label && run.label !== '/' && stillsIn(run.rows) > 1 && <ProjectStillsFolderRow project={project} folder={run.label} stills={stillsIn(run.rows)} />}
                  {run.rows.map((row) => (
                    <ProjectPlaceRow key={projectPlaceKeyOf(row)} summary={summary} row={row} now={now} folderLabelled={run.label !== undefined} />
                  ))}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </Stack>
      </FadeScroll>
    </StudioShell>
  );
}
