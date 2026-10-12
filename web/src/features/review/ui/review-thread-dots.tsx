import { Box, Group } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { PlacedReviewThread } from '#lib/output/review/models/review-placement.ts';
import { reviewThreadTone } from '#lib/output/review/models/review-threads.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { shadows } from '#web/shared/ui/shadows.ts';
import { colors, radius } from '#web/shared/ui/theme.stylex.ts';
import { useReviewPlacedThreads } from './use-review-placed-threads.ts';

/** Past this many, the rest are a count. */
const REVIEW_THREAD_DOTS_SHOWN = 6;

const styles = stylex.create({
  dot: { width: '6px', height: '6px', borderRadius: radius.pill, flexShrink: 0 },
  open: { backgroundColor: colors.accent },
  addressed: { backgroundColor: colors.pass },
  asks: { backgroundColor: colors.caution },
});

/** A thread's dot, by what it waits on; resolved and `keep` threads, waiting on no one's work, get none. */
function reviewThreadDotToneOf(thread: PlacedReviewThread) {
  const tone = reviewThreadTone(thread);
  return tone === 'resolved' || tone === 'keep' ? null : tone;
}

const placedFrameOf = ({ placement }: PlacedReviewThread) => ('frame' in placement ? placement.frame : undefined);

type ReviewThreadDotsProps = {
  /** The file whose threads these are: the open render, or a still beside it. */
  readonly path: string;
  /** Only threads placed on frames from `from` up to `to`, exclusive: a scene's. Absent, every placed thread. */
  readonly frames?: { from: number; to: number };
};

/**
 * A dot per live thread in its state's colour, the Board's and the grid's hint of where the notes are. Decoration: it
 * reacts to nothing, and the thread panel is where they're read.
 */
export function ReviewThreadDots({ path, frames }: ReviewThreadDotsProps) {
  const threads = useReviewPlacedThreads(path);
  const tones = threads.flatMap((thread) => {
    const frame = placedFrameOf(thread);
    if (frames && (frame === undefined || frame < frames.from || frame >= frames.to)) return [];
    // Only notes on the file itself: a project or decision thread places everywhere, and would dot every tile.
    if (thread.anchor.on !== 'video' && thread.anchor.on !== 'still') return [];
    if (!frames && 'unplaced' in thread.placement) return [];
    const tone = reviewThreadDotToneOf(thread);
    return tone ? [{ id: thread.id, tone }] : [];
  });
  if (!tones.length) return null;
  const more = tones.length - REVIEW_THREAD_DOTS_SHOWN;
  return (
    <Group gap="hairline" wrap="nowrap" aria-hidden>
      {tones.slice(0, REVIEW_THREAD_DOTS_SHOWN).map(({ id, tone }) => <Box key={id} {...stylex.props(styles.dot, shadows.groundRing, styles[tone])} />)}
      {more > 0 && <Readout>+{more}</Readout>}
    </Group>
  );
}
