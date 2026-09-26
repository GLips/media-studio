import { Box, Paper, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';

/** Worst-seam differences, in dB per band, past which the meter is full, and the rough end of the usual range. */
const SEAM_ROUGH_FULL = 8, SEAM_ROUGH_USUAL = 5;

const styles = stylex.create({
  bar: {
    position: 'relative', height: '10px', borderRadius: '5px',
    backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${colors.pass} 30%, transparent), color-mix(in srgb, ${colors.accent} 30%, transparent))`,
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: '5px', backgroundColor: colors.pass },
  over: { backgroundColor: colors.accent },
  usual: { position: 'absolute', top: '-4px', bottom: '-4px', width: '2px', backgroundColor: colors.cream },
  scale: {
    position: 'relative', display: 'flex', justifyContent: 'space-between', height: '14px',
    fontFamily: fonts.mono, textTransform: 'uppercase', color: colors.dim,
  },
  usualLabel: { position: 'absolute', transform: 'translateX(-50%)', whiteSpace: 'nowrap', color: colors.cream },
  width: (width: string) => ({ width }),
  left: (left: string) => ({ left }),
});

function musicSeamVerdict(db: number): string {
  if (db <= 2) return 'Very smooth: hard to hear at all.';
  return db <= SEAM_ROUGH_USUAL ? 'Normal: where most fits land.' : 'Rougher than usual: have a listen to it.';
}

/** The roughest seam as a meter from smooth to rough, with the top of the usual range marked. */
export function LabMusicSeamRoughness({ db }: { readonly db: number }) {
  const at = `${Math.min(1, db / SEAM_ROUGH_FULL) * 100}%`, usual = `${(SEAM_ROUGH_USUAL / SEAM_ROUGH_FULL) * 100}%`;
  return (
    <Paper p="sm">
      <Stack gap="tight">
        <Readout label>How well the roughest seam matches</Readout>
        <Box {...stylex.props(styles.bar)}>
          <Box {...stylex.props(styles.fill, db > SEAM_ROUGH_USUAL && styles.over, styles.width(at))} />
          <Box title="the rough end of the usual range" {...stylex.props(styles.usual, styles.left(usual))} />
        </Box>
        <Box fz="xs" {...stylex.props(styles.scale)}>
          <Text component="span" inherit>smooth</Text>
          <Text component="span" inherit {...stylex.props(styles.usualLabel, styles.left(usual))}>usual limit</Text>
          <Text component="span" inherit>rough</Text>
        </Box>
        <Text size="xs" c="dimmed">{musicSeamVerdict(db)} It compares how the bars either side of the jump sound, pitch by pitch.</Text>
      </Stack>
    </Paper>
  );
}
