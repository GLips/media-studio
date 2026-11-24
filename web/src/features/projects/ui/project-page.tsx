import { Box, Code, Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useRef, useState } from 'react';
import { projectPageRungOf, type ReviewProjectRow, type ReviewProjectSummary } from '#lib/output/review/models/review-dashboard.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { StudioCollectionViewToggle } from '#web/shared/ui/studio-collection-view-toggle.tsx';
import { StudioPageTitle } from '#web/shared/ui/studio-page-title.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useStudioCollectionView, type StudioCollectionView } from '#web/shared/ui/use-studio-collection-view.ts';
import { useProjectSummary } from '../controllers/project-queries.ts';
import { ProjectThreadCounts } from './project-thread-counts.tsx';
import { ProjectName } from './project-name.tsx';
import { ProjectPlace, projectFileFolderOf, projectPlaceKeyOf } from './project-place.tsx';
import { ProjectStillsFolderRow } from './project-stills-folder-row.tsx';
import { projectListStyles, ProjectRowButton } from './project-row.tsx';
import { ProjectRowGroupLabel } from './project-row-group-label.tsx';
import { ProjectThumbnail } from './project-thumbnail.tsx';
import { projectTileGridStyles } from './project-tile.tsx';
import { useProjectRowHotkeys } from './use-project-row-hotkeys.ts';

const styles = stylex.create({
  rule: { height: '1px', backgroundColor: colors.line, marginBlockStart: spacing.tight, marginBlockEnd: spacing.gap },
  empty: { padding: spacing.inset, color: colors.dim },
  dim: { color: colors.dim },
});

type FileRow = Extract<ReviewProjectRow, { on: 'file' }>;

/** A run of rows shown together: `folders` labels its files by folder, as the stills and the folded work are. */
type ProjectPageRung = { key: string; rows: ReviewProjectRow[]; folders?: boolean };

const rowThreadsWaiting = ({ threads }: ReviewProjectRow) => threads.open + threads.addressed + threads.asks;

/**
 * The page's rungs, in the order work climbs them: the plan, open decisions, the project's own notes, the newest
 * animatic, the newest cut (with its transparent pair), then the stills. Every other row is older work, folded away,
 * unless a thread on it waits: that one shows after the stills.
 */
function projectPageRungs(rows: readonly ReviewProjectRow[]): { shown: ProjectPageRung[]; folded: ReviewProjectRow[] } {
  const files = rows.filter((row): row is FileRow => row.on === 'file');
  // Files come newest first, so the first of a rung is its newest.
  const newestOf = (rung: 'animatic' | 'cut') => files.find((row) => projectPageRungOf(row.artifact.path) === rung);
  const animatic = newestOf('animatic'), cut = newestOf('cut');
  const cuts = files.filter((row) => row === cut || (cut?.artifact.pair !== undefined && row.artifact.path === cut.artifact.pair));
  const placed = new Set<ReviewProjectRow>([
    ...rows.filter((row) => row.on === 'plan' || row.on === 'project' || (row.on === 'decision' && row.state === 'open')),
    ...(animatic ? [animatic] : []), ...cuts,
    ...files.filter((row) => projectPageRungOf(row.artifact.path) === 'stills'),
  ]);
  const rest = rows.filter((row) => !placed.has(row));
  const shown: ProjectPageRung[] = [
    { key: 'plan', rows: rows.filter((row) => row.on === 'plan') },
    { key: 'decisions', rows: rows.filter((row) => row.on === 'decision' && row.state === 'open') },
    { key: 'project', rows: rows.filter((row) => row.on === 'project') },
    { key: 'animatic', rows: animatic ? [animatic] : [] },
    { key: 'cut', rows: cuts },
    { key: 'stills', rows: files.filter((row) => projectPageRungOf(row.artifact.path) === 'stills'), folders: true },
    { key: 'waiting', rows: rest.filter((row) => rowThreadsWaiting(row) > 0) },
  ];
  return { shown: shown.filter((rung) => rung.rows.length > 0), folded: rest.filter((row) => rowThreadsWaiting(row) === 0) };
}

/**
 * The grid's sections: the cards (plan, decisions, the project's notes) side by side, then the loose files as one grid,
 * then each folder. A rung of one item would stand alone in a row of empty grid, so only folders get a section each.
 */
function projectPageGridSections(shown: readonly ProjectPageRung[]): ProjectPageRung[] {
  const loose = shown.filter((rung) => !rung.folders).flatMap((rung) => rung.rows);
  return [
    { key: 'cards', rows: loose.filter((row) => row.on !== 'file') },
    { key: 'files', rows: loose.filter((row) => row.on === 'file') },
    ...shown.filter((rung) => rung.folders),
  ].filter((section) => section.rows.length > 0);
}

/** `14 older work files`, and the settled decisions folded with them. */
function foldedLabelOf(folded: readonly ReviewProjectRow[]): string {
  const files = folded.filter((row) => row.on === 'file').length, decisions = folded.length - files;
  return [
    files > 0 && `${files} older work file${files === 1 ? '' : 's'}`,
    decisions > 0 && `${decisions} settled decision${decisions === 1 ? '' : 's'}`,
  ].filter(Boolean).join(', ');
}

