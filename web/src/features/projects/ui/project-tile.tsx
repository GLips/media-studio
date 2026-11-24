import { Box, Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ProjectTargetLink, type ProjectRowTarget } from './project-target-link.tsx';
import { ProjectThumbnail, type ProjectThumbnailSource } from './project-thumbnail.tsx';

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
  // The plan, a decision or the project's notes has no picture: a card edged in a seam, its glyph beside its name.
  card: { borderWidth: '1px', borderStyle: 'solid', borderColor: colors.line, padding: spacing.gap },
  cell: { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  name: { fontWeight: 600 },
  glyph: { display: 'flex', flexShrink: 0, color: colors.dim },
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
  readonly thumbnail: ProjectThumbnailSource;
  readonly title: ReactNode;
  /** Under the name on a card: what a decision asks. */
  readonly detail?: ReactNode;
  /** Its state in plain words: `1 open note`, `1 to verify`. */
  readonly status?: ReactNode;
  /** Its age, at the status line's end. */
  readonly end?: ReactNode;
};

/**
 * A project page's grid item: a file as its picture in a uniform cell, its name and state under it; the plan, a
 * decision or the notes as a compact card. It opens what a row would.
 */
export function ProjectTile({ target, thumbnail, title, detail, status, end }: ProjectTileProps) {
  const statusLine = (
    <Group gap="gap" wrap="nowrap" {...stylex.props(styles.status)}>
      {status}
      <Group component="span" gap="gap" wrap="nowrap" {...stylex.props(styles.end)}>{end}</Group>
    </Group>
  );
  if (!thumbnail.thumbnail) {
    return (
      <ProjectTargetLink target={target} xstyle={[styles.tile, styles.card]}>
        <Group gap="gap" wrap="nowrap">
          <Box component="span" {...stylex.props(styles.glyph)}>{thumbnail.glyph}</Box>
          <Text component="span" size="md" {...stylex.props(styles.cell, styles.name)}>{title}</Text>
        </Group>
        {detail !== undefined && <Text component="span" size="sm" {...stylex.props(styles.cell)}>{detail}</Text>}
        {statusLine}
      </ProjectTargetLink>
    );
  }
  return (
    <ProjectTargetLink target={target} xstyle={styles.tile}>
      <ProjectThumbnail {...thumbnail} tile />
      <Text component="span" size="md" {...stylex.props(styles.cell, styles.name)}>{title}</Text>
      {statusLine}
    </ProjectTargetLink>
  );
}
