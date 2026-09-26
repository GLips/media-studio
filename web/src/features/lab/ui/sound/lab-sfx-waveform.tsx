import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useMemo } from 'react';
import { colors, fonts, radius } from '#web/shared/ui/theme.stylex.ts';

const WAVE_W = 1200, WAVE_H = 240, RULER_H = 22;
/** JetBrains Mono's advance is 0.6 em: a ruler label's width, without measuring it. */
const RULER_CHAR_W = 7.2;

const styles = stylex.create({
  wave: { position: 'relative', backgroundColor: colors.panel, borderRadius: radius.surface, paddingTop: '12px', overflow: 'hidden' },
  svg: { display: 'block', width: '100%', height: 'auto' },
  ruler: { fontFamily: fonts.mono, fill: colors.dim },
  lands: { position: 'absolute', top: 0, bottom: '22px', borderLeftWidth: '2px', borderLeftStyle: 'solid', borderLeftColor: colors.accent, pointerEvents: 'none' },
  landsLabel: {
    position: 'absolute', top: '6px', left: '6px', whiteSpace: 'nowrap', color: colors.accent,
    fontFamily: fonts.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
  },
  landsLabelLeft: { left: 'auto', right: '6px' },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: '2px', backgroundColor: colors.cream, pointerEvents: 'none' },
  at: (left: string) => ({ left }),
});

/** A ruler step that gives roughly six to twelve ticks across `seconds`. */
const rulerStep = (seconds: number) => [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2].find((s) => seconds / s <= 12) ?? 5;

/** A waveform as one path: a column per pixel from its lowest to its highest sample. */
function sfxWavePath(samples: Float32Array, pxPerSample: number, scale: number): string {
  const mid = ((WAVE_H - RULER_H) / 2) * scale, centre = (WAVE_H - RULER_H) / 2;
  const columns = Math.ceil(samples.length * pxPerSample);
  const parts: string[] = [];
  for (let x = 0; x < columns; x++) {
    const from = Math.floor(x / pxPerSample), to = Math.min(samples.length, Math.floor((x + 1) / pxPerSample));
    let lo = 0, hi = 0;
    for (let i = from; i < Math.max(to, from + 1); i++) {
      lo = Math.min(lo, samples[i] ?? 0);
      hi = Math.max(hi, samples[i] ?? 0);
    }
    parts.push(`M${x},${(centre - hi * mid).toFixed(1)}h1v${Math.max(1, (hi - lo) * mid).toFixed(1)}h-1z`);
  }
  return parts.join('');
}

type LabSfxWaveformProps = {
  readonly samples: Float32Array;
  /** The previous take, drawn faintly behind. */
  readonly ghost: Float32Array | undefined;
  readonly rate: number;
  readonly landsAt: number;
  readonly playhead: number | null;
};

/** One rendered sound as its waveform, with a time ruler, where its hit lands, the last take behind it, and a playhead. */
export function LabSfxWaveform({ samples, ghost, rate, landsAt, playhead }: LabSfxWaveformProps) {
  // Both takes share one time scale, with a little room after the longer one.
  const seconds = (Math.max(samples.length, ghost?.length ?? 0) / rate) * 1.04;
  const { wave, ghostWave, ticks } = useMemo(() => {
    const pxPerSample = WAVE_W / (seconds * rate);
    // Drawn to fill the height: every sound is levelled quietly under the voice, so at true scale most are a sliver.
    const peak = [samples, ghost ?? samples].reduce((m, s) => s.reduce((a, v) => Math.max(a, Math.abs(v)), m), 1e-6);
    const step = rulerStep(seconds);
    return {
      wave: sfxWavePath(samples, pxPerSample, 0.92 / peak),
      ghostWave: ghost && sfxWavePath(ghost, pxPerSample, 0.92 / peak),
      ticks: Array.from({ length: Math.floor(seconds / step + 1e-9) + 1 }, (_, i) => i * step),
    };
  }, [samples, ghost, rate, seconds]);
  const pct = (t: number) => `${(t / seconds) * 100}%`;
  return (
    <Box {...stylex.props(styles.wave)}>
      <Box component="svg" fz="xs" viewBox={`0 0 ${WAVE_W} ${WAVE_H}`} {...stylex.props(styles.svg)}>
        <rect x={0} y={(WAVE_H - RULER_H) / 2} width={WAVE_W} height={1} fill={colors.line} />
        {ghostWave && <path d={ghostWave} fill={colors.dim} opacity={0.35} />}
        <path d={wave} fill={colors.cream} />
        {ticks.map((t) => {
          const x = (t / seconds) * WAVE_W, label = `${Number(t.toFixed(2))} s`;
          // A label that would run off the right edge sits left of its tick instead.
          const flip = x + 4 + label.length * RULER_CHAR_W > WAVE_W;
          return (
            <g key={t}>
              <rect x={x} y={WAVE_H - RULER_H} width={1} height={6} fill={colors.line} />
              <text x={flip ? x - 4 : x + 4} y={WAVE_H - 6} textAnchor={flip ? 'end' : 'start'} {...stylex.props(styles.ruler)}>{label}</text>
            </g>
          );
        })}
      </Box>
      <Box {...stylex.props(styles.lands, styles.at(pct(landsAt)))}>
        <Text component="span" size="xs" {...stylex.props(styles.landsLabel, landsAt / seconds > 0.6 && styles.landsLabelLeft)}>
          where the hit lands · {landsAt.toFixed(2)} s
        </Text>
      </Box>
      {playhead !== null && <Box {...stylex.props(styles.playhead, styles.at(pct(playhead)))} />}
    </Box>
  );
}
