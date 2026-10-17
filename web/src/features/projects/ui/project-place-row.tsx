import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { MessageSquare, ScrollText, Split } from 'lucide-react';
import type { ReactNode } from 'react';
import { reviewPlanScenesAwaitYou, type ReviewProjectRow, type ReviewProjectSummary } from '#lib/output/review/models/review-dashboard.ts';
import { useProjectPlanSignoffs, type ProjectPlanSignoffs } from '#web/features/storyboard/index.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';
import { ProjectAge } from './project-age.tsx';
import { ProjectRow, type ProjectRowTarget } from './project-row.tsx';
import { ProjectThumbnail } from './project-thumbnail.tsx';

const styles = stylex.create({
  dim: { color: colors.dim },
  settled: { fontFamily: fonts.mono, color: colors.dim, cursor: 'default' },
});

const GLYPH_SIZE = 14;

/** `✓` after a settled decision or a fully signed plan, its word in the tooltip. What still waits tints its glyph instead. */
function SettledMark({ name }: { readonly name: string }) {
  return (
    <HotkeyTooltip name={name}>
      <Text component="span" size="sm" {...stylex.props(styles.settled)}>✓</Text>
    </HotkeyTooltip>
  );
}

type PlaceView = { target: ProjectRowTarget; thumbnail: ReactNode; title: ReactNode; marks?: ReactNode; end?: ReactNode };

type PlanRow = Extract<ReviewProjectRow, { on: 'plan' }>;

/** The plan's latest step, which its row's age counts from: every scene signed off, else handed over, else written. */
function planLatestStepOf(row: PlanRow, allSigned: boolean): { at: string; what: string } {
  const lastSigned = row.signoffs.map((s) => s.at).toSorted().at(-1);
  if (allSigned && lastSigned !== undefined) return { at: lastSigned, what: 'signed off' };
  if (row.handedOverAt !== null) return { at: row.handedOverAt, what: 'handed over' };
  return { at: row.modified, what: 'written' };
}

/**
 * `plan · 3 of 4 signed`, and what waits in its glyph's tooltip: a scene changed since signed off, or one unsigned once
 * the plan has been handed over. Until the storyboard resolves, or when it doesn't, the row says `plan` alone and
 * waits on nothing.
 */
function planViewOf(project: string, row: PlanRow, signoffs: ProjectPlanSignoffs | null, now: number): PlaceView {
  const signed = signoffs?.filter((s) => s.state === 'signed').length ?? 0;
  const stale = signoffs?.filter((s) => s.state === 'stale').length ?? 0;
  const all = signoffs !== null && signoffs.length > 0 && signed === signoffs.length;
  const unsettled = stale > 0 ? `${stale} scene${stale === 1 ? '' : 's'} changed since signed off` : 'scenes not signed off';
  const waiting = reviewPlanScenesAwaitYou(row, signoffs) ? unsettled : undefined;
  const { at, what } = planLatestStepOf(row, all);
  return {
    target: { project, on: 'plan' },
    thumbnail: <ProjectThumbnail glyph={<ScrollText size={GLYPH_SIZE} />} waiting={waiting} />,
    title: <>plan{signoffs !== null && <Text component="span" inherit {...stylex.props(styles.dim)}> · {signed} of {signoffs.length} signed</Text>}</>,
    marks: all ? <SettledMark name="every scene signed off" /> : undefined,
    end: <ProjectAge now={now} at={at} what={what} />,
  };
}

/** A file's folder with its trailing slash (`out/stills/`), or `''` at the project's root. */
export const projectFileFolderOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

function placeViewOf({ project, rows }: ReviewProjectSummary, row: Exclude<ReviewProjectRow, PlanRow>, now: number, folderLabelled: boolean): PlaceView {
  switch (row.on) {
    case 'file': {
      const { path, modified } = row.artifact, folder = projectFileFolderOf(path);
      return {
        target: { project, on: 'file', path },
        thumbnail: <ProjectThumbnail key={row.thumbnail.kind === 'video' ? row.thumbnail.hash : path} project={project} thumbnail={row.thumbnail} />,
        title: <>{!folderLabelled && <Text component="span" inherit {...stylex.props(styles.dim)}>{folder}</Text>}{path.slice(folder.length)}</>,
        end: <ProjectAge now={now} at={modified} what={row.artifact.kind === 'video' ? 'rendered' : 'made'} />,
      };
    }
    case 'decision': {
      const open = row.state === 'open';
      return {
        target: { project, on: 'decision', topic: row.topic },
        thumbnail: <ProjectThumbnail glyph={<Split size={GLYPH_SIZE} />} waiting={open ? 'not decided' : undefined} />,
        title: <>{row.topic} <Text component="span" inherit {...stylex.props(styles.dim)}>{row.question}</Text></>,
        marks: open ? undefined : <SettledMark name="decided" />,
        end: <ProjectAge now={now} at={row.at} what={open ? 'posted' : 'decided'} />,
      };
    }
    default: {
      // 'project': notes on the whole project, or whose place is gone; they're read beside the newest video (not a still).
      const newest = rows.find((r) => r.on === 'file' && r.artifact.kind === 'video');
      return {
        target: newest?.on === 'file' ? { project, on: 'file', path: newest.artifact.path } : { project, on: 'project' },
        thumbnail: <ProjectThumbnail glyph={<MessageSquare size={GLYPH_SIZE} />} />,
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

type ProjectPlaceRowProps = {
  readonly summary: ReviewProjectSummary;
  readonly row: ReviewProjectRow;
  /** When the summary was read, which the ages count back from. */
  readonly now: number;
  /** The file's folder is labelled over its run of rows, so the row shows the file's name alone. */
  readonly folderLabelled?: boolean;
};

/** A file, decision, the plan or the project's own notes, as a project's page and the dashboard's awaiting list show it. */
export function ProjectPlaceRow({ summary, row, now, folderLabelled = false }: ProjectPlaceRowProps) {
  if (row.on === 'plan') return <ProjectPlanPlaceRow project={summary.project} row={row} now={now} />;
  const { target, thumbnail, title, marks, end } = placeViewOf(summary, row, now, folderLabelled);
  return <ProjectRow target={target} thumbnail={thumbnail} title={title} threads={row.threads} marks={marks} end={end} />;
}

function ProjectPlanPlaceRow({ project, row, now }: { readonly project: string; readonly row: PlanRow; readonly now: number }) {
  const { target, thumbnail, title, marks, end } = planViewOf(project, row, useProjectPlanSignoffs(project, row.signoffs), now);
  return <ProjectRow target={target} thumbnail={thumbnail} title={title} threads={row.threads} marks={marks} end={end} />;
}
