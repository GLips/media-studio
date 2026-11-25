import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  clock: { position: 'relative', display: 'inline-flex', alignItems: 'baseline', gap: spacing.tight },
  // The exact form lies over what follows, on the raised ground, so nothing beside the time shifts as it shows.
  exact: {
    position: 'absolute', insetBlock: 0, insetInlineStart: `calc(-1 * ${spacing.tight})`, zIndex: 1, alignItems: 'center',
    gap: spacing.tight, display: { default: 'none', [stylex.when.ancestor(':hover')]: 'flex' },
    paddingInline: spacing.tight, borderRadius: radius.control, backgroundColor: colors.raised, whiteSpace: 'nowrap',
  },
});

type LibraryClockHoverProps = {
  /** Times to the second, `m:ss`: what reads at rest. */
  readonly whole: ReactNode;
  /** The same to the hundredth, shown while the pointer is over it or a marked ancestor (`stylex.defaultMarker()`). */
  readonly exact: ReactNode;
};

/** The library's times: to the second at rest, the hundredths under the pointer, where they're wanted to place a cut. */
export function LibraryClockHover({ whole, exact }: LibraryClockHoverProps) {
  return (
    <Box component="span" {...stylex.props(styles.clock, stylex.defaultMarker())}>
      {whole}
      <Box component="span" aria-hidden {...stylex.props(styles.exact)}>{exact}</Box>
    </Box>
  );
}
