import { Button, Group, Paper, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';
import { LabNote } from '../lab-note.tsx';
import { playLabBuffer, stopLabAudio } from './lab-audio.ts';
import { LabMusicFitTimeline } from './lab-music-fit-timeline.tsx';
import { useLabPlayhead } from './use-lab-playhead.ts';
import type { LabMusicFit } from './use-lab-music-fit.ts';

const styles = stylex.create({
  stage: { position: 'relative', minHeight: '180px', padding: '16px 20px', transition: 'opacity 0.2s' },
  busy: { opacity: 0.55 },
  busyLabel: {
    position: 'absolute', top: '14px', right: '20px', color: colors.cream,
    fontFamily: fonts.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
  },
  message: { marginBlock: '60px', textAlign: 'center' },
  lazy: { borderColor: `color-mix(in srgb, ${colors.accent} 55%, transparent)` },
});

/** What the stage says before there's a fit to draw: why there isn't one, or what it's doing. */
function labMusicFitMessage({ result, decoded }: LabMusicFit): string {
  if (result && 'error' in result) return result.error;
  return decoded ? 'Finding the seams…' : 'Decoding the song…';
}

type LabMusicFitStageProps = {
  readonly music: LabMusicFit;
  readonly onPlayFit: (from?: number) => void;
  readonly onPlayOriginal: (from?: number) => void;
};

/** The fit drawn against the song, with buttons to hear it, the song as written, and the lazy fade it replaces. */
export function LabMusicFitStage({ music, onPlayFit, onPlayOriginal }: LabMusicFitStageProps) {
  const { track, decoded, fit, busy } = music;
  const originalPlayhead = useLabPlayhead('music-original');
  const fadePlayhead = useLabPlayhead('music-fade');
  const fittedPlayhead = useLabPlayhead('music-fitted');
  if (!track) return null;
  return (
    <Stack gap="sm">
      <Paper {...stylex.props(styles.stage, busy && styles.busy)}>
        {fit ? (
          <LabMusicFitTimeline plan={fit.plan} sourceSeconds={track.duration} sourceBeats={track.beats} targetSeconds={fit.seconds}
            playheads={{ original: originalPlayhead ?? fadePlayhead, fitted: fittedPlayhead }}
            onSeekOriginal={onPlayOriginal} onSeekFitted={onPlayFit} />
        ) : (
          <Text c="dimmed" {...stylex.props(styles.message)}>{labMusicFitMessage(music)}</Text>
        )}
        {busy && fit && <Text component="span" size="xs" {...stylex.props(styles.busyLabel)}>Finding the seams…</Text>}
      </Paper>
      {fit && (
        <>
          <Group gap="sm">
            <Button variant="filled" radius="xl" size="sm" onClick={() => onPlayFit()}>▶ Play the fit</Button>
            <Button radius="xl" size="sm" onClick={() => onPlayFit(fit.seconds - 8)}>▶ Its last 8 s</Button>
            <Button radius="xl" size="sm" onClick={() => onPlayOriginal()}>▶ The song as written</Button>
            {fit.seconds < track.duration && decoded && (
              <Button radius="xl" size="sm" {...stylex.props(styles.lazy)}
                onClick={() => playLabBuffer('music-fade', decoded.buffer, { offset: Math.max(0, fit.seconds - 8), fadeOutAt: fit.seconds })}>
                ▶ The lazy way: fade out at {fit.seconds.toFixed(1)} s
              </Button>
            )}
            <Button radius="xl" size="sm" onClick={stopLabAudio}>■ Stop</Button>
          </Group>
          <LabNote>
            Click either row to play from that point. Colours match: each coloured stretch of the fit is the same colour
            in the song above. White lines are the seams, tall ticks the first beat of each bar.{fit.plan.spans[0].from < 0 && ' The striped stretch at the start is silence: the music comes in a moment after the picture, rather than cut into its first bar.'} Try
            to hear the seams: if you can't, the fit worked. Planned in {Math.round(fit.planMs)} ms, right here in the
            browser, with the same code a render uses.
          </LabNote>
        </>
      )}
    </Stack>
  );
}
