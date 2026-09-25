// music-fit-timeline.tsx: a music fit drawn as two rows: the original track above, the fitted one below, each span
// coloured the same in both and joined by a band, so you can see which bars were kept, dropped or played twice.
import type { MusicFitPlan } from '../../../../lib/music-fit.ts';
import { LAB_COLORS } from '../../ui.tsx';

const TL_W = 1200, ROW_H = 44, ORIGINAL_Y = 34, BAND_H = 100;
/** A pass through the song when the fit plays parts of it more than once: one lane each, readable at any length. */
const LANE_H = 22, LANE_GAP = 5;
export const MUSIC_SPAN_COLORS = [LAB_COLORS.red, LAB_COLORS.cobalt, LAB_COLORS.pass, '#e8b53c', '#c55bd6', '#3cc6d0'] as const;

const ORDINALS = ['1ST', '2ND', '3RD'];

/** Each span's lane in the song's row: the first lane that's free by the time the span starts. */
function musicSpanLanes(spans: MusicFitPlan['spans']): { lanes: number[]; count: number } {
  const laneEnds: number[] = [];
  const lanes = spans.map((s) => {
    const from = Math.max(0, s.from);
    let lane = laneEnds.findIndex((end) => end <= from + 1e-6);
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = s.to;
    return lane;
  });
  return { lanes, count: laneEnds.length };
}

export function MusicFitTimeline({ plan, sourceSeconds, sourceBeats, targetSeconds, originalPlayhead, fittedPlayhead, onSeekFitted, onSeekOriginal }: {
  plan: MusicFitPlan; sourceSeconds: number; sourceBeats: readonly number[]; targetSeconds: number;
  originalPlayhead: number | null; fittedPlayhead: number | null;
  onSeekFitted: (seconds: number) => void; onSeekOriginal: (seconds: number) => void;
}) {
  // One scale for both rows, so a shorter fit looks shorter.
  const span = Math.max(sourceSeconds, targetSeconds);
  const x = (t: number) => (t / span) * TL_W;
  const offsets = plan.spans.map((_, i) => plan.spans.slice(0, i).reduce((sum, s) => sum + s.to - s.from, 0));
  const { lanes, count } = musicSpanLanes(plan.spans);
  const laneH = count > 1 ? LANE_H : ROW_H;
  const laneY = (lane: number) => ORIGINAL_Y + lane * (laneH + LANE_GAP);
  const originalH = count * laneH + (count - 1) * LANE_GAP;
  const fittedY = ORIGINAL_Y + originalH + BAND_H;
  const height = fittedY + ROW_H + 28;
  const seekFrom = (row: 'original' | 'fitted') => (e: React.MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - box.left) / box.width) * (row === 'original' ? sourceSeconds : targetSeconds);
    (row === 'original' ? onSeekOriginal : onSeekFitted)(t);
  };
  return (
    <svg className="fit-timeline" viewBox={`0 0 ${TL_W} ${height}`}>
      <text x={0} y={ORIGINAL_Y - 10} className="fit-label">THE SONG AS WRITTEN · {sourceSeconds.toFixed(1)} s{count > 1 ? ' · ONE LANE PER TIME THROUGH IT' : ''}</text>
      <text x={0} y={fittedY - 10} className="fit-label">FITTED TO THE VIDEO · {targetSeconds.toFixed(1)} s</text>

      {Array.from({ length: count }, (_, lane) => (
        <g key={lane}>
          <rect x={0} y={laneY(lane)} width={x(sourceSeconds)} height={laneH} fill={LAB_COLORS.line} />
          {count > 1 && x(sourceSeconds) + 150 < TL_W && (
            <text x={x(sourceSeconds) + 10} y={laneY(lane) + laneH - 6} className="fit-label">{ORDINALS[lane] ?? `${lane + 1}TH`} TIME</text>
          )}
        </g>
      ))}
      {plan.spans.map((s, i) => {
        const color = MUSIC_SPAN_COLORS[i % MUSIC_SPAN_COLORS.length], top = laneY(lanes[i]);
        const from = Math.max(0, s.from), fitFrom = offsets[i] + (from - s.from), fitTo = offsets[i] + s.to - s.from;
        return (
          <g key={i}>
            <path d={`M${x(from)},${top + laneH} L${x(s.to)},${top + laneH} L${x(fitTo)},${fittedY} L${x(fitFrom)},${fittedY} Z`} fill={color} opacity={0.16} />
            <rect x={x(from)} y={top} width={x(s.to) - x(from)} height={laneH} fill={color} opacity={0.85} />
            <rect x={x(fitFrom)} y={fittedY} width={x(fitTo) - x(fitFrom)} height={ROW_H} fill={color} />
            {s.from < 0 && <rect x={0} y={fittedY} width={x(-s.from)} height={ROW_H} fill="url(#fit-silence)" />}
          </g>
        );
      })}
      {Array.from({ length: count }, (_, lane) => sourceBeats.filter((b) => b < sourceSeconds).map((b) => (
        <rect key={`${lane}/${b}`} x={x(b)} y={laneY(lane) + laneH - 6} width={1} height={6} fill={LAB_COLORS.ground} opacity={0.6} />
      )))}
      {plan.beats.map((b) => <rect key={b} x={x(b)} y={fittedY + ROW_H - 8} width={1} height={8} fill={LAB_COLORS.ground} opacity={0.6} />)}
      {plan.downbeats.map((b) => <rect key={b} x={x(b)} y={fittedY + ROW_H - 16} width={2} height={16} fill={LAB_COLORS.ground} opacity={0.7} />)}
      {plan.seams.map((t, i) => (
        <g key={t}>
          <rect x={x(t) - 1} y={fittedY - 6} width={3} height={ROW_H + 12} fill={LAB_COLORS.cream} />
          <text x={x(t) + 80 > TL_W ? x(t) - 6 : x(t) + 6} textAnchor={x(t) + 80 > TL_W ? 'end' : 'start'} y={fittedY + ROW_H + 18} className="fit-label cream">SEAM {i + 1}</text>
        </g>
      ))}
      <defs>
        <pattern id="fit-silence" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={8} height={8} fill={LAB_COLORS.panel} />
          <rect width={3} height={8} fill={LAB_COLORS.line} />
        </pattern>
      </defs>
      {originalPlayhead !== null && <rect x={x(originalPlayhead)} y={ORIGINAL_Y - 6} width={2} height={originalH + 12} fill={LAB_COLORS.cream} />}
      {fittedPlayhead !== null && <rect x={x(fittedPlayhead)} y={fittedY - 6} width={2} height={ROW_H + 12} fill={LAB_COLORS.cream} />}
      <rect x={0} y={ORIGINAL_Y} width={x(sourceSeconds)} height={originalH} fill="transparent" className="fit-seek" onClick={seekFrom('original')} />
      <rect x={0} y={fittedY} width={x(targetSeconds)} height={ROW_H} fill="transparent" className="fit-seek" onClick={seekFrom('fitted')} />
    </svg>
  );
}
