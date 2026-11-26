import { Box, Code, Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useRef, useState } from 'react';
import { projectPageRungOf, type ProjectPageRung as ProjectPageRungName, type ReviewProjectRow } from '#lib/output/review/models/review-dashboard.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { StudioCollectionArrangementMenu } from '#web/shared/ui/studio-collection-arrangement-menu.tsx';
import { StudioCollectionViewToggle } from '#web/shared/ui/studio-collection-view-toggle.tsx';
import { StudioPageTitle } from '#web/shared/ui/studio-page-title.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useStudioCollectionView, type StudioCollectionView } from '#web/shared/ui/use-studio-collection-view.ts';
import { useProjectSummary } from '../controllers/project-queries.ts';
import { ProjectThreadCounts } from './project-thread-counts.tsx';
import { PROJECT_MADE_RUNG_LABELS } from '#lib/output/review/models/project-made.ts';
import { ProjectName } from './project-name.tsx';
import { useProjectNewSinceLastLook } from '../controllers/project-seen.ts';
import { ProjectFileFilter, projectFileMatchesFilter } from './project-file-filter.tsx';
import { ProjectFileIsNewContext } from './project-file-new.tsx';
import { ProjectLatestLink, projectNewFileCountOf } from './project-latest-link.tsx';
import { projectFolderRunOf, projectFolderRuns, ProjectPageRunsView, type ProjectPageRun } from './project-page-run.tsx';
import { projectFileFolderOf } from './project-place.tsx';
import { projectListStyles, ProjectRowButton } from './project-row.tsx';
import { ProjectThumbnail } from './project-thumbnail.tsx';
import { useProjectRowHotkeys } from './use-project-row-hotkeys.ts';

const styles = stylex.create({
  rule: { height: '1px', backgroundColor: colors.line, marginBlockStart: spacing.tight, marginBlockEnd: spacing.gap },
  empty: { padding: spacing.inset, color: colors.dim },
  dim: { color: colors.dim },
});

type FileRow = Extract<ReviewProjectRow, { on: 'file' }>;

/**
 * A run of rows shown together: `folders` labels its files by folder, as the stills and the folded work are, or with
 * `shared`, by the one folder they all sit in (the grid's loose renders under `out/`); `label` heads what the project
 * made (its footage, music), whose files are named by what they are rather than their paths.
 */
type ProjectPageRung = { key: string; rows: ReviewProjectRow[]; folders?: boolean; shared?: boolean; label?: string };

const rowThreadsWaiting = ({ threads }: ReviewProjectRow) => threads.open + threads.addressed + threads.asks;

/** The rungs for what the project made, in the page's order: closest to the cut first. */
const MADE_RUNGS = ['scene-renders', 'footage', 'music', 'images'] as const;

/**
 * The page's rungs, in the order work climbs them: the plan, open decisions, the project's own notes, the newest
 * animatic, the newest cut (with its transparent pair), what the project made toward them (each under its heading),
 * then the stills. Every other row is older work, folded away, unless a thread on it waits: that one shows after the
 * stills.
 */
function projectPageRungs(rows: readonly ReviewProjectRow[]): { shown: ProjectPageRung[]; folded: ReviewProjectRow[] } {
  const files = rows.filter((row): row is FileRow => row.on === 'file');
  const onRung = (rung: ProjectPageRungName) => files.filter((row) => projectPageRungOf(row.artifact) === rung);
  // Files come newest first, so the first of a rung is its newest.
  const [animatic] = onRung('animatic'), [cut] = onRung('cut');
  const cuts = files.filter((row) => row === cut || (cut?.artifact.pair !== undefined && row.artifact.path === cut.artifact.pair));
  const made = MADE_RUNGS.map((rung): ProjectPageRung => ({ key: rung, rows: onRung(rung), label: PROJECT_MADE_RUNG_LABELS[rung] }));
  const placed = new Set<ReviewProjectRow>([
    ...rows.filter((row) => row.on === 'plan' || row.on === 'project' || (row.on === 'decision' && row.state === 'open')),
    ...(animatic ? [animatic] : []), ...cuts, ...made.flatMap((rung) => rung.rows), ...onRung('stills'),
  ]);
  const rest = rows.filter((row) => !placed.has(row));
  const shown: ProjectPageRung[] = [
    { key: 'plan', rows: rows.filter((row) => row.on === 'plan') },
    { key: 'decisions', rows: rows.filter((row) => row.on === 'decision' && row.state === 'open') },
    { key: 'project', rows: rows.filter((row) => row.on === 'project') },
    { key: 'animatic', rows: animatic ? [animatic] : [] },
    { key: 'cut', rows: cuts },
    ...made,
    { key: 'stills', rows: onRung('stills'), folders: true },
    { key: 'waiting', rows: rest.filter((row) => rowThreadsWaiting(row) > 0) },
  ];
  return { shown: shown.filter((rung) => rung.rows.length > 0), folded: rest.filter((row) => rowThreadsWaiting(row) === 0) };
}

/** A rung with a heading of its own: a folder's, or what the project made. */
const headedRung = (rung: ProjectPageRung) => rung.folders === true || rung.label !== undefined;

/**
 * The grid's sections: what's to review (plan, decisions, the project's notes) as rows, then the loose files as one
 * grid under their shared folder, then each headed rung. A rung of one item would stand alone in a row of empty grid.
 */
