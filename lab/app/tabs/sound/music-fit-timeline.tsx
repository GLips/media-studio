// music-fit-timeline.tsx: a music fit drawn as two rows: the original track above, the fitted one below, each span
// coloured the same in both and joined by a band, so you can see which bars were kept, dropped or played twice.
import type { MusicFitPlan } from '../../../../lib/music-fit.ts';
import { LAB_COLORS } from '../../ui.tsx';

const TL_W = 1200, ROW_H = 44, ORIGINAL_Y = 34, FITTED_Y = 190, TL_H = 262;
export const MUSIC_SPAN_COLORS = [LAB_COLORS.red, LAB_COLORS.cobalt, LAB_COLORS.pass, '#e8b53c', '#c55bd6', '#3cc6d0'] as const;

export function MusicFitTimeline({ plan, sourceSeconds, sourceBeats, targetSeconds, originalPlayhead, fittedPlayhead, onSeekFitted, onSeekOriginal }: {
  plan: MusicFitPlan; sourceSeconds: number; sourceBeats: readonly number[]; targetSeconds: number;
  originalPlayhead: number | null; fittedPlayhead: number | null;
  onSeekFitted: (seconds: number) => void; onSeekOriginal: (seconds: number) => void;
}) {
  // One scale for both rows, so a shorter fit looks shorter.
  const span = Math.max(sourceSeconds, targetSeconds);
  const x = (t: number) => (t / span) * TL_W;
  const offsets = plan.spans.map((_, i) => plan.spans.slice(0, i).reduce((sum, s) => sum + s.to - s.from, 0));
  // A fit longer than its song plays some stretches twice; each then gets its own lane in the song's row, so the
  // repeats read as overlapping rather than as a smear of mixed colours.
  const repeats = plan.spans.some((a, i) => plan.spans.some((b, j) => i < j && a.from < b.to && b.from < a.to));
  const laneH = repeats ? ROW_H / plan.spans.length : ROW_H;
  const seekFrom = (row: 'original' | 'fitted') => (e: React.MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - box.left) / box.width) * (row === 'original' ? sourceSeconds : targetSeconds);
    (row === 'original' ? onSeekOriginal : onSeekFitted)(t);
  };
  return (
    <svg className="fit-timeline" viewBox={`0 0 ${TL_W} ${TL_H}`}>
      <text x={0} y={ORIGINAL_Y - 10} className="fit-label">THE SONG AS WRITTEN · {sourceSeconds.toFixed(1)} s</text>
      <text x={0} y={FITTED_Y - 10} className="fit-label">FITTED TO THE VIDEO · {targetSeconds.toFixed(1)} s</text>

      <rect x={0} y={ORIGINAL_Y} width={x(sourceSeconds)} height={ROW_H} fill={LAB_COLORS.line} />
      {plan.spans.map((s, i) => {
        const color = MUSIC_SPAN_COLORS[i % MUSIC_SPAN_COLORS.length];
        const from = Math.max(0, s.from), fitFrom = offsets[i] + (from - s.from), fitTo = offsets[i] + s.to - s.from;
        return (
          <g key={i}>
            <path d={`M${x(from)},${ORIGINAL_Y + ROW_H} L${x(s.to)},${ORIGINAL_Y + ROW_H} L${x(fitTo)},${FITTED_Y} L${x(fitFrom)},${FITTED_Y} Z`} fill={color} opacity={0.16} />
            <rect x={x(from)} y={ORIGINAL_Y + (repeats ? i * laneH : 0)} width={x(s.to) - x(from)} height={laneH} fill={color} opacity={0.85} />
            <rect x={x(fitFrom)} y={FITTED_Y} width={x(fitTo) - x(fitFrom)} height={ROW_H} fill={color} />
            {s.from < 0 && <rect x={0} y={FITTED_Y} width={x(-s.from)} height={ROW_H} fill="url(#fit-silence)" />}
          </g>
        );
      })}
      {sourceBeats.filter((b) => b < sourceSeconds).map((b) => (
        <rect key={b} x={x(b)} y={ORIGINAL_Y + ROW_H - 8} width={1} height={8} fill={LAB_COLORS.ground} opacity={0.6} />
      ))}
      {plan.beats.map((b) => <rect key={b} x={x(b)} y={FITTED_Y + ROW_H - 8} width={1} height={8} fill={LAB_COLORS.ground} opacity={0.6} />)}
      {plan.downbeats.map((b) => <rect key={b} x={x(b)} y={FITTED_Y + ROW_H - 16} width={2} height={16} fill={LAB_COLORS.ground} opacity={0.7} />)}
      {plan.seams.map((t, i) => (
        <g key={t}>
          <rect x={x(t) - 1} y={FITTED_Y - 6} width={3} height={ROW_H + 12} fill={LAB_COLORS.cream} />
          <text x={x(t) + 6} y={FITTED_Y + ROW_H + 18} className="fit-label cream">SEAM {i + 1} · {t.toFixed(2)} s</text>
        </g>
      ))}
      <defs>
        <pattern id="fit-silence" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={8} height={8} fill={LAB_COLORS.panel} />
          <rect width={3} height={8} fill={LAB_COLORS.line} />
        </pattern>
      </defs>
      {originalPlayhead !== null && <rect x={x(originalPlayhead)} y={ORIGINAL_Y - 6} width={2} height={ROW_H + 12} fill={LAB_COLORS.cream} />}
      {fittedPlayhead !== null && <rect x={x(fittedPlayhead)} y={FITTED_Y - 6} width={2} height={ROW_H + 12} fill={LAB_COLORS.cream} />}
      <rect x={0} y={ORIGINAL_Y} width={x(sourceSeconds)} height={ROW_H} fill="transparent" className="fit-seek" onClick={seekFrom('original')} />
      <rect x={0} y={FITTED_Y} width={x(targetSeconds)} height={ROW_H} fill="transparent" className="fit-seek" onClick={seekFrom('fitted')} />
    </svg>
  );
}
