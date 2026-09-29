import { ActionIcon, Button, Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { formatReviewMoment } from '#lib/output/review/models/review-notes.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { fonts } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewPlayback } from './use-review-playback.ts';

const styles = stylex.create({
  now: { fontFamily: fonts.mono, fontWeight: 600, marginLeft: '0.375rem' },
  keys: { marginLeft: 'auto' },
});

/** Play, a frame back and forward, and where the playhead is. */
export function ReviewTransport({ playback, fps }: { readonly playback: ReviewPlayback; readonly fps: number }) {
  const { playing, frame, total, togglePlaying, seekToFrame } = playback;
  return (
    <Group gap="xs">
      <Button size="xs" variant="default" leftSection={playing ? <Pause size={14} /> : <Play size={14} />} onClick={togglePlaying}>
        {playing ? 'Pause' : 'Play'}
      </Button>
      <ActionIcon variant="default" aria-label="Back a frame (,)" title="Back a frame (,)" onClick={() => seekToFrame(frame - 1)}><ChevronLeft size={16} /></ActionIcon>
      <ActionIcon variant="default" aria-label="Forward a frame (.)" title="Forward a frame (.)" onClick={() => seekToFrame(frame + 1)}><ChevronRight size={16} /></ActionIcon>
      <Text component="span" {...stylex.props(styles.now)}>{formatReviewMoment(frame, fps)}</Text>
      <Readout>of {total} · {fps} fps</Readout>
      <Text component="span" {...stylex.props(styles.keys)}>
        <Readout>space play · , . a frame (shift: 10) · click the frame to pin · drag the scrubber for a range · click a sound to aim at it</Readout>
      </Text>
    </Group>
  );
}
