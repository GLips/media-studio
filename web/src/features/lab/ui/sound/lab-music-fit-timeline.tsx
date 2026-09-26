import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useId, type MouseEvent } from 'react';
import type { MusicFitPlan } from '#models/music/music-fit.ts';
import { musicSpanLanes, musicSpanOffsets } from '#models/lab/lab-sound-music-fit.ts';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';
import { labMusicSpanColor } from './lab-music-fit.ts';

const TL_W = 1200, ROW_H = 44, ORIGINAL_Y = 34, BAND_H = 100;
const LANE_H = 22, LANE_GAP = 5;
const ORDINALS = ['1ST', '2ND', '3RD'];

const styles = stylex.create({
  svg: { display: 'block', width: '100%', height: 'auto', overflow: 'visible' },
  label: { fontFamily: fonts.mono, letterSpacing: '0.08em', fill: colors.dim },
  cream: { fill: colors.cream },
  seek: { cursor: 'pointer' },
});

/** A click on a row, as seconds into what that row draws. */
const seekFrom = (length: number, onSeek: (seconds: number) => void) => (e: MouseEvent<SVGRectElement>) => {
  const box = e.currentTarget.getBoundingClientRect();
  onSeek(((e.clientX - box.left) / box.width) * length);
};

type LabMusicFitTimelineProps = {
  readonly plan: MusicFitPlan;
  readonly sourceSeconds: number;
  readonly sourceBeats: readonly number[];
  readonly targetSeconds: number;
  /** Where each row is playing, in its own seconds, or null. */
  readonly playheads: { original: number | null; fitted: number | null };
  readonly onSeekOriginal: (seconds: number) => void;
  readonly onSeekFitted: (seconds: number) => void;
};

/**
 * A music fit as two rows: the song as written above, the fit below, each span coloured the same in both and joined
 * by a band, so you can see which bars were kept, dropped or played twice.
 */
export function LabMusicFitTimeline({ plan, sourceSeconds, sourceBeats, targetSeconds, playheads, onSeekOriginal, onSeekFitted }: LabMusicFitTimelineProps) {
  // React's ids carry characters a url(#…) reference can't hold.
  const silenceId = `fit-silence-${useId().replace(/[^\w-]/g, '')}`;
  // One scale for both rows, so a shorter fit looks shorter.
  const span = Math.max(sourceSeconds, targetSeconds);
  const x = (t: number) => (t / span) * TL_W;
  const offsets = musicSpanOffsets(plan.spans);
  const { lanes, count } = musicSpanLanes(plan.spans);
  const laneH = count > 1 ? LANE_H : ROW_H;
  const laneY = (lane: number) => ORIGINAL_Y + lane * (laneH + LANE_GAP);
  const originalH = count * laneH + (count - 1) * LANE_GAP;
  const fittedY = ORIGINAL_Y + originalH + BAND_H;
  const height = fittedY + ROW_H + 28;
  // Each span's place in both rows; it starts where it does in the fit, and no two start at once.
  const spans = plan.spans.map((s, i) => {
    const from = Math.max(0, s.from);
    return { s, color: labMusicSpanColor(i), top: laneY(lanes[i]), from, fitFrom: offsets[i] + (from - s.from), fitTo: offsets[i] + s.to - s.from };
  });
  return (
    <Box component="svg" fz="xs" viewBox={`0 0 ${TL_W} ${height}`} {...stylex.props(styles.svg)}>
      <text x={0} y={ORIGINAL_Y - 10} {...stylex.props(styles.label)}>THE SONG AS WRITTEN · {sourceSeconds.toFixed(1)} s{count > 1 ? ' · ONE LANE PER TIME THROUGH IT' : ''}</text>
      <text x={0} y={fittedY - 10} {...stylex.props(styles.label)}>FITTED TO THE VIDEO · {targetSeconds.toFixed(1)} s</text>

      {Array.from({ length: count }, (_, lane) => (
        <g key={lane}>
          <rect x={0} y={laneY(lane)} width={x(sourceSeconds)} height={laneH} fill={colors.line} />
          {count > 1 && x(sourceSeconds) + 150 < TL_W && (
            <text x={x(sourceSeconds) + 10} y={laneY(lane) + laneH - 6} {...stylex.props(styles.label)}>{ORDINALS[lane] ?? `${lane + 1}TH`} TIME</text>
          )}
        </g>
      ))}
      {spans.map(({ s, color, top, from, fitFrom, fitTo }) => {
        return (
          <g key={fitFrom}>
            <path d={`M${x(from)},${top + laneH} L${x(s.to)},${top + laneH} L${x(fitTo)},${fittedY} L${x(fitFrom)},${fittedY} Z`} fill={color} opacity={0.16} />
            <rect x={x(from)} y={top} width={x(s.to) - x(from)} height={laneH} fill={color} opacity={0.85} />
            <rect x={x(fitFrom)} y={fittedY} width={x(fitTo) - x(fitFrom)} height={ROW_H} fill={color} />
            {s.from < 0 && <rect x={0} y={fittedY} width={x(-s.from)} height={ROW_H} fill={`url(#${silenceId})`} />}
          </g>
        );
      })}
      {Array.from({ length: count }, (_, lane) => sourceBeats.filter((b) => b < sourceSeconds).map((b) => (
        <rect key={`${lane}/${b}`} x={x(b)} y={laneY(lane) + laneH - 6} width={1} height={6} fill={colors.ground} opacity={0.6} />
      )))}
      {plan.beats.map((b) => <rect key={b} x={x(b)} y={fittedY + ROW_H - 8} width={1} height={8} fill={colors.ground} opacity={0.6} />)}
      {plan.downbeats.map((b) => <rect key={b} x={x(b)} y={fittedY + ROW_H - 16} width={2} height={16} fill={colors.ground} opacity={0.7} />)}
      {plan.seams.map((t, i) => (
        <g key={t}>
          <rect x={x(t) - 1} y={fittedY - 6} width={3} height={ROW_H + 12} fill={colors.cream} />
          <text x={x(t) + 80 > TL_W ? x(t) - 6 : x(t) + 6} textAnchor={x(t) + 80 > TL_W ? 'end' : 'start'} y={fittedY + ROW_H + 18}
            {...stylex.props(styles.label, styles.cream)}>SEAM {i + 1}</text>
        </g>
      ))}
      <defs>
        <pattern id={silenceId} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={8} height={8} fill={colors.panel} />
          <rect width={3} height={8} fill={colors.line} />
        </pattern>
      </defs>
      {playheads.original !== null && <rect x={x(playheads.original)} y={ORIGINAL_Y - 6} width={2} height={originalH + 12} fill={colors.cream} />}
      {playheads.fitted !== null && <rect x={x(playheads.fitted)} y={fittedY - 6} width={2} height={ROW_H + 12} fill={colors.cream} />}
      <rect x={0} y={ORIGINAL_Y} width={x(sourceSeconds)} height={originalH} fill="transparent" {...stylex.props(styles.seek)} onClick={seekFrom(sourceSeconds, onSeekOriginal)} />
      <rect x={0} y={fittedY} width={x(targetSeconds)} height={ROW_H} fill="transparent" {...stylex.props(styles.seek)} onClick={seekFrom(targetSeconds, onSeekFitted)} />
    </Box>
  );
}
