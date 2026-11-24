import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { formatReviewClock, formatReviewClockRange } from '#lib/output/review/models/review-timeline-geometry.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  clock: { position: 'relative', display: 'inline-flex' },
  // The hundredths lie over what follows, on the raised ground, so nothing beside the time shifts as they show.
  exact: {
    position: 'absolute', insetBlock: 0, insetInlineStart: `calc(-1 * ${spacing.tight})`, zIndex: 1, alignItems: 'center',
    display: { default: 'none', [stylex.when.ancestor(':hover')]: 'flex' },
    paddingInline: spacing.tight, borderRadius: radius.control, backgroundColor: colors.raised,
  },
});

/** `m:ss`, the hundredths cut, as the transcript's line times read. */
const formatLibraryClockWhole = (seconds: number) => formatReviewClock(seconds).slice(0, -3);

type LibraryClockRangeProps = { readonly start: number; readonly end: number; readonly bright?: boolean };

/**
 * A flag's range as `m:ss–m:ss`, or one time for an instant; its hundredths show while the pointer is over the time
 * or over whatever marked ancestor holds it (`stylex.defaultMarker()`), as a flag's row does.
 */
export function LibraryClockRange({ start, end, bright = false }: LibraryClockRangeProps) {
  const whole = end > start ? `${formatLibraryClockWhole(start)}–${formatLibraryClockWhole(end)}` : formatLibraryClockWhole(start);
  return (
    <Box component="span" {...stylex.props(styles.clock, stylex.defaultMarker())}>
      <Readout bright={bright}>{whole}</Readout>
      <Box component="span" aria-hidden {...stylex.props(styles.exact)}><Readout bright={bright}>{formatReviewClockRange(start, end)}</Readout></Box>
    </Box>
  );
}
