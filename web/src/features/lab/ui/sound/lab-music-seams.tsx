import { Stack, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { MusicFitPlan } from '#models/music/music-fit.ts';
import { musicBarsIn } from '#models/lab/lab-sound-music-fit.ts';
import { colors, radius } from '#web/shared/ui/theme.stylex.ts';
import { labMusicSpanColor } from './lab-music-fit.ts';

/** Seconds of lead-in before a seam when you jump to hear it. */
const SEAM_LEAD_IN = 3;

const styles = stylex.create({
  seam: {
    display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left', backgroundColor: { default: colors.panel, ':hover': colors.line },
    borderLeftWidth: '4px', borderLeftStyle: 'solid', borderRadius: radius.surface, padding: '10px 14px',
  },
  edge: (color: string) => ({ borderLeftColor: color }),
});

type LabMusicSeamsProps = {
  readonly plan: MusicFitPlan;
  readonly bpm: number;
  /** Plays the fit from a moment, in its seconds. */
  readonly onPlayFit: (from: number) => void;
};

/** Each seam of a fit as a button that plays from just before it, saying where in the song it jumps and how far. */
export function LabMusicSeams({ plan, bpm, onPlayFit }: LabMusicSeamsProps) {
  return (
    <Stack gap="xs">
      {plan.seams.length === 0 && <Text c="dimmed">No seams needed: the song fits by trimming its quiet start, or waiting a moment before it comes in.</Text>}
      {plan.seams.map((t, i) => {
        const from = plan.spans[i].to, to = plan.spans[i + 1].from, jump = to - from;
        return (
          <UnstyledButton key={t} onClick={() => onPlayFit(t - SEAM_LEAD_IN)} {...stylex.props(styles.seam, styles.edge(labMusicSpanColor(i + 1)))}>
            <Text fw={700}>▶ Seam {i + 1} · {t.toFixed(1)} s</Text>
            <Text>jumps from {from.toFixed(1)} s to {to.toFixed(1)} s in the song: {jump > 0 ? `skips ${musicBarsIn(jump, bpm)}` : `repeats ${musicBarsIn(-jump, bpm)}`} bars</Text>
            <Text size="xs" c="dimmed">plays from {SEAM_LEAD_IN} s before it</Text>
          </UnstyledButton>
        );
      })}
    </Stack>
  );
}