const stillsIn = (rows: readonly ReviewProjectRow[]) => rows.filter((row) => row.on === 'file' && row.artifact.kind === 'still').length;

/** Rows split into runs by folder, each under its label, in the order their folders first appear; other rows whole. */
function folderRuns(rows: readonly ReviewProjectRow[]): { label?: string; rows: ReviewProjectRow[] }[] {
  const runs = new Map<string | undefined, ReviewProjectRow[]>();
  for (const row of rows) {
    // `/` names the project's root, so its files don't read as the folder labelled above them.
    const label = row.on === 'file' ? projectFileFolderOf(row.artifact.path) || '/' : undefined;
    runs.set(label, [...(runs.get(label) ?? []), row]);
  }
  return [...runs].map(([label, run]) => ({ label, rows: run }));
}

type ProjectRowsProps = {
  readonly summary: ReviewProjectSummary;
  readonly now: number;
  readonly rows: readonly ReviewProjectRow[];
  readonly folders: boolean;
  readonly view: StudioCollectionView;
};

/** A run's items: rows in the list's columns, or tiles in a grid of their own across it. */
function ProjectPageItems({ summary, now, rows, folderLabelled, view }: Omit<ProjectRowsProps, 'folders'> & { readonly folderLabelled: boolean }) {
  const items = rows.map((row) => <ProjectPlace key={projectPlaceKeyOf(row)} summary={summary} row={row} now={now} folderLabelled={folderLabelled} layout={view === 'grid' ? 'tile' : 'row'} />);
  return view === 'grid' ? <Box {...stylex.props(projectTileGridStyles.grid)}>{items}</Box> : items;
}

function ProjectPageRows({ summary, now, rows, folders, view }: ProjectRowsProps) {
  const { project } = summary;
  if (!folders) return <ProjectPageItems summary={summary} now={now} rows={rows} folderLabelled={false} view={view} />;
  return folderRuns(rows).map((run) => (
    <Fragment key={run.label ?? ''}>
      {run.label && <ProjectRowGroupLabel>{run.label}</ProjectRowGroupLabel>}
      {/* The grid view shows the folder's stills right here, so the row that opens them as a grid is the list's alone. */}
      {view === 'list' && run.label && run.label !== '/' && stillsIn(run.rows) > 1 && <ProjectStillsFolderRow project={project} folder={run.label} stills={stillsIn(run.rows)} />}
      <ProjectPageItems summary={summary} now={now} rows={run.rows} folderLabelled={run.label !== undefined} view={view} />
    </Fragment>
  ));
}

/**
 * A project's page beside the sidebar, by rung (projectPageRungs), a rule between rungs, and its older work folded into
 * one row that opens in place: each run as rows or tiles, as the studio's list-or-grid choice says. The title's counts
 * open each state's first thread.
 */
export function ProjectPage({ project }: { readonly project: string }) {
  const { summary, now } = useProjectSummary(project);
  const listRef = useRef<HTMLDivElement>(null);
  const [olderShown, setOlderShown] = useState(false);
  const { view } = useStudioCollectionView();
  useProjectRowHotkeys(listRef);
  const rungs = projectPageRungs(summary.rows), { folded } = rungs;
  const shown = view === 'grid' ? projectPageGridSections(rungs.shown) : rungs.shown;
  return (
    <StudioShell>
      <StudioPageTitle count={<Group component="span" gap="gap" wrap="nowrap"><ProjectThreadCounts threads={summary.threads} linkedTo={summary} /></Group>} end={<StudioCollectionViewToggle />}>
        <ProjectName project={project} />
      </StudioPageTitle>
      <FadeScroll>
        <Box ref={listRef} {...stylex.props(projectListStyles.list, stylex.defaultMarker())}>
          {summary.rows.length === 0 && <Text size="sm" {...stylex.props(projectListStyles.span, styles.empty)}><Code>studio render {project}</Code></Text>}
          {shown.map((rung, i) => (
            <Fragment key={rung.key}>
              {i > 0 && <Box aria-hidden {...stylex.props(projectListStyles.span, styles.rule)} />}
              <ProjectPageRows summary={summary} now={now} rows={rung.rows} folders={rung.folders ?? false} view={view} />
            </Fragment>
          ))}
          {folded.length > 0 && (
            <>
              {shown.length > 0 && <Box aria-hidden {...stylex.props(projectListStyles.span, styles.rule)} />}
              <ProjectRowButton
                expanded={olderShown} onToggle={() => setOlderShown((was) => !was)}
                thumbnail={<ProjectThumbnail glyph={olderShown ? <ChevronDown size={14} /> : <ChevronRight size={14} />} />}
                title={<Text component="span" inherit {...stylex.props(styles.dim)}>{foldedLabelOf(folded)}</Text>}
              />
              {olderShown && <ProjectPageRows summary={summary} now={now} rows={folded} folders view={view} />}
            </>
          )}
        </Box>
      </FadeScroll>
    </StudioShell>
  );
}
