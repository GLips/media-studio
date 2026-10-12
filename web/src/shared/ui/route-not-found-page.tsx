import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { RouteFailureCrumbs } from './route-failure-crumbs.tsx';
import { StudioShell } from './studio-shell.tsx';
import { colors, spacing } from './theme.stylex.ts';

const styles = stylex.create({
  // Inset as a list's rows are (the list's padding plus the row's), so the line starts where a page's rows do.
  body: { paddingBlock: spacing.inset, paddingInline: `calc(${spacing.gap} * 2)`, color: colors.dim },
});

/** The router's default for a URL no route matches, or a route that throws notFound(): the shell, so `◂` leads out. */
export function RouteNotFoundPage() {
  return (
    <StudioShell start={<RouteFailureCrumbs />}>
      <Text size="md" {...stylex.props(styles.body)}>Nothing here.</Text>
    </StudioShell>
  );
}
