import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { REVIEW_READOUT_CHAR_PX, reviewRulerTicks, reviewTimelineSpan, type ReviewTimelineView } from '#lib/output/review/models/review-timeline-geometry.ts';
import { colors, fonts, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { reviewGhostTimeOf, useReviewHoverFrame, type ReviewDockHover } from './review-hover-preview.tsx';
import { reviewPlayheadFlagSpanOf } from './review-lane-playhead.tsx';
import { useReviewPlaybackState } from './review-playback-store.ts';
import { useReviewFrame, useReviewScreen } from './review-screen-context.tsx';

const styles = stylex.create({
  lane: { position: 'relative', height: '100%', overflow: 'hidden' },
  tick: { position: 'absolute', bottom: 0, width: '1px', backgroundColor: colors.mark, pointerEvents: 'none' },
  timeTick: { height: spacing.tight },
  beat: { height: spacing.hairline },
  downbeat: { height: spacing.tight, backgroundColor: colors.dim },
  label: {
    position: 'absolute', top: 0, paddingLeft: spacing.hairline, fontFamily: fonts.mono, lineHeight: typography.lineHeight, color: colors.dim, whiteSpace: 'nowrap', pointerEvents: 'none',
  },
  // A bracket over the loop's span: its top edge with a foot at each end.
  loop: {
    position: 'absolute', top: 0, height: spacing.tight, pointerEvents: 'none',
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.cream,
    borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.cream,
    borderRightWidth: '1px', borderRightStyle: 'solid', borderRightColor: colors.cream,
  },
  at: (left: string) => ({ left }),
  span: (left: string, width: string) => ({ left, width }),
});

/**
 * The timecode across the top, a label wherever it has room, the music's beats as ticks under it (taller on
 * downbeats) and a bracket over the loop; the marked range's wash is the dock's. A label under the resting
 * playhead's `▼300` flag or the pointer's ghost time is left out.
 */
export function ReviewLaneRuler({ view, hover }: { readonly view: ReviewTimelineView; readonly hover: ReviewDockHover }) {
  const { artifact, timing, playback } = useReviewScreen();
  const loop = useReviewPlaybackState(playback, (s) => s.loop);
  const ticks = reviewRulerTicks(view, { fps: timing.fps, beats: artifact.marks?.beats ?? [] });
  // Stepping by a few frames, a tick between seconds is named by its frame, as the flag and the transport count:
  // hundredths at a 2-frame step would read 0:09.60, 0:09.66, 0:09.73.
  const times = ticks.filter((t) => t.kind === 'time');
  const byFrame = times.length > 1 && times[1].frame - times[0].frame < timing.fps / 2;
  const labelOf = (tick: { frame: number; label: string }) => (byFrame && tick.frame % timing.fps !== 0 ? `f${tick.frame}` : tick.label);
  const loopSpan = loop && reviewTimelineSpan(view, loop.from, loop.to + 1);
  const frame = useReviewFrame();
  const playing = useReviewPlaybackState(playback, (s) => s.playing);
  const hovered = useReviewHoverFrame(view, hover);
  const covers = [
    ...(playing ? [] : [reviewPlayheadFlagSpanOf(view, artifact, frame, timing.fps)]),
    ...(hovered === null ? [] : [reviewGhostTimeOf(view, hovered, timing.fps)]),
  ];
  const covered = (x: number, label: string) => covers.some((c) => x < c.end && x + (label.length + 1) * REVIEW_READOUT_CHAR_PX > c.x);
  return (
    <Box {...stylex.props(styles.lane)}>
      {ticks.map((tick) => tick.kind === 'time'
        ? (
          <Box key={`t${tick.frame}`}>
            <Box {...stylex.props(styles.tick, styles.timeTick, styles.at(`${tick.x}px`))} />
            {/* The start needs no `0:00`, and the playhead's flag sits there at rest. */}
            {tick.frame > 0 && !covered(tick.x, labelOf(tick)) && <Text component="span" fz="xs" {...stylex.props(styles.label, styles.at(`${tick.x}px`))}>{labelOf(tick)}</Text>}
          </Box>
        )
        : <Box key={`b${tick.frame}`} {...stylex.props(styles.tick, tick.kind === 'downbeat' ? styles.downbeat : styles.beat, styles.at(`${tick.x}px`))} />)}
      {loopSpan && <Box {...stylex.props(styles.loop, styles.span(`${loopSpan.x}px`, `${loopSpan.w}px`))} />}
    </Box>
  );
}