function projectPageGridSections(shown: readonly ProjectPageRung[]): ProjectPageRung[] {
  const loose = shown.filter((rung) => !headedRung(rung)).flatMap((rung) => rung.rows);
  return [
    { key: 'review', rows: loose.filter((row) => row.on !== 'file') },
    { key: 'files', rows: loose.filter((row) => row.on === 'file'), folders: true, shared: true },
    ...shown.filter(headedRung),
  ].filter((section) => section.rows.length > 0);
}

/** `everything else: 14 files`, and the settled decisions folded with them. */
function foldedLabelOf(folded: readonly ReviewProjectRow[]): string {
  const files = folded.filter((row) => row.on === 'file').length, decisions = folded.length - files;
  return [
    files > 0 && `everything else: ${files} file${files === 1 ? '' : 's'}`,
    decisions > 0 && `${decisions} settled decision${decisions === 1 ? '' : 's'}`,
  ].filter(Boolean).join(', ');
}

/** A rung's runs: what the project made under its heading, the loose renders under their shared folder, else by folder. */
const runsOf = (rung: ProjectPageRung): ProjectPageRun[] => {
  if (rung.label !== undefined) return [{ label: rung.label, base: '', rows: rung.rows }];
  if (rung.shared) return [projectFolderRunOf(sharedFolderOf(rung.rows), rung.rows)];
  return rung.folders ? projectFolderRuns(rung.rows) : [{ base: '', rows: rung.rows }];
};

/** The folder every file shares, word-whole (`out/` for `out/video.mp4` and `out/wip/animatic.mp4`); `''` for none. */
function sharedFolderOf(rows: readonly ReviewProjectRow[]): string {
  const folders = rows.flatMap((row) => (row.on === 'file' ? [projectFileFolderOf(row.artifact.path)] : []));
  const [first = ''] = folders;
  let shared = first;
  for (const folder of folders) while (!folder.startsWith(shared)) shared = projectFileFolderOf(shared.slice(0, -1));
  return shared;
}

/**
 * The page's rungs (projectPageRungs), or, while the filter holds words, every file that matches, by folder, newest
 * first, with nothing folded.
 */
function projectPageShownOf(rows: readonly ReviewProjectRow[], filter: string, view: StudioCollectionView) {
  if (filter.trim() !== '') return { shown: [{ key: 'matches', rows: rows.filter((row) => projectFileMatchesFilter(row, filter)), folders: true }], folded: [] };
  const rungs = projectPageRungs(rows);
  return { shown: view === 'grid' ? projectPageGridSections(rungs.shown) : rungs.shown, folded: rungs.folded };
}

/**
 * A project's page beside the sidebar, by rung (projectPageRungs), a rule between rungs, and everything else folded into
 * one row that opens in place: each run as rows or tiles, as the studio's list-or-grid choice says. The title's counts
 * open each state's first thread; its latest link counts what's new since the reviewer last looked.
 */
export function ProjectPage({ project }: { readonly project: string }) {
  const { summary, now } = useProjectSummary(project);
  const listRef = useRef<HTMLDivElement>(null);
  const [olderShown, setOlderShown] = useState(false);
  const [filter, setFilter] = useState('');
  const { view } = useStudioCollectionView();
  const isNew = useProjectNewSinceLastLook(project, now);
  useProjectRowHotkeys(listRef);
  const { shown, folded } = projectPageShownOf(summary.rows, filter, view);
  const end = (
    <>
      <ProjectLatestLink project={project} fresh={projectNewFileCountOf(summary.rows, isNew)} />
      <ProjectFileFilter value={filter} onChange={setFilter} />
      {view === 'grid' && <StudioCollectionArrangementMenu />}
      <StudioCollectionViewToggle />
    </>
  );
  return (
    <StudioShell>
      <StudioPageTitle count={<Group component="span" gap="gap" wrap="nowrap"><ProjectThreadCounts threads={summary.threads} linkedTo={summary} /></Group>} end={end}>
        <ProjectName project={project} />
      </StudioPageTitle>
      <FadeScroll>
        <ProjectFileIsNewContext value={isNew}>
        <Box ref={listRef} {...stylex.props(projectListStyles.list, stylex.defaultMarker())}>
          {filter.trim() !== '' && shown[0]?.rows.length === 0 && <Text size="sm" {...stylex.props(projectListStyles.span, styles.empty)}>No file's name or folder holds “{filter.trim()}”.</Text>}
          {summary.rows.length === 0 && <Text size="sm" {...stylex.props(projectListStyles.span, styles.empty)}><Code>studio render {project}</Code></Text>}
          {shown.map((rung, i) => {
            const runs = runsOf(rung);
            return (
              <Fragment key={rung.key}>
                {/* A run under a heading has the heading's seam above it already. */}
                {i > 0 && runs[0]?.label === undefined && <Box aria-hidden {...stylex.props(projectListStyles.span, styles.rule)} />}
                <ProjectPageRunsView summary={summary} now={now} runs={runs} view={view} />
              </Fragment>
            );
          })}
          {folded.length > 0 && (
            <>
              {shown.length > 0 && <Box aria-hidden {...stylex.props(projectListStyles.span, styles.rule)} />}
              <ProjectRowButton
                expanded={olderShown} onToggle={() => setOlderShown((was) => !was)}
                thumbnail={<ProjectThumbnail glyph={olderShown ? <ChevronDown size={14} /> : <ChevronRight size={14} />} />}
                title={<Text component="span" inherit {...stylex.props(styles.dim)}>{foldedLabelOf(folded)}</Text>}
              />
              {olderShown && <ProjectPageRunsView summary={summary} now={now} runs={projectFolderRuns(folded)} view={view} />}
            </>
          )}
        </Box>
        </ProjectFileIsNewContext>
      </FadeScroll>
    </StudioShell>
  );
}
