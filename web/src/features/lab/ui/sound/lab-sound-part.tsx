import { Box, Stack, Title } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  part: { paddingTop: spacing.gap, borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line },
  title: { fontStretch: '80%', textTransform: 'uppercase' },
});

/** One of the Sound tab's three parts: its number, its heading, and what it holds. */
export function LabSoundPart({ kicker, title, children }: { readonly kicker: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <Stack gap="md" component="section" {...stylex.props(styles.part)}>
      <Box component="header">
        <Readout label>{kicker}</Readout>
        <Title order={3} mt="hairline" {...stylex.props(styles.title)}>{title}</Title>
      </Box>
      {children}
    </Stack>
  );
}
