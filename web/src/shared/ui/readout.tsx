import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode, Ref } from 'react';
import { colors, fonts, typography } from './theme.stylex.ts';

const styles = stylex.create({
  readout: { fontFamily: fonts.mono, fontSize: typography.readout, lineHeight: typography.lineHeight, color: colors.dim, whiteSpace: 'nowrap' },
  bright: { color: colors.cream },
  // A changing figure held to its widest, so what follows it on the bar doesn't shift as it ticks.
  chars: (chars: number) => ({ display: 'inline-block', minWidth: `${chars}ch` }),
});

type ReadoutProps = {
  readonly children: ReactNode;
  /** Cream, as the figure that matters: the playhead's time. */
  readonly bright?: boolean;
  /** For a figure written straight into its node while playing, as the timecode is. */
  readonly ref?: Ref<HTMLSpanElement>;
  /** The most characters the figure ever takes, which it then always takes. */
  readonly chars?: number;
};

/** A HUD figure in mono: timecode, a frame number, a hash. */
export function Readout({ children, bright = false, ref, chars }: ReadoutProps) {
  return (
    <Text component="span" ref={ref} {...stylex.props(styles.readout, bright && styles.bright, chars !== undefined && styles.chars(chars))}>
      {children}
    </Text>
  );
}
