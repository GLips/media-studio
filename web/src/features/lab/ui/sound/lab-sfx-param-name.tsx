import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  name: { fontFamily: fonts.mono, color: colors.dim, marginLeft: '4px' },
});

/** lib/sfx's own name for a setting, quietly beside its plain-words hint. */
export function LabSfxParamName({ children }: { readonly children: ReactNode }) {
  return <Text component="code" size="xs" {...stylex.props(styles.name)}>{children}</Text>;
}
