import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useRef } from 'react';
import type { ReviewArtifact } from '#lib/output/review/models/review-artifact.ts';
import { formatReviewClock, REVIEW_READOUT_CHAR_PX, reviewTimelineFramePx, reviewTimelineSpan, reviewTimelineXOf, type ReviewTimelineView } from '#lib/output/review/models/review-timeline-geometry.ts';
import { useLinkedMediaTick } from '#web/shared/ui/linked-media-clock.ts';
import { colors, fonts, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { REVIEW_FRAME_VAR, useReviewPlaybackState, type ReviewLoopRange } from './review-playback-store.ts';
import { useReviewFrame, useReviewScreen } from './review-screen-context.tsx';

const styles = stylex.create({
  through: { position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' },
  cut: { position: 'absolute', top: 0, bottom: 0, width: '1px', backgroundColor: colors.line },
  wash: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.rangeWash },
  sketch: { borderWidth: '1px', borderStyle: 'dashed', borderColor: colors.cobalt },
  // A 2px cream line in a 1px ground halo, so it reads over a pale band as over the dark.
  line: {
    position: 'absolute', top: 0, bottom: 0, width: '2px', marginLeft: '-2px', boxSizing: 'content-box',
    backgroundColor: colors.cream, borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.ground,
    borderRightWidth: '1px', borderRightStyle: 'solid', borderRightColor: colors.ground,
  },
  // Cream ground, dark figures: the playhead's own head, so it never reads as one more ruler label beside it.
  // Over the lanes' own text, which a flag running down into the ruler's foot would otherwise sit under.
  flag: {
    position: 'absolute', top: 0, zIndex: 1, marginLeft: '-4px', paddingRight: spacing.hairline, whiteSpace: 'nowrap', borderRadius: radius.control,
    fontFamily: fonts.mono, lineHeight: typography.lineHeight, color: colors.ground, backgroundColor: colors.cream,
  },
  at: (left: string) => ({ left }),
  span: (left: string, width: string) => ({ left, width }),
});

/**
 * Where the playhead is across `view`, in CSS: the clock writes the frame to `--review-frame` each played frame, so the
 * line moves with no render. Its frame's middle, as a press there lands on it.
 */
export const reviewPlayheadLeft = (view: ReviewTimelineView) =>
  `calc((var(${REVIEW_FRAME_VAR}, 0) - ${view.start - 0.5}) * ${reviewTimelineFramePx(view)}px)`;

/**
 * The flag's words: `▼136` on a picture, whose frames are what a note pins; `▼0:04.12` on sound alone (the script's
 * take), where a frame number means nothing.
 */
export const reviewPlayheadFlagOf = (artifact: ReviewArtifact, frame: number, fps: number) =>
  `▼${artifact.frameSize === null ? formatReviewClock(frame / fps) : frame}`;

/** The flag's span across the ruler: 4px left of its frame's middle, its words plus padding. */
export function reviewPlayheadFlagSpanOf(view: ReviewTimelineView, artifact: ReviewArtifact, frame: number, fps: number) {
  const x = reviewTimelineXOf(view, frame + 0.5) - 4;
  return { x, end: x + (reviewPlayheadFlagOf(artifact, frame, fps).length + 1) * REVIEW_READOUT_CHAR_PX };
}

const spanStyle = (view: ReviewTimelineView, from: number, to: number) => {
  const span = reviewTimelineSpan(view, from, to);
  return span && styles.span(`${span.x}px`, `${span.w}px`);
};

type ReviewLanePlayheadProps = {
  readonly view: ReviewTimelineView;
  /** The range a drag is sketching, drawn as the draft's dashed edge. */
  readonly sketch: ReviewLoopRange | null;
};

/**
 * What runs through every lane: the cuts, the marked range and the loop as washes, the sketch, and over them the
 * playhead, drawn at rest as while playing, with a `▼136` flag in the ruler. While playing, the flag's number is
 * written straight into its node, as the line's place is.
 */
export function ReviewLanePlayhead({ view, sketch }: ReviewLanePlayheadProps) {
  const { artifact, search, timing, playback } = useReviewScreen();
  const frame = useReviewFrame();
  const playing = useReviewPlaybackState(playback, (s) => s.playing);
  const loop = useReviewPlaybackState(playback, (s) => s.loop);
  const number = useRef<HTMLSpanElement>(null);
  useLinkedMediaTick(playback, (now) => {
    if (number.current) number.current.textContent = reviewPlayheadFlagOf(artifact, now, timing.fps);
  }, playing);
  const marked = search.in !== undefined || search.out !== undefined
    ? spanStyle(view, search.in ?? 0, (search.out ?? timing.durationInFrames - 1) + 1)
    : null;
  const left = reviewPlayheadLeft(view);
  return (
    <Box {...stylex.props(styles.through)}>
      {(artifact.scenes ?? []).slice(1).map((scene) => <Box key={scene.id} {...stylex.props(styles.cut, styles.at(`${reviewTimelineXOf(view, scene.from)}px`))} />)}
      {marked && <Box {...stylex.props(styles.wash, marked)} />}
      {loop && <Box {...stylex.props(styles.wash, spanStyle(view, loop.from, loop.to + 1))} />}
      {sketch && <Box {...stylex.props(styles.wash, styles.sketch, spanStyle(view, sketch.from, sketch.to + 1))} />}
      <Box {...stylex.props(styles.line, styles.at(left))} />
      <Text component="span" ref={number} fz="xs" {...stylex.props(styles.flag, styles.at(left))}>{reviewPlayheadFlagOf(artifact, frame, timing.fps)}</Text>
    </Box>
  );
}
