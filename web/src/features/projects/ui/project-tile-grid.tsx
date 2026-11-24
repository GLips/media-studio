import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import type { ReviewProjectRow } from '#lib/output/review/models/review-dashboard.ts';
import { spacing } from '#web/shared/ui/theme.stylex.ts';
import { projectThumbnailKeyOf } from './project-thumbnail.tsx';
import { ProjectTile } from './project-tile.tsx';

/** The shape a grid takes before any of its pictures has loaded: most renders' frame. */
export const PROJECT_TILE_GUESSED_ASPECT = 16 / 9;

/** A cell about this tall at its column's narrowest, so a phone-portrait grid isn't a wall of towers. */
const PROJECT_TILE_CELL_HEIGHT = 250;

export const projectTileGridStyles = stylex.create({
  // Inside the page's list, across every column, its tiles' edges under the rows' pictures. A narrow shape gets
  // narrow columns, so a cell's height stays near PROJECT_TILE_CELL_HEIGHT whatever the pictures' shape.
  grid: (aspect: number) => ({
    gridColumn: '1 / -1', display: 'grid', alignItems: 'start', gap: spacing.gap, paddingBlockEnd: spacing.gap,
    gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(Math.min(Math.max(PROJECT_TILE_CELL_HEIGHT * aspect, 140), 320))}px, 1fr))`,
  }),
});

/**
 * Pictures' shapes as they load, kept for the session: a grid seen before opens at its pictures' shape rather than
 * the guess. Keyed by projectThumbnailKeyOf.
 */
const learnedPictureAspects = new Map<string, number>();

/** One shape's run of tiles; `aspect` null for the pictures not yet loaded, laid out at the guess until they are. */
type ProjectTileAspectRun = { aspect: number | null; indices: number[] };

/** Tiles by their pictures' shape (to two places), widest first, each keeping its order; the unloaded last. */
function projectTileAspectRunsOf(aspects: readonly (number | undefined)[]): ProjectTileAspectRun[] {
  const byAspect = new Map<number, number[]>();
  const unread: number[] = [];
  aspects.forEach((aspect, i) => {
    if (aspect === undefined) unread.push(i);
    else {
      const rounded = Math.round(aspect * 100) / 100;
      byAspect.set(rounded, [...(byAspect.get(rounded) ?? []), i]);
    }
  });
  const groups: ProjectTileAspectRun[] = [...byAspect].toSorted(([a], [b]) => b - a).map(([aspect, indices]) => ({ aspect, indices }));
  return unread.length > 0 ? [...groups, { aspect: null, indices: unread }] : groups;
}

type FileRow = Extract<ReviewProjectRow, { on: 'file' }>;

type ProjectTileGridProps = {
  readonly project: string;
  readonly rows: readonly FileRow[];
  readonly now: number;
  /** The heading over it (`out/stills/`), which its tiles' names leave out. */
  readonly base: string;
};

/**
 * A run of files as tiles, split into a grid per shape as the stills grid is, so every picture fills its cell: a
 * phone-portrait run gets portrait cells, a wide one wide cells. Names show what tells the run's files apart.
 */
export function ProjectTileGrid({ project, rows, now, base }: ProjectTileGridProps) {
  const [, setLearned] = useState(0);
  const keys = rows.map((row) => projectThumbnailKeyOf(row.thumbnail));
  const names = rows.map((row) => (row.artifact.path.startsWith(base) ? row.artifact.path.slice(base.length) : row.artifact.path));
  const onAspectOf = (key: string) => (learnt: number) => {
    if (learnedPictureAspects.get(key) === learnt) return;
    learnedPictureAspects.set(key, learnt);
    setLearned((n) => n + 1);
  };
  return projectTileAspectRunsOf(keys.map((key) => learnedPictureAspects.get(key))).map(({ aspect, indices }) => {
    const cellAspect = aspect ?? PROJECT_TILE_GUESSED_ASPECT;
    return (
      <Box key={aspect ?? 'unread'} {...stylex.props(projectTileGridStyles.grid(cellAspect))}>
        {indices.map((i) => (
          <ProjectTile key={rows[i].artifact.path} project={project} row={rows[i]} now={now} name={names[i]} siblings={names}
            cell={{ aspect: cellAspect, onAspect: onAspectOf(keys[i]) }} />
        ))}
      </Box>
    );
  });
}
