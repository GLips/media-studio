import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { studioSiblingNameOf } from '../studio-sibling-names.ts';
import { HotkeyTooltip } from './hotkey-tooltip.tsx';

const styles = stylex.create({
  name: { display: 'flex', minWidth: 0, whiteSpace: 'nowrap' },
  // The head gives way with an ellipsis, the tail never: the truncation falls in the name's middle.
  head: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  tail: { flexShrink: 0 },
});

type StudioSiblingNameProps = {
  readonly name: string;
  /** Every name in its run, its own included: their shared start is left out. */
  readonly siblings: readonly string[];
};

/**
 * A tile's name in a grid of its siblings: the part that tells it apart (studioSiblingNameOf), its end always in view,
 * the whole name in its tooltip. Inherits its size and weight.
 */
export function StudioSiblingName({ name, siblings }: StudioSiblingNameProps) {
  const { head, tail } = studioSiblingNameOf(name, siblings);
  return (
    <HotkeyTooltip name={name}>
      <Box component="span" {...stylex.props(styles.name)}>
        <Text component="span" inherit {...stylex.props(styles.head)}>{head}</Text>
        <Text component="span" inherit {...stylex.props(styles.tail)}>{tail}</Text>
      </Box>
    </HotkeyTooltip>
  );
}
