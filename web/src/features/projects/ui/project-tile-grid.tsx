import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import type { ReviewProjectRow } from '#lib/output/review/models/review-dashboard.ts';
import { studioNameGroupsOf, studioSortedBy } from '#web/shared/studio-collection-arrangement.ts';
import { StudioJustifiedRows } from '#web/shared/ui/studio-justified-rows.tsx';
import { StudioNameGroupHead } from '#web/shared/ui/studio-name-group-head.tsx';
import { STUDIO_TILE_CAPTION_MIN_WIDTH } from '#web/shared/ui/studio-tile-caption.tsx';
import { useStudioCollectionArrangement } from '#web/shared/ui/use-studio-collection-arrangement.ts';
import { spacing } from '#web/shared/ui/theme.stylex.ts';
import { projectThumbnailKeyOf, type ProjectTileCell } from './project-thumbnail.tsx';
import { ProjectTile } from './project-tile.tsx';

/** The shape a grid takes before any of its pictures has loaded: most renders' frame. */
export const PROJECT_TILE_GUESSED_ASPECT = 16 / 9;

/** A picture's height at most, so a pair of portrait renders leaves the first stills row on the first screen. */
const PROJECT_TILE_PICTURE_HEIGHT = 220;

/** A picture's width at most, so a panorama doesn't take the page. */
const PROJECT_TILE_PICTURE_MAX_WIDTH = 360;

/** A picture of `aspect` at PROJECT_TILE_PICTURE_HEIGHT: its width, to PROJECT_TILE_PICTURE_MAX_WIDTH. */
const projectTilePictureWidthOf = (aspect: number) => Math.round(Math.min(PROJECT_TILE_PICTURE_HEIGHT * aspect, PROJECT_TILE_PICTURE_MAX_WIDTH));

/** A justified row's height before it scales to fill the width: near the shape grids' picture height. */
const PROJECT_TILE_ROW_HEIGHT = 200;

/** spacing.gap and twice spacing.tight (a tile's padding), in px, as the justified rows' arithmetic needs them. */
const PROJECT_TILE_GAP = 8;
const PROJECT_TILE_INSET = 8;

export const projectTileGridStyles = stylex.create({
  // Inside the page's list, across every column, its tiles' edges under the rows' pictures. Columns are fixed at the
  // capped picture's width, or the caption's least where that's wider, and never stretch, so no picture grows past
  // PROJECT_TILE_PICTURE_HEIGHT; the slack stays at the row's end.
  grid: (aspect: number) => ({
    gridColumn: '1 / -1', display: 'grid', alignItems: 'start', gap: spacing.gap, paddingBlockEnd: spacing.gap,
    // A tile's padding (ProjectTile) sits around its picture, so the column carries it on top of the picture's width.
    gridTemplateColumns: `repeat(auto-fill, calc(${Math.max(projectTilePictureWidthOf(aspect), STUDIO_TILE_CAPTION_MIN_WIDTH)}px + 2 * ${spacing.tight}))`,
  }),
  // A name group's rows (or every tile's, ungrouped), across the list under its own head.
  // At the pictures' edge, inside the tiles' padding.
  head: { paddingInline: spacing.tight },
  justified: { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: spacing.tight, paddingBlockEnd: spacing.inset },
});

/**
 * Pictures' shapes as they load, kept for the session: a grid seen before opens at its pictures' shape rather than
 * the guess. Keyed by projectThumbnailKeyOf.
 */
const learnedPictureAspects = new Map<string, number>();

/** One shape's run of tiles; `aspect` null for the pictures not yet loaded, laid out at the guess until they are. */
type ProjectTileAspectRun = { aspect: number | null; indices: number[] };

/** Tiles by their pictures' shape (to two places), widest first, each keeping `order`; the unloaded last. */
function projectTileAspectRunsOf(order: readonly number[], aspects: readonly (number | undefined)[]): ProjectTileAspectRun[] {
  const byAspect = new Map<number, number[]>();
  const unread: number[] = [];
  for (const i of order) {
    const aspect = aspects[i];
    if (aspect === undefined) unread.push(i);
    else {
      const rounded = Math.round(aspect * 100) / 100;
      byAspect.set(rounded, [...(byAspect.get(rounded) ?? []), i]);
    }
  }
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
 * A run of files as tiles, grouped and ordered as the studio's grids are (useStudioCollectionArrangement). By shape, a
 * grid per shape as the stills grid has, so every picture fills its cell; by name or not at all, justified rows of
 * pictures at their own shapes. Names show what tells a group's files apart.
 */
export function ProjectTileGrid({ project, rows, now, base }: ProjectTileGridProps) {
  const { group, sort } = useStudioCollectionArrangement();
  const [, setLearned] = useState(0);
  const keys = rows.map((row) => projectThumbnailKeyOf(row.thumbnail));
  const names = rows.map((row) => (row.artifact.path.startsWith(base) ? row.artifact.path.slice(base.length) : row.artifact.path));
  const aspects = keys.map((key) => learnedPictureAspects.get(key));
  const onAspectOf = (key: string) => (learnt: number) => {
    if (learnedPictureAspects.get(key) === learnt) return;
    learnedPictureAspects.set(key, learnt);
    setLearned((n) => n + 1);
  };
  const order = studioSortedBy(rows.map((_, i) => i), sort, (i) => ({ name: names[i], modified: Date.parse(rows[i].artifact.modified) }));
  const tileOf = (i: number, cell: Omit<ProjectTileCell, 'onAspect'>, siblings: readonly string[], justified = false) => (
    <ProjectTile key={rows[i].artifact.path} project={project} row={rows[i]} now={now} name={names[i]} siblings={siblings}
      cell={{ ...cell, onAspect: onAspectOf(keys[i]) }} justified={justified} />
  );
  if (group === 'shape') {
    return projectTileAspectRunsOf(order, aspects).map(({ aspect, indices }) => {
      const cellAspect = aspect ?? PROJECT_TILE_GUESSED_ASPECT;
      return (
        <Box key={aspect ?? 'unread'} {...stylex.props(projectTileGridStyles.grid(cellAspect))}>
          {indices.map((i) => tileOf(i, { aspect: cellAspect, width: projectTilePictureWidthOf(cellAspect) }, names))}
        </Box>
      );
    });
  }
  const groups = group === 'name' ? studioNameGroupsOf(order, (i) => names[i]) : [{ head: '', items: order }];
  return groups.map(({ head, items }) => {
    const siblings = items.map((i) => names[i]);
    const shapes = items.map((i) => aspects[i] ?? PROJECT_TILE_GUESSED_ASPECT);
    return (
      <Box key={head || 'all'} {...stylex.props(projectTileGridStyles.justified)}>
        {head && <Box {...stylex.props(projectTileGridStyles.head)}><StudioNameGroupHead head={head} count={items.length} /></Box>}
        <StudioJustifiedRows aspects={shapes} target={PROJECT_TILE_ROW_HEIGHT} gap={PROJECT_TILE_GAP} tileInset={PROJECT_TILE_INSET}
          tileKeyOf={(at) => rows[items[at]].artifact.path}
          renderTile={(at, width) => tileOf(items[at], { aspect: shapes[at], width }, siblings, true)} />
      </Box>
    );
  });
}
