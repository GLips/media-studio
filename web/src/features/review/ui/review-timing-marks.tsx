import { Box, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { formatReviewMoment } from '#lib/output/review/models/review-notes.ts';
import type { ReviewTimingMarks as ReviewTimingMarkList } from '#lib/output/review/models/review-storyboard.ts';
import { colors } from '#web/shared/ui/theme.stylex.ts';
import { formatTimelineMomentName } from './review-note-format.ts';

const styles = stylex.create({
  row: { position: 'relative', height: '18px' },
  beat: { position: 'absolute', bottom: 0, width: '1px', height: '5px', backgroundColor: colors.dim, opacity: 0.6, pointerEvents: 'none' },
  downbeat: { width: '2px', height: '10px', marginLeft: '-0.5px', backgroundColor: colors.cream, opacity: 0.9 },
  moment: {
    position: 'absolute', top: 0, width: '8px', height: '8px', marginLeft: '-4px', borderRadius: '50%',
    ':hover': { backgroundColor: colors.cream },
  },
  cue: { backgroundColor: colors.cue },
  replay: { backgroundColor: colors.replay, borderRadius: '1px' },
  landmark: { backgroundColor: colors.accent, borderRadius: '1px', transform: 'rotate(45deg)' },
  line: { backgroundColor: colors.dim },
  at: (left: string) => ({ left }),
});

type ReviewTimingMarksProps = {
  readonly marks: ReviewTimingMarkList;
  readonly fps: number;
  readonly pct: (frame: number) => string;
  readonly onSeek: (frame: number) => void;
};

/**
 * Each beat as a tick, the music's downbeats taller, and each cue, replay and landmark as a pin above them, titled in
 * timeline.ts's words. A pin seeks to its frame.
 */
export function ReviewTimingMarks({ marks, fps, pct, onSeek }: ReviewTimingMarksProps) {
  return (
    <Box {...stylex.props(styles.row)}>
      {marks.beats.map((b) => <Box key={b.frame} {...stylex.props(styles.beat, b.down && styles.downbeat, styles.at(pct(b.frame + 0.5)))} />)}
      {marks.moments.map((m) => (
        <UnstyledButton key={`${m.kind}:${m.scene}.${m.name}`} aria-label={`${m.kind} ${formatTimelineMomentName(m, m.scene)}`}
          title={`${m.kind} ${formatTimelineMomentName(m, m.scene)} · ${m.at} · ${formatReviewMoment(m.frame, fps)}`}
          {...stylex.props(styles.moment, styles[m.kind], styles.at(pct(m.frame + 0.5)))} onClick={() => onSeek(m.frame)} />
      ))}
    </Box>
  );
}
