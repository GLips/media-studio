import { Box, Stack } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { spacing } from '#web/shared/ui/theme.stylex.ts';

const NARROW = '@media (max-width: 1100px)';

const styles = stylex.create({
  bench: {
    display: 'grid', gap: '20px', alignItems: 'start',
    gridTemplateColumns: { default: `minmax(0, 1fr) ${spacing.benchWidth}`, [NARROW]: '1fr' },
  },
  stage: { position: { default: 'sticky', [NARROW]: 'static' }, top: '12px' },
  controls: {
    position: { default: 'sticky', [NARROW]: 'static' }, top: '12px',
    maxHeight: { default: 'calc(100vh - 24px)', [NARROW]: 'none' }, overflowY: 'auto',
  },
});

/**
 * A stage with its controls beside it. The stage stays pinned while the controls scroll, so whatever a slider moves
 * is on screen as it moves. Below 1100px wide the controls drop under the stage.
 */
export function LabBench({ stage, children }: { readonly stage: ReactNode; readonly children: ReactNode }) {
  return (
    <Box {...stylex.props(styles.bench)}>
      <Box {...stylex.props(styles.stage)}>{stage}</Box>
      <Stack gap="sm" {...stylex.props(styles.controls)}>{children}</Stack>
    </Box>
  );
}
