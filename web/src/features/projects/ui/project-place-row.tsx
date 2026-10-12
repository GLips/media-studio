import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { MessageSquare, ScrollText, Split } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ReviewProjectRow, ReviewProjectSummary } from '#lib/output/review/models/review-dashboard.ts';
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

/** `✓` after a settled decision or a signed script, its word in the tooltip. What still waits tints its glyph instead. */
function SettledMark({ name }: { readonly name: string }) {
  return (
    <HotkeyTooltip name={name}>
      <Text component="span" size="sm" {...stylex.props(styles.settled)}>✓</Text>
    </HotkeyTooltip>
  );
}

type PlaceView = { target: ProjectRowTarget; thumbnail: ReactNode; title: ReactNode; marks?: ReactNode; end?: ReactNode };

/** What waits on the reviewer in an unsigned script, said beside it and in its glyph's tooltip. */
const SCRIPT_WAITING = { signed: undefined, unsigned: 'not signed off', stale: 'changed since signed off' } as const;

/** A file's folder with its trailing slash (`out/stills/`), or `''` at the project's root. */
export const projectFileFolderOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

function placeViewOf({ project, rows }: ReviewProjectSummary, row: ReviewProjectRow, now: number, folderLabelled: boolean): PlaceView {
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
    case 'script': return {
      target: { project, on: 'script' },
      thumbnail: <ProjectThumbnail glyph={<ScrollText size={GLYPH_SIZE} />} waiting={SCRIPT_WAITING[row.signoff]} />,
      title: <>script <Text component="span" inherit {...stylex.props(styles.dim)}>{SCRIPT_WAITING[row.signoff]}</Text></>,
      marks: row.signoff === 'signed' ? <SettledMark name="signed off" /> : undefined,
      end: <ProjectAge now={now} at={row.at} what={row.signoff === 'signed' ? 'signed off' : 'written'} />,
    };
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
    case 'script': return 'script';
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

/** A file, decision, the script or the project's own notes, as a project's page and the dashboard's awaiting list show it. */
export function ProjectPlaceRow({ summary, row, now, folderLabelled = false }: ProjectPlaceRowProps) {
  const { target, thumbnail, title, marks, end } = placeViewOf(summary, row, now, folderLabelled);
  return <ProjectRow target={target} thumbnail={thumbnail} title={title} threads={row.threads} marks={marks} end={end} />;
}
