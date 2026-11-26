import type { ReviewProjectRow, ReviewProjectSummary } from '#lib/output/review/models/review-dashboard.ts';
import type { StudioCollectionView } from '#web/shared/ui/use-studio-collection-view.ts';
import { ProjectPlace, projectFileFolderOf, projectPlaceKeyOf } from './project-place.tsx';
import { ProjectRowGroupLabel } from './project-row-group-label.tsx';
import { ProjectStillsFolderRow } from './project-stills-folder-row.tsx';
import { ProjectTileGrid } from './project-tile-grid.tsx';

type FileRow = Extract<ReviewProjectRow, { on: 'file' }>;

/**
 * A run under one heading; `base` is the folder its files' names leave out, `label` absent for a run with none.
 * `byTime` heads a run by when (the latest view's days): its files keep their whole paths and their order.
 */
export type ProjectPageRun = { label?: string; base: string; rows: ReviewProjectRow[]; byTime?: boolean };

/** `/` names the project's root, so its files don't read as the folder labelled above them. */
export const projectFolderRunOf = (folder: string, rows: ReviewProjectRow[]): ProjectPageRun => ({ label: folder || '/', base: folder, rows });

/** Rows split into runs by folder, each under its label, in the order their folders first appear; other rows whole. */
export function projectFolderRuns(rows: readonly ReviewProjectRow[]): ProjectPageRun[] {
  const runs = new Map<string | undefined, ReviewProjectRow[]>();
  for (const row of rows) {
    const folder = row.on === 'file' ? projectFileFolderOf(row.artifact.path) : undefined;
    runs.set(folder, [...(runs.get(folder) ?? []), row]);
  }
  return [...runs].map(([folder, run]) => (folder === undefined ? { base: '', rows: run } : projectFolderRunOf(folder, run)));
}

const stillsIn = (rows: readonly ReviewProjectRow[]) => rows.filter((row) => row.on === 'file' && row.artifact.kind === 'still').length;

/** Audio has no picture to tile, so it stays a row in the grid too. */
const tiledInGrid = (row: ReviewProjectRow): row is FileRow => row.on === 'file' && row.artifact.kind !== 'audio';

type ProjectPageRunViewProps = { readonly summary: ReviewProjectSummary; readonly now: number; readonly run: ProjectPageRun; readonly view: StudioCollectionView };

/**
 * A run under its heading. In the grid view only pictures become tiles, in grids of their own across the list: the
 * plan, decisions and notes are things to read and act on, and stay rows above them.
 */
function ProjectPageRunView({ summary, now, run, view }: ProjectPageRunViewProps) {
  const { project } = summary, folderLabelled = run.label !== undefined && run.byTime !== true;
  const files = run.rows.filter(tiledInGrid);
  const rowsShown = view === 'grid' ? run.rows.filter((row) => !tiledInGrid(row)) : run.rows;
  return (
    <>
      {run.label && <ProjectRowGroupLabel>{run.label}</ProjectRowGroupLabel>}
      {/* The grid view shows the folder's stills right here, so the row that opens them as a grid is the list's alone. */}
      {view === 'list' && folderLabelled && run.label !== '/' && stillsIn(run.rows) > 1 && <ProjectStillsFolderRow project={project} folder={run.label ?? ''} stills={stillsIn(run.rows)} />}
      {rowsShown.map((row) => <ProjectPlace key={projectPlaceKeyOf(row)} summary={summary} row={row} now={now} folderLabelled={folderLabelled} />)}
      {view === 'grid' && files.length > 0 && <ProjectTileGrid project={project} rows={files} now={now} base={run.base} newestFirst={run.byTime} />}
    </>
  );
}

type ProjectPageRunsViewProps = { readonly summary: ReviewProjectSummary; readonly now: number; readonly runs: readonly ProjectPageRun[]; readonly view: StudioCollectionView };

/** Runs one after another, each under its heading (ProjectPageRunView). */
export function ProjectPageRunsView({ summary, now, runs, view }: ProjectPageRunsViewProps) {
  return runs.map((run) => <ProjectPageRunView key={run.label ?? ''} summary={summary} now={now} run={run} view={view} />);
}
