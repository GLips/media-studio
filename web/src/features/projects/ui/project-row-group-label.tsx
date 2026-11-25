import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { projectListStyles } from './project-row.tsx';

const styles = stylex.create({
  // A seam from the list's edge, and the label at the rows' own edge, so each run reads as a group under its head.
  label: {
    display: 'flex', alignItems: 'baseline', gap: spacing.gap, color: colors.cream, fontWeight: 600,
    paddingInline: spacing.gap, paddingBlockStart: spacing.inset, paddingBlockEnd: spacing.tight, marginBlockStart: spacing.gap,
    borderBlockStartWidth: '1px', borderBlockStartStyle: 'solid', borderBlockStartColor: colors.line,
  },
  count: { color: colors.dim, fontWeight: 400, fontVariantNumeric: 'tabular-nums' },
});

type ProjectRowGroupLabelProps = {
  readonly children: ReactNode;
  /** How many things in the run wait on the reviewer; none is left out. */
  readonly count?: number;
};

/** A heading over a run of rows (a project's in "Awaiting you", a folder's on a project's page), on a seam above them. */
export function ProjectRowGroupLabel({ children, count = 0 }: ProjectRowGroupLabelProps) {
  return (
    <Text component="h3" size="md" {...stylex.props(projectListStyles.span, styles.label)}>
      {children}
      {count > 0 && <Text component="span" size="sm" {...stylex.props(styles.count)}>{count}</Text>}
    </Text>
  );
}
