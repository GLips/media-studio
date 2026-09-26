import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { colors, fonts, typography } from './theme.stylex.ts';

const styles = stylex.create({
  readout: { fontFamily: fonts.mono, fontSize: typography.readout, color: colors.dim, letterSpacing: '0.04em' },
  label: { textTransform: 'uppercase' },
});

/** A HUD line: a frame number, a hash, a key hint. `label` sets it in capitals, as a heading over a readout. */
export function Readout({ children, label = false }: { readonly children: ReactNode; readonly label?: boolean }) {
  return (
    <Text component="span" {...stylex.props(styles.readout, label && styles.label)}>
      {children}
    </Text>
  );
}
