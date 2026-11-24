import { Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ProjectTargetLink, type ProjectRowTarget } from './project-target-link.tsx';
import type { ReviewProjectThumbnail } from '#lib/output/review/models/review-dashboard.ts';
import { ProjectThumbnail } from './project-thumbnail.tsx';

const styles = stylex.create({
  tile: {
    display: 'flex', flexDirection: 'column', gap: spacing.tight, minWidth: 0, padding: spacing.tight,
    color: colors.cream, textDecoration: 'none', borderRadius: radius.control,
    backgroundColor: {
      default: 'transparent',
      // As a row: while the keyboard holds a tile, hover lights no other. The grid's list carries the marker.
      ':hover': { default: colors.raised, [stylex.when.ancestor(':has([data-project-row]:focus-visible)')]: 'transparent' },
      ':focus-visible': colors.raised,
    },
    outlineColor: colors.cream, outlineStyle: 'solid', outlineOffset: '-1px', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  cell: { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  name: { fontWeight: 600 },
  // Always a line high, so tiles with no status keep their names on one baseline down a grid row.
  status: { minHeight: spacing.row, minWidth: 0 },
  end: { marginInlineStart: 'auto', flexShrink: 0 },
});

export const projectTileGridStyles = stylex.create({
  // Inside the page's list, across every column, its tiles' edges under the rows' pictures.
  grid: {
    gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', alignItems: 'start',
    gap: spacing.gap, paddingBlockEnd: spacing.gap,
  },
});

type ProjectTileProps = {
  readonly target: ProjectRowTarget;
  readonly project: string;
  /** The file's picture: a still's own bytes or a render's frame. */
  readonly thumbnail: ReviewProjectThumbnail;
  readonly title: ReactNode;
  /** Its state in plain words: `1 open note`, `1 to verify`. */
  readonly status?: ReactNode;
  /** Its age, at the status line's end. */
  readonly end?: ReactNode;
};

/**
 * A project page's grid item: a file's picture centred in a uniform cell, its name and its state under it. It opens
 * what its row would. Only files with pictures are tiles; the plan, decisions and notes stay rows in the grid view.
 */
export function ProjectTile({ target, project, thumbnail, title, status, end }: ProjectTileProps) {
  return (
    <ProjectTargetLink target={target} xstyle={styles.tile}>
      <ProjectThumbnail project={project} thumbnail={thumbnail} tile />
      <Text component="span" size="md" {...stylex.props(styles.cell, styles.name)}>{title}</Text>
      <Group gap="gap" wrap="nowrap" {...stylex.props(styles.status)}>
        {status}
        <Group component="span" gap="gap" wrap="nowrap" {...stylex.props(styles.end)}>{end}</Group>
      </Group>
    </ProjectTargetLink>
  );
}
