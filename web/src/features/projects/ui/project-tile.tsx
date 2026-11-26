import * as stylex from '@stylexjs/stylex';
import type { ReviewProjectRow } from '#lib/output/review/models/review-dashboard.ts';
import { StudioTileCaption } from '#web/shared/ui/studio-tile-caption.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ProjectAge } from './project-age.tsx';
import { useProjectFileIsNew } from './project-file-new.tsx';
import { projectFileAgeWordOf } from '#lib/output/review/models/project-made.ts';
import { ProjectTargetLink } from './project-target-link.tsx';
import { ProjectRowStatus } from './project-row-status.tsx';
import { ProjectThumbnail, type ProjectTileCell } from './project-thumbnail.tsx';

const styles = stylex.create({
  tile: {
    // The picture at the tile's left edge; the caption takes the tile's whole width, which may be wider.
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: spacing.tight, minWidth: 0, padding: spacing.tight,
    color: colors.cream, textDecoration: 'none', borderRadius: radius.control,
    backgroundColor: {
      default: 'transparent',
      // As a row: while the keyboard holds a tile, hover lights no other. The grid's list carries the marker.
      ':hover': { default: colors.raised, [stylex.when.ancestor(':has([data-project-row]:focus-visible)')]: 'transparent' },
      ':focus-visible': colors.raised,
    },
    outlineColor: colors.cream, outlineStyle: 'solid', outlineOffset: '-1px', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  // In a justified row, as wide as its picture and its padding, so a long name truncates rather than widening it.
  justified: (pictureWidth: number) => ({ width: `calc(${pictureWidth}px + 2 * ${spacing.tight})`, flexShrink: 0 }),
});

type FileRow = Extract<ReviewProjectRow, { on: 'file' }>;

type ProjectTileProps = {
  readonly project: string;
  readonly row: FileRow;
  /** When the summary was read, which the age counts back from. */
  readonly now: number;
  /** Its path under its section's heading (`stills/`'s `detail.jpg`), and its siblings' likewise. */
  readonly name: string;
  readonly siblings: readonly string[];
  readonly cell: ProjectTileCell;
  /** In a justified row (StudioJustifiedRows), where the tile is held to its picture's width; in a grid, its column. */
  readonly justified?: boolean;
};

/**
 * A project page's grid item: a file's picture filling a cell of its grid's shape, then the studio's tile caption
 * (StudioTileCaption) with its one state word (ProjectRowStatus) and its age. It opens what its row would.
 */
export function ProjectTile({ project, row, now, name, siblings, cell, justified = false }: ProjectTileProps) {
  const { artifact } = row;
  const fresh = useProjectFileIsNew(artifact.path, artifact.modified);
  return (
    <ProjectTargetLink target={{ project, on: 'file', path: artifact.path }} xstyle={[styles.tile, justified && styles.justified(cell.width)]}>
      <ProjectThumbnail project={project} thumbnail={row.thumbnail} tile={cell} />
      <StudioTileCaption name={name} siblings={siblings} status={<ProjectRowStatus threads={row.threads} fresh={fresh} />}
        end={<ProjectAge now={now} at={artifact.modified} what={projectFileAgeWordOf(artifact)} />} />
    </ProjectTargetLink>
  );
}
