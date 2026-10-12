import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { StudioHeader } from './studio-header.tsx';
import { useStudioOverlays } from './studio-overlays.tsx';
import { spacing } from './theme.stylex.ts';

const styles = stylex.create({
  // The page never scrolls: no width cap, and the body's panels scroll inside themselves (FadeScroll).
  shell: { display: 'grid', gridTemplateRows: `${spacing.bar} minmax(0, 1fr)`, height: '100dvh', overflow: 'hidden' },
  body: { minHeight: 0, minWidth: 0, overflow: 'hidden' },
});

type StudioShellProps = {
  /** The bar's items after `◂`. */
  readonly start?: ReactNode;
  /** The bar's items before quick-open and the keys. */
  readonly end?: ReactNode;
  readonly children?: ReactNode;
};

/** Every screen's frame, error and loading pages included: the bar, and the body below it filling the window. */
export function StudioShell({ start, end, children }: StudioShellProps) {
  const { openCheatsheet, openQuickOpen } = useStudioOverlays();
  return (
    <Box {...stylex.props(styles.shell)}>
      <StudioHeader start={start} end={end} onQuickOpen={openQuickOpen} onCheatsheet={openCheatsheet} />
      <Box component="main" {...stylex.props(styles.body)}>{children}</Box>
    </Box>
  );
}
