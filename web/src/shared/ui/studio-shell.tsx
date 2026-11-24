import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { StudioHeader } from './studio-header.tsx';
import { useInStudioSidebar } from './studio-sidebar.tsx';
import { useStudioOverlays } from './studio-overlays.tsx';
import { spacing } from './theme.stylex.ts';

const styles = stylex.create({
  // The page never scrolls: no width cap, and the body's panels scroll inside themselves (FadeScroll).
  shell: { display: 'grid', gridTemplateRows: `${spacing.bar} minmax(0, 1fr)`, height: '100dvh', overflow: 'hidden' },
  body: { minHeight: 0, minWidth: 0, overflow: 'hidden' },
  // A sidebar page's title row, then its scroll, which shrinks to the height the title leaves it.
  barless: { display: 'flex', flexDirection: 'column', height: '100dvh' },
});

type StudioShellProps = {
  /** The bar's items after `◂`. */
  readonly start?: ReactNode;
  /** The bar's items before quick-open and the keys. */
  readonly end?: ReactNode;
  readonly children?: ReactNode;
};

/**
 * Every screen's frame, error and loading pages included: the bar, and the body below it filling the window. Beside the
 * studio sidebar there's no bar, so `start` and `end` go unshown: the page's StudioPageTitle carries the bar's buttons.
 */
export function StudioShell({ start, end, children }: StudioShellProps) {
  const { openCheatsheet, openQuickOpen } = useStudioOverlays();
  if (useInStudioSidebar()) return <Box component="main" {...stylex.props(styles.body, styles.barless)}>{children}</Box>;
  return (
    <Box {...stylex.props(styles.shell)}>
      <StudioHeader start={start} end={end} onQuickOpen={openQuickOpen} onCheatsheet={openCheatsheet} />
      <Box component="main" {...stylex.props(styles.body)}>{children}</Box>
    </Box>
  );
}
