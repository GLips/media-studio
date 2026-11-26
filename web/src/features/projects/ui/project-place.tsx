import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { AudioLines, MessageSquare, ScrollText, Split } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ProjectMade } from '#lib/output/review/models/review-artifact.ts';
import { reviewNewestRenderRow, reviewPlanScenesAwaitYou, type ReviewProjectRow, type ReviewProjectSummary } from '#lib/output/review/models/review-dashboard.ts';
import { useProjectPlanSignoffs, type ProjectPlanSignoffs } from '#web/features/storyboard/index.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors } from '#web/shared/ui/theme.stylex.ts';
import { ProjectAge } from './project-age.tsx';
import { useProjectFileIsNew } from './project-file-new.tsx';
import { projectFileAgeWordOf, projectMadeDetailOf, projectMadeTitleOf } from '#lib/output/review/models/project-made.ts';
import { ProjectRow } from './project-row.tsx';
import type { ProjectRowTarget } from './project-target-link.tsx';
import { ProjectRowStatus, type ProjectPlaceState } from './project-row-status.tsx';
import { ProjectThumbnail, type ProjectThumbnailSource } from './project-thumbnail.tsx';

const styles = stylex.create({
  dim: { color: colors.dim },
});

const GLYPH_SIZE = 14;

type PlaceView = { target: ProjectRowTarget; thumbnail: ProjectThumbnailSource; title: ReactNode; detail?: ReactNode; state?: ProjectPlaceState; end?: ReactNode };

type PlanRow = Extract<ReviewProjectRow, { on: 'plan' }>;

/** The plan's latest step, which its row's age counts from: every scene signed off, else handed over, else written. */
function planLatestStepOf(row: PlanRow, allSigned: boolean): { at: string; what: string } {
  const lastSigned = row.signoffs.map((s) => s.at).toSorted().at(-1);
  if (allSigned && lastSigned !== undefined) return { at: lastSigned, what: 'signed off' };
  if (row.handedOverAt !== null) return { at: row.handedOverAt, what: 'handed over' };
  return { at: row.modified, what: 'written' };
}

/**
 * `plan  3 of 4 signed`, in caution while its scenes wait (one changed since signed off, or one unsigned once the plan
 * has been handed over). Until the storyboard resolves, or when it doesn't, the row says `plan` alone and waits on nothing.
 */
function planViewOf(project: string, row: PlanRow, signoffs: ProjectPlanSignoffs | null, now: number): PlaceView {
  const signed = signoffs?.filter((s) => s.state === 'signed').length ?? 0;
  const all = signoffs !== null && signoffs.length > 0 && signed === signoffs.length;
  const { at, what } = planLatestStepOf(row, all);
  return {
    target: { project, on: 'plan' },
    thumbnail: { glyph: <ScrollText size={GLYPH_SIZE} /> },
    title: 'plan',
    state: signoffs === null ? undefined : { words: `${signed} of ${signoffs.length} signed`, waiting: reviewPlanScenesAwaitYou(row, signoffs) },
    end: <ProjectAge now={now} at={at} what={what} />,
  };
}

/** Footage's settled state: whether its scene plays this take. */
const madeStateOf = (made: ProjectMade): ProjectPlaceState | undefined =>
  (made.as === 'footage' ? { words: made.plays ? 'plays in the cut' : 'not used', waiting: false } : undefined);

/** A file's folder with its trailing slash (`out/stills/`), or `''` at the project's root. */
export const projectFileFolderOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

function placeViewOf({ project, rows }: ReviewProjectSummary, row: Exclude<ReviewProjectRow, PlanRow>, now: number, folderLabelled: boolean): PlaceView {
  switch (row.on) {
    case 'file': {
      const { path, modified, made } = row.artifact, folder = projectFileFolderOf(path);
      const end = <ProjectAge now={now} at={modified} what={projectFileAgeWordOf(row.artifact)} />;
      const thumbnail: ProjectThumbnailSource = row.thumbnail.kind === 'audio' ? { glyph: <AudioLines size={GLYPH_SIZE} /> } : { project, thumbnail: row.thumbnail };
      if (made) return { target: { project, on: 'file', path }, thumbnail, title: projectMadeTitleOf(made, path), detail: projectMadeDetailOf(made), state: madeStateOf(made), end };
      return {
        target: { project, on: 'file', path }, thumbnail, end,
        title: <>{!folderLabelled && <Text component="span" inherit {...stylex.props(styles.dim)}>{folder}</Text>}{path.slice(folder.length)}</>,
      };
    }
    case 'decision': {
      const open = row.state === 'open';
      return {
        target: { project, on: 'decision', topic: row.topic },
        thumbnail: { glyph: <Split size={GLYPH_SIZE} /> },
        title: row.topic,
        detail: row.question,
        state: { words: open ? 'not decided' : 'decided', waiting: open },
        end: <ProjectAge now={now} at={row.at} what={open ? 'posted' : 'decided'} />,
      };
    }
    default: {
      // 'project': notes on the whole project, or whose place is gone; they're read beside the newest render.
      const newest = reviewNewestRenderRow(rows);
      return {
        target: newest?.on === 'file' ? { project, on: 'file', path: newest.artifact.path } : { project, on: 'project' },
        thumbnail: { glyph: <MessageSquare size={GLYPH_SIZE} /> },
        title: 'project notes',
        end: newest?.on === 'file' && <Readout>→ {newest.artifact.path}</Readout>,
      };
    }
  }
}

/** A row's key among its project's: a file by path, a decision by id. */
export function projectPlaceKeyOf(row: ReviewProjectRow): string {
  switch (row.on) {
    case 'file': return `file:${row.artifact.path}`;
    case 'decision': return `decision:${row.id}`;
    case 'plan': return 'plan';
    default: return 'project';
  }
}

type ProjectPlaceProps = {
  readonly summary: ReviewProjectSummary;
  readonly row: ReviewProjectRow;
  /** When the summary was read, which the ages count back from. */
  readonly now: number;
  /** The file's folder is labelled over its run, so the item shows the file's name alone. */
  readonly folderLabelled?: boolean;
};

/** A file, decision, the plan or the project's own notes, as a project's page and the dashboard's awaiting list show it. */
export function ProjectPlace({ summary, row, now, folderLabelled = false }: ProjectPlaceProps) {
  if (row.on === 'plan') return <ProjectPlanPlace project={summary.project} row={row} now={now} />;
  return <ProjectPlaceView view={placeViewOf(summary, row, now, folderLabelled)} row={row} />;
}

function ProjectPlanPlace({ project, row, now }: { readonly project: string; readonly row: PlanRow; readonly now: number }) {
  return <ProjectPlaceView view={planViewOf(project, row, useProjectPlanSignoffs(project, row.signoffs), now)} row={row} />;
}

type ProjectPlaceViewProps = { readonly view: PlaceView; readonly row: ReviewProjectRow };

function ProjectPlaceView({ view: { target, thumbnail, title, detail, state, end }, row }: ProjectPlaceViewProps) {
  const fresh = useProjectFileIsNew(row.on === 'file' ? row.artifact.path : '', row.on === 'file' ? row.artifact.modified : '');
  const status = <ProjectRowStatus threads={row.threads} state={state} fresh={row.on === 'file' && fresh} />;
  return <ProjectRow target={target} thumbnail={<ProjectThumbnail {...thumbnail} />} title={title} detail={detail} status={status} end={end} />;
}
