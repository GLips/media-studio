import { Box, Stack } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  panel: { backgroundColor: colors.panel, borderRadius: radius.surface, padding: `${spacing.gap} ${spacing.inset}` },
  summary: { cursor: 'pointer', color: colors.dim },
});

/** The names and calls behind what a tab shows, folded away: an agent greps for them, a person needn't read them. */
export function LabForAgents({ children }: { readonly children: ReactNode }) {
  return (
    <Box component="details" {...stylex.props(styles.panel)}>
      <Box component="summary" {...stylex.props(styles.summary)}><Readout label>For agents</Readout></Box>
      <Stack gap="xs" mt="sm">{children}</Stack>
    </Box>
  );
}
