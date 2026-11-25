import { formatReviewClock, formatReviewClockRange } from '#lib/output/review/models/review-timeline-geometry.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { LibraryClockHover } from './library-clock-hover.tsx';

/** `m:ss`, the hundredths cut, as the transcript's line times read. */
const formatLibraryClockWhole = (seconds: number) => formatReviewClock(seconds).slice(0, -3);

type LibraryClockRangeProps = { readonly start: number; readonly end: number; readonly bright?: boolean };

/** A flag's range as `m:ss–m:ss`, or one time for an instant, to the hundredth under the pointer. */
export function LibraryClockRange({ start, end, bright = false }: LibraryClockRangeProps) {
  const whole = end > start ? `${formatLibraryClockWhole(start)}–${formatLibraryClockWhole(end)}` : formatLibraryClockWhole(start);
  return (
    <LibraryClockHover whole={<Readout bright={bright}>{whole}</Readout>} exact={<Readout bright={bright}>{formatReviewClockRange(start, end)}</Readout>} />
  );
}
