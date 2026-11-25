import { Box, Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { StudioSiblingName } from './studio-sibling-name.tsx';
import { spacing } from './theme.stylex.ts';

/**
 * The narrowest a tile's caption gets, so a name has room beside a narrow portrait picture. A grid sizes its columns
 * to the wider of this and its picture, and the picture sits at the tile's left edge.
 */
export const STUDIO_TILE_CAPTION_MIN_WIDTH = 140;

const styles = stylex.create({
  caption: { display: 'flex', flexDirection: 'column', gap: spacing.tight, minWidth: 0, width: '100%' },
  name: { minWidth: 0, fontWeight: 600 },
  meta: { minWidth: 0, minHeight: spacing.row },
  start: { minWidth: 0, overflow: 'hidden' },
  end: { marginInlineStart: 'auto', flexShrink: 0 },
});

type StudioTileCaptionProps = {
  /** Its name, relative to the heading over its grid. */
  readonly name: string;
  /** Every name in its grid, its own included: their shared start is left out (StudioSiblingName). */
  readonly siblings: readonly string[];
  /** The meta line's start: its state in a word. */
  readonly status?: ReactNode;
  /** The meta line's end: its age, or another readout. */
  readonly end?: ReactNode;
};

/**
 * Every grid tile's caption under its picture: the name on one line, its shared start dropped and its middle
 * truncated, whole in its tooltip; then one meta line, the state at its start and the age at its end, when it has either.
 */
export function StudioTileCaption({ name, siblings, status, end }: StudioTileCaptionProps) {
  return (
    <Box component="span" {...stylex.props(styles.caption)}>
      <Text component="span" size="md" {...stylex.props(styles.name)}><StudioSiblingName name={name} siblings={siblings} /></Text>
      {/* A tile with neither (a still in the review grid) draws no meta line, rather than an empty row under its name. */}
      {(status !== undefined || end !== undefined) && (
        <Group component="span" gap="gap" wrap="nowrap" {...stylex.props(styles.meta)}>
          <Group component="span" gap="gap" wrap="nowrap" {...stylex.props(styles.start)}>{status}</Group>
          <Group component="span" gap="gap" wrap="nowrap" {...stylex.props(styles.end)}>{end}</Group>
        </Group>
      )}
    </Box>
  );
}
