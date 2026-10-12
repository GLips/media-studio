import { Box, Center, Image, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReviewCandidate } from '#lib/output/review/models/review-threads.ts';
import { projectFileUrl } from '#web/shared/media-urls.ts';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useDecisionScreen } from './decision-screen-context.tsx';
import { DecisionWaveform } from './decision-waveform.tsx';

const styles = stylex.create({
  fill: { width: '100%', height: '100%' },
  // `contain`: a 9:16 candidate beside a 16:9 one keeps its own shape, letterboxed on the screen ground.
  picture: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
  text: { display: 'block', height: '100%', paddingBlock: spacing.gap, color: colors.cream, whiteSpace: 'pre-wrap', overflow: 'hidden' },
  gone: { color: colors.dim },
  hidden: { display: 'none' },
});

type DecisionCandidateMediaProps = { readonly candidate: ReviewCandidate; readonly missing: boolean };

/** What a candidate is, at its own shape: a picture, a video, a waveform for audio, or its words at reading size. */
export function DecisionCandidateMedia({ candidate, missing }: DecisionCandidateMediaProps) {
  const { project, playback } = useDecisionScreen();
  const { media } = candidate;
  if (!media) return <Text component="span" size="lg" {...stylex.props(styles.text)}>{candidate.text}</Text>;
  if (missing) return <Center {...stylex.props(styles.fill)}><Text component="span" size="sm" {...stylex.props(styles.gone)}>∅</Text></Center>;
  // Unpinned, so a candidate re-made in place plays its new bytes and is marked changed rather than refused.
  const url = projectFileUrl(project, media.path, media.hash);
  if (media.kind === 'still') return <Image src={url} alt={candidate.label} {...stylex.props(styles.picture)} />;
  if (media.kind === 'video') {
    return <Box component="video" ref={playback.attachMedia(candidate.key)} src={url} preload="auto" playsInline {...stylex.props(styles.picture)} />;
  }
  return (
    <>
      <Box component="audio" ref={playback.attachMedia(candidate.key)} src={url} preload="auto" {...stylex.props(styles.hidden)} />
      <DecisionWaveform candidateKey={candidate.key} path={media.path} hash={media.hash} />
    </>
  );
}
