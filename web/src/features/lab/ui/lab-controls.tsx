import { Paper, SimpleGrid } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { radius } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  panel: { borderRadius: '12px', padding: '18px 20px' },
  inBench: { borderRadius: radius.surface },
});

/** The controls under a stage, in as many columns as fit; `stacked` keeps them in one, as a bench's column does. */
export function LabControls({ children, stacked = false }: { readonly children: ReactNode; readonly stacked?: boolean }) {
  return (
    <Paper {...stylex.props(styles.panel, stacked && styles.inBench)}>
      <SimpleGrid cols={stacked ? 1 : { base: 1, sm: 2, lg: 3 }} verticalSpacing={18} spacing={24}>{children}</SimpleGrid>
    </Paper>
  );
}
