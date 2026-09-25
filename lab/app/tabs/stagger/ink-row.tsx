// ink-row.tsx: the stagger tab's main stage: a row of ink swatch cards entering one after another, timed by the
// studio's own `stagger`, with a timing chart under it (a bar per card, a playhead) so the spread and its cap show.
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { DISPLAY_FONT, MONO_FONT } from '#models/type/faces.ts';
import { W } from '#models/frame/frame.ts';
import { motionCurves, motionDurations, seg, stagger, staggerFinish, type StaggerFrom } from '#models/motion/motion.ts';
import { LAB_COLORS } from '../../ui.tsx';

/** A fan deck of inks, the showcase's red-orange and cobalt among them. The row takes the first `count`. */
export const STAGGER_INKS = [
  { name: 'Vermilion', hex: '#ee4c23' }, { name: 'Cobalt', hex: '#4144f4' }, { name: 'Bone', hex: '#f3f0e7' },
  { name: 'Ochre', hex: '#d99a2b' }, { name: 'Moss', hex: '#5f7d3a' }, { name: 'Oxblood', hex: '#7a1f2b' },
  { name: 'Teal', hex: '#1f8a86' }, { name: 'Lilac', hex: '#b39ddb' }, { name: 'Graphite', hex: '#4a4a52' },
  { name: 'Coral', hex: '#ff7f66' }, { name: 'Ultramarine', hex: '#2b3bb8' }, { name: 'Saffron', hex: '#f2b705' },
  { name: 'Sage', hex: '#9fb89a' }, { name: 'Rust', hex: '#b5522a' }, { name: 'Ice', hex: '#bfe3ef' },
  { name: 'Plum', hex: '#5b2a5e' }, { name: 'Lime', hex: '#b8d430' }, { name: 'Clay', hex: '#c98b6b' },
  { name: 'Navy', hex: '#1b2140' }, { name: 'Rose', hex: '#e59cb0' }, { name: 'Pine', hex: '#23483a' },
  { name: 'Sand', hex: '#dcc9a3' }, { name: 'Signal', hex: '#3ccf7a' }, { name: 'Soot', hex: '#222226' },
] as const;

export type StaggerInkRowProps = { count: number; each: number; max: number | null; from: StaggerFrom };

/** When the group starts, and each card's own entrance: a card with contents arriving. */
const GROUP_AT = 0.5;
const CARD_ENTER = motionDurations.enter.large;
const HOLD = 1.4;
const EXIT = motionDurations.exit;

/** How long one loop runs: the group's entrance, a hold on the finished row, a quick exit, a beat of empty frame. */
export function staggerInkRowSeconds({ count, each, max, from }: StaggerInkRowProps) {
  return GROUP_AT + staggerFinish(count, { each, max: max ?? undefined, from, duration: CARD_ENTER }) + HOLD + EXIT + 0.3;
}

export function StaggerInkRow(props: StaggerInkRowProps) {
  const { count, each, max, from } = props;
  const { fps, durationInFrames } = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const total = durationInFrames / fps;
  const timing = { each, max: max ?? undefined, from };
  const starts = Array.from({ length: count }, (_, i) => GROUP_AT + stagger(i, count, timing));
  const exitAt = total - 0.3 - EXIT;
  const leaving = seg(t, exitAt, exitAt + EXIT, motionCurves.productive.exit);

  const gap = count > 12 ? 10 : 20;
  const cardW = Math.min(210, (W - 240 - gap * (count - 1)) / count);
  const cardH = 330;
  const rowW = cardW * count + gap * (count - 1);
  const roomy = cardW >= 120;

  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground, fontFamily: DISPLAY_FONT, color: LAB_COLORS.cream }}>
      <div style={{ position: 'absolute', left: 120, top: 40, fontFamily: MONO_FONT, fontSize: 22, letterSpacing: '0.08em', color: LAB_COLORS.dim }}>
        INK LIBRARY — {count} COLOURS
      </div>
      {starts.map((start, i) => {
        const ink = STAGGER_INKS[i];
        const k = seg(t, start, start + CARD_ENTER, motionCurves.expressive.entrance);
        const fade = seg(t, start, start + CARD_ENTER * 0.4, motionCurves.dissolve);
        return (
          <div key={i} style={{
            position: 'absolute', left: (W - rowW) / 2 + i * (cardW + gap), top: 96, width: cardW, height: cardH,
            background: LAB_COLORS.panel, borderRadius: roomy ? 16 : 8, overflow: 'hidden',
            border: `1px solid ${LAB_COLORS.line}`,
            opacity: fade * (1 - leaving),
            transform: `translateY(${(1 - k) * 90 + leaving * 30}px) scale(${0.9 + 0.1 * k})`,
          }}>
            <div style={{ height: roomy ? '68%' : '100%', background: ink.hex }} />
            {roomy && (
              <div style={{ padding: '16px 16px 0' }}>
                <div style={{ fontSize: cardW > 170 ? 30 : 24, fontWeight: 800, fontStretch: '80%', textTransform: 'uppercase', lineHeight: 1 }}>{ink.name}</div>
                <div style={{ fontFamily: MONO_FONT, fontSize: 17, color: LAB_COLORS.dim, marginTop: 10 }}>{ink.hex.toUpperCase()}</div>
              </div>
            )}
          </div>
        );
      })}
      <StaggerTimingChart starts={starts} t={t} max={max} />
    </AbsoluteFill>
  );
}

