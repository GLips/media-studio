import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';
import type { ReviewProjectRow } from '#lib/output/review/models/review-dashboard.ts';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { StudioCollectionViewToggle } from '#web/shared/ui/studio-collection-view-toggle.tsx';
import { StudioPageTitle } from '#web/shared/ui/studio-page-title.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useStudioCollectionView } from '#web/shared/ui/use-studio-collection-view.ts';
import { useProjectSummary } from '../controllers/project-queries.ts';
import { useProjectLatestLook } from '../controllers/project-seen.ts';
import { ProjectFileFilter, projectFileMatchesFilter } from './project-file-filter.tsx';
import { ProjectFileIsNewContext } from './project-file-new.tsx';
import { projectNewFileCountOf } from './project-latest-link.tsx';
import { ProjectName } from './project-name.tsx';
import { ProjectPageRunsView, type ProjectPageRun } from './project-page-run.tsx';
import { projectListStyles } from './project-row.tsx';
import { useProjectRowHotkeys } from './use-project-row-hotkeys.ts';

const styles = stylex.create({
  dim: { color: colors.dim },
  fresh: { color: colors.accent, fontWeight: 600 },
  empty: { padding: spacing.inset, color: colors.dim },
  back: { color: colors.cream, whiteSpace: 'nowrap' },
});

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_LABEL = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const startOfDay = (at: number) => new Date(at).setHours(0, 0, 0, 0);

/** `today`, `yesterday`, else `Mon, Nov 23`: the day a file last changed, in the reviewer's own time zone. */
function dayLabelOf(modified: string, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(Date.parse(modified))) / DAY_MS);
  if (days <= 0) return 'today';
  return days === 1 ? 'yesterday' : DATE_LABEL.format(Date.parse(modified));
}

/** Every file, newest first, a run per day it last changed. */
function latestRunsOf(rows: readonly ReviewProjectRow[], now: number): ProjectPageRun[] {
  const runs = new Map<string, ReviewProjectRow[]>();
  for (const row of rows) {
    if (row.on !== 'file') continue;
    const day = dayLabelOf(row.artifact.modified, now);
    runs.set(day, [...(runs.get(day) ?? []), row]);
  }
  return [...runs].map(([label, run]) => ({ label, base: '', rows: run, byTime: true }));
}

/**
 * A project's latest: every media file it holds, newest first by when it last changed, a run per day, each changed since
 * the reviewer's last look marked `new` until they open it. Opening one opens its review, where a note sticks to it.
 */
export function ProjectLatestPage({ project }: { readonly project: string }) {
  const { summary, now } = useProjectSummary(project);
  const listRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState('');
  const { view } = useStudioCollectionView();
  const isNew = useProjectLatestLook(project, now);
  useProjectRowHotkeys(listRef);
  const files = summary.rows.filter((row) => projectFileMatchesFilter(row, filter));
  const fresh = projectNewFileCountOf(files, isNew);
  const end = (
    <>
      <AnchorLink to="/projects/$project" params={{ project }} underline="never" fz="sm" {...stylex.props(styles.back)}>◂ project</AnchorLink>
      <ProjectFileFilter value={filter} onChange={setFilter} />
      <StudioCollectionViewToggle />
    </>
  );
  const count = <>{files.length} files{fresh > 0 && <Text component="span" inherit {...stylex.props(styles.fresh)}> · {fresh} new</Text>}</>;
  return (
    <StudioShell>
      <StudioPageTitle count={count} end={end}>
        <ProjectName project={project} /> <Text component="span" inherit {...stylex.props(styles.dim)}>latest</Text>
      </StudioPageTitle>
      <FadeScroll>
        <ProjectFileIsNewContext value={isNew}>
          <Box ref={listRef} {...stylex.props(projectListStyles.list, stylex.defaultMarker())}>
            {files.length === 0 && <Text size="sm" {...stylex.props(projectListStyles.span, styles.empty)}>{filter.trim() ? `No file's name or folder holds “${filter.trim()}”.` : 'No media files yet.'}</Text>}
            <ProjectPageRunsView summary={summary} now={now} runs={latestRunsOf(files, now)} view={view} />
          </Box>
        </ProjectFileIsNewContext>
      </FadeScroll>
    </StudioShell>
  );
}
