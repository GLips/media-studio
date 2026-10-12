import { Group } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { useReviewPlaybackState, useReviewScreen } from '#web/features/review/index.ts';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  bar: {
    height: spacing.bar, paddingInline: spacing.tight, backgroundColor: colors.panel,
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line,
  },
});

/** `▶ 0:05.49 ♪`: the take's transport. While playing the time is written into its node each frame, as the playhead is. */
export function ScriptTransport() {
  const { playback, timing } = useReviewScreen();
  const { playing, frame, muted } = useReviewPlaybackState(playback, (s) => s);
  const time = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!playing) return undefined;
    let raf = requestAnimationFrame(function write() {
      if (time.current) time.current.textContent = formatReviewClock(playback.frameNow() / timing.fps);
      raf = requestAnimationFrame(write);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, playback, timing.fps]);
  return (
    <Group gap="tight" wrap="nowrap" {...stylex.props(styles.bar)}>
      <IconButton name="Play" onClick={playback.toggle}>{playing ? <Pause size={14} /> : <Play size={14} />}</IconButton>
      <Readout bright ref={time}>{formatReviewClock(frame / timing.fps)}</Readout>
      <IconButton name="Mute" active={muted} onClick={() => playback.setMuted(!muted)}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</IconButton>
    </Group>
  );
}
