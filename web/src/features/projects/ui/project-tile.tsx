import { Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReviewProjectRow } from '#lib/output/review/models/review-dashboard.ts';
import { StudioSiblingName } from '#web/shared/ui/studio-sibling-name.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ProjectAge } from './project-age.tsx';
import { ProjectTargetLink } from './project-target-link.tsx';
import { ProjectRowStatus } from './project-row-status.tsx';
import { ProjectThumbnail, type ProjectTileCell } from './project-thumbnail.tsx';

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
  name: { minWidth: 0, fontWeight: 600 },
  // One line under the name: the state at its start, the age at its end. A narrow portrait column drops the age to a
  // line of its own rather than spilling past the tile.
  meta: { minWidth: 0, minHeight: spacing.row, rowGap: 0 },
  end: { marginInlineStart: 'auto', flexShrink: 0 },
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
};

/**
 * A project page's grid item: a file's picture filling a cell of its grid's shape, the part of its name that tells it
 * from its siblings, then its one state word (ProjectRowStatus) and its age. It opens what its row would.
 */
export function ProjectTile({ project, row, now, name, siblings, cell }: ProjectTileProps) {
  const { artifact } = row;
  return (
    <ProjectTargetLink target={{ project, on: 'file', path: artifact.path }} xstyle={styles.tile}>
      <ProjectThumbnail project={project} thumbnail={row.thumbnail} tile={cell} />
      <Text component="span" size="md" {...stylex.props(styles.name)}><StudioSiblingName name={name} siblings={siblings} /></Text>
      <Group gap="gap" {...stylex.props(styles.meta)}>
        <ProjectRowStatus threads={row.threads} />
        <Group component="span" gap="gap" wrap="nowrap" {...stylex.props(styles.end)}>
          <ProjectAge now={now} at={artifact.modified} what={artifact.kind === 'video' ? 'rendered' : 'made'} />
        </Group>
      </Group>
    </ProjectTargetLink>
  );
}