/**
 * A bar per card from its start to its finish, filling as it plays; the cap on the spread shaded behind them. The
 * axis ends just past the last landing, not at the loop's end, so the bars fill the chart. It stops at y≈930 because
 * the Player's own controls cover the frame's bottom strip.
 */
function StaggerTimingChart({ starts, t, max }: { starts: number[]; t: number; max: number | null }) {
  const left = 120, right = W - 120, top = 540, height = 340, barsTop = top + 30;
  const lastFinish = Math.max(...starts) + CARD_ENTER;
  const axisEnd = Math.ceil((lastFinish + 0.2) / 0.5) * 0.5;
  const x = (s: number) => left + ((right - left) * s) / axisEnd;
  const rowH = Math.min(34, (top + height - barsTop) / starts.length);
  const barH = Math.max(4, rowH * 0.62);
  const lastStart = Math.max(...starts);
  const ticks = Array.from({ length: Math.round(axisEnd / 0.5) + 1 }, (_, i) => i * 0.5);
  const labelEvery = axisEnd > 3 ? 1 : 0.5;
  const label = { fontFamily: MONO_FONT, fontSize: 18, letterSpacing: '0.06em', color: LAB_COLORS.dim } as const;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{ ...label, position: 'absolute', left, top: top - 44 }}>
        WHEN EACH CARD MOVES · FIRST START → LAST START {(lastStart - GROUP_AT).toFixed(2)}s
      </div>
      {max !== null && (
        <div style={{
          position: 'absolute', left: x(GROUP_AT), top, width: Math.max(2, x(GROUP_AT + max) - x(GROUP_AT)), height,
          background: 'rgba(65, 68, 244, 0.16)', borderRight: `2px dashed ${LAB_COLORS.cobalt}`,
        }}>
          <div style={{ ...label, position: 'absolute', left: 8, top: 8, color: '#9a9cff', whiteSpace: 'nowrap' }}>CAP {max.toFixed(2)}s</div>
        </div>
      )}
      {ticks.map((s) => (
        <div key={s} style={{ position: 'absolute', left: x(s), top: top + height, height: 10, borderLeft: `1px solid ${LAB_COLORS.line}` }}>
          {s % labelEvery === 0 && <div style={{ ...label, fontSize: 16, position: 'absolute', top: 12, transform: 'translateX(-50%)' }}>{s}s</div>}
        </div>
      ))}
      {starts.map((start, i) => {
        const y = barsTop + i * rowH + (rowH - barH) / 2;
        const done = Math.min(1, Math.max(0, (t - start) / CARD_ENTER));
        const w = x(start + CARD_ENTER) - x(start);
        return (
          <div key={i} style={{ position: 'absolute', left: x(start), top: y, width: w, height: barH, borderRadius: barH / 2, background: LAB_COLORS.line, overflow: 'hidden' }}>
            <div style={{ width: `${done * 100}%`, height: '100%', background: STAGGER_INKS[i].hex }} />
          </div>
        );
      })}
      {t <= axisEnd && <div style={{ position: 'absolute', left: x(t), top: top - 8, height: height + 16, borderLeft: `3px solid ${LAB_COLORS.red}` }} />}
    </div>
  );
}
