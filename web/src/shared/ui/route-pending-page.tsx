import { Stack } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { SkeletonTile } from './skeleton-tile.tsx';
import { StudioShell } from './studio-shell.tsx';
import { spacing } from './theme.stylex.ts';

const styles = stylex.create({
  body: { padding: spacing.inset, height: '100%' },
});

/** The router's default while a route loads: the shell, and a frame-shaped skeleton where the screen will be. */
export function RoutePendingPage() {
  return (
    <StudioShell>
      <Stack gap="gap" {...stylex.props(styles.body)}>
        <SkeletonTile aspect={16 / 9} />
      </Stack>
    </StudioShell>
  );
}
