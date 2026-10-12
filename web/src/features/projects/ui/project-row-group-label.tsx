import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  // Lines up with the rows' titles: the row's inset, the 64px thumbnail and the gap after it.
  label: { color: colors.dim, paddingInlineStart: `calc(${spacing.gap} + 64px + ${spacing.inset})`, paddingBlockStart: spacing.tight },
});

/** A dim heading over a run of rows (a project's in "Awaiting you", a folder's on a project's page), set over their titles. */
export function ProjectRowGroupLabel({ children }: { readonly children: ReactNode }) {
  return <Text component="h3" size="sm" {...stylex.props(styles.label)}>{children}</Text>;
}
