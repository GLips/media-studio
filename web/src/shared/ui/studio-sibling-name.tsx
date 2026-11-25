import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { studioSiblingNameOf } from '../studio-sibling-names.ts';
import { HotkeyTooltip } from './hotkey-tooltip.tsx';

const styles = stylex.create({
  name: { display: 'flex', minWidth: 0, whiteSpace: 'nowrap' },
  // The head gives way with an ellipsis, the tail never: the truncation falls in the name's middle.
  head: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  tail: { flexShrink: 0 },
  // Two lines: a tail that doesn't fit beside the head wraps under it, leaving the head the whole first line, so a
  // narrow tile never cuts the head to a letter. A tail wider than the tile gives way as a last resort.
  twoLines: { flexWrap: 'wrap', columnGap: 0 },
  wrappedTail: { minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' },
});

type StudioSiblingNameProps = {
  readonly name: string;
  /** Every name in its run, its own included: their shared start is left out. */
  readonly siblings: readonly string[];
  /** 2 lets the tail wrap under the head where the two don't fit on a line: a narrow column's name. 1 by default. */
  readonly lines?: 1 | 2;
};

/**
 * A tile's name in a grid of its siblings: the part that tells it apart (studioSiblingNameOf), its end always in view,
 * the whole name in its tooltip. Inherits its size and weight.
 */
export function StudioSiblingName({ name, siblings, lines = 1 }: StudioSiblingNameProps) {
  const { head, tail } = studioSiblingNameOf(name, siblings);
  return (
    <HotkeyTooltip name={name}>
      <Box component="span" {...stylex.props(styles.name, lines === 2 && styles.twoLines)}>
        <Text component="span" inherit {...stylex.props(styles.head)}>{head}</Text>
        <Text component="span" inherit {...stylex.props(styles.tail, lines === 2 && styles.wrappedTail)}>{tail}</Text>
      </Box>
    </HotkeyTooltip>
  );
}
