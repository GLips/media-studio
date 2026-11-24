import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { projectListStyles } from './project-row.tsx';

const styles = stylex.create({
  // Lines up with the rows' titles: the row's inset, the 64px thumbnail and the gap after it.
  label: {
    display: 'flex', alignItems: 'baseline', gap: spacing.gap, color: colors.cream, fontWeight: 600,
    paddingInlineStart: `calc(${spacing.gap} + 64px + ${spacing.inset})`, paddingBlockStart: spacing.inset, paddingBlockEnd: spacing.tight,
  },
  count: { color: colors.dim, fontWeight: 400, fontVariantNumeric: 'tabular-nums' },
});

type ProjectRowGroupLabelProps = {
  readonly children: ReactNode;
  /** How many things in the run wait on the reviewer; none is left out. */
  readonly count?: number;
};

/** A heading over a run of rows (a project's in "Awaiting you", a folder's on a project's page), set over their titles. */
export function ProjectRowGroupLabel({ children, count = 0 }: ProjectRowGroupLabelProps) {
  return (
    <Text component="h3" size="sm" {...stylex.props(projectListStyles.span, styles.label)}>
      {children}
      {count > 0 && <Text component="span" inherit {...stylex.props(styles.count)}>{count}</Text>}
    </Text>
  );
}
