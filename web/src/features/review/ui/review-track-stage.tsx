import { Box, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { AudioLines } from 'lucide-react';
import { projectMadeDetailOf } from '#lib/output/review/models/project-made.ts';
import { reviewMediaUrl } from '#web/shared/media-urls.ts';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { pinReviewDraft } from './review-draft-pin.ts';
import { useReviewScreen } from './review-screen-context.tsx';

const styles = stylex.create({
  stage: {
    height: '100%', width: '100%', backgroundColor: colors.screen, display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: spacing.inset, color: colors.cream, cursor: 'crosshair',
  },
  dim: { color: colors.dim },
});

/**
 * A track's stage: the `<audio>` the review's clock plays, and the track's name and measurements where a picture
 * would be. Its waveform is the dock's sound lane. A click pins a note at the playhead, as a click on a frame does.
 */
export function ReviewTrackStage() {
  const screen = useReviewScreen();
  const { artifact, playback: { attachMedia } } = screen;
  const detail = artifact.made && projectMadeDetailOf(artifact.made);
  return (
    <Box onClick={() => pinReviewDraft(screen)} {...stylex.props(styles.stage)}>
      <Box component="audio" ref={attachMedia} src={reviewMediaUrl(artifact)} preload="auto" />
      <AudioLines size={28} />
      <Stack gap={0}>
        <Text size="lg">{artifact.title}</Text>
        {detail && <Text size="sm" {...stylex.props(styles.dim)}>{detail}</Text>}
      </Stack>
    </Box>
  );
}
