import { Box, Group } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Pause, Play } from 'lucide-react';
import type { PointerEvent } from 'react';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { DECISION_TIME_VAR, decisionTimeAxisOf, useDecisionPlaybackState } from './decision-playback.ts';
import { useDecisionScreen } from './decision-screen-context.tsx';

const styles = stylex.create({
  bar: {
    height: spacing.bar, paddingInline: spacing.tight, minWidth: 0,
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line, backgroundColor: colors.ground,
  },
  // The whole strip is the scrubber, not just its line.
  scrub: {
    position: 'relative', flex: 1, alignSelf: 'stretch', cursor: 'pointer', touchAction: 'none', minWidth: 0,
    outlineStyle: 'solid', outlineColor: colors.cream, outlineWidth: { default: 0, ':focus-visible': '1px' }, outlineOffset: '-1px',
  },
  track: { position: 'absolute', insetInline: 0, top: '50%', height: '1px', backgroundColor: colors.line },
  // The heard candidate's own length on the shared axis: past it, the others still run.
  extent: { position: 'absolute', left: 0, top: '50%', height: '1px', backgroundColor: colors.dim, pointerEvents: 'none' },
  extentTo: (share: number) => ({ width: `${share * 100}%` }),
  played: { position: 'absolute', insetBlock: 0, left: 0, backgroundColor: colors.rangeWash, pointerEvents: 'none' },
  head: { position: 'absolute', insetBlock: 0, width: spacing.hairline, backgroundColor: colors.cream, pointerEvents: 'none', translate: '-1px 0' },
  playedTo: (seconds: number) => ({ width: `calc(min(var(${DECISION_TIME_VAR}, 0) / ${seconds}, 1) * 100%)` }),
  headAt: (seconds: number) => ({ left: `calc(min(var(${DECISION_TIME_VAR}, 0) / ${seconds}, 1) * 100%)` }),
});

/**
 * The one transport every candidate shares: play, the heard candidate's key, the time and its length, and a scrubber
 * on the longest candidate's axis, as the waveforms are, so the head lines up with theirs and a swap moves nothing.
 */
export function DecisionTransport() {
  const { playback, focused } = useDecisionScreen();
  const playing = useDecisionPlaybackState(playback, (s) => s.playing);
  const length = useDecisionPlaybackState(playback, (s) => (focused === null ? undefined : s.durations[focused]));
  const seconds = useDecisionPlaybackState(playback, decisionTimeAxisOf);
  const time = useDecisionPlaybackState(playback, (s) => s.time);
  const { toggle, attachClock } = playback;
  const seekAt = (event: PointerEvent<HTMLElement>) => {
    if (seconds === undefined) return;
    const box = event.currentTarget.getBoundingClientRect();
    playback.seek(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * seconds);
  };
  return (
    <Group gap="gap" wrap="nowrap" {...stylex.props(styles.bar)}>
      <IconButton name="Play" onClick={toggle} active={playing}>{playing ? <Pause size={14} /> : <Play size={14} />}</IconButton>
      {focused !== null && <Readout bright>{focused.toUpperCase()}</Readout>}
      {/* Dim past the heard candidate's end: the time is the others', not one it plays at. */}
      <Readout bright={length === undefined || time <= length} ref={attachClock}>{formatReviewClock(time)}</Readout>
      {length !== undefined && <Readout>{formatReviewClock(length)}</Readout>}
      <Box
        role="slider"
        tabIndex={-1}
        aria-label="Time"
        aria-valuemin={0}
        aria-valuemax={seconds ?? 0}
        aria-valuenow={time}
        aria-valuetext={formatReviewClock(time)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          seekAt(event);
        }}
        onPointerMove={(event) => { if (event.buttons) seekAt(event); }}
        {...stylex.props(styles.scrub)}
      >
        <Box {...stylex.props(styles.track)} />
        {seconds !== undefined && length !== undefined && length < seconds && <Box {...stylex.props(styles.extent, styles.extentTo(length / seconds))} />}
        {seconds !== undefined && <Box {...stylex.props(styles.played, styles.playedTo(seconds))} />}
        {seconds !== undefined && <Box {...stylex.props(styles.head, styles.headAt(seconds))} />}
      </Box>
    </Group>
  );
}
