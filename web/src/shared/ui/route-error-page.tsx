import { Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { RouteFailureCrumbs } from './route-failure-crumbs.tsx';
import { StudioShell } from './studio-shell.tsx';
import { colors, spacing } from './theme.stylex.ts';

const styles = stylex.create({
  // Inset as a list's rows are (the list's padding plus the row's), so the message starts where a page's rows do.
  body: { paddingBlock: spacing.inset, paddingInline: `calc(${spacing.gap} * 2)` },
  message: { color: colors.danger },
});

/** The router's default when a route's loader or component throws: the shell stays, so `◂` still leads out. */
export function RouteErrorPage({ error }: ErrorComponentProps) {
  return (
    <StudioShell start={<RouteFailureCrumbs />}>
      <Stack gap="gap" {...stylex.props(styles.body)}>
        <Text size="md" {...stylex.props(styles.message)}>{error.message}</Text>
      </Stack>
    </StudioShell>
  );
}
