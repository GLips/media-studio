// title-card.tsx: the `card` rung (#models/timeline/scene-rung.ts), the lowest a scene starts at: its id and note on a
// plain ground, each of its cues lighting as it lands, and a strip under them with the playhead crossing the cues' ticks.
// Cut together, a video's cards are its animatic: every scene at its length, every cue at its moment, nothing drawn.

import { AbsoluteFill } from 'remotion';
import { CAPTION_SAFE_TOP, W } from '#models/frame/frame.ts';
import { clamp, motionCurves, seg } from '#models/motion/motion.ts';
import { DISPLAY_FONT, MONO_FONT } from '#models/type/faces.ts';
import { unmeasuredAttrs } from '../probe/motion-tag.ts';
import { useScene } from '../composition/scene.tsx';

/** A moment the card marks, `at` scene seconds: a cue, or a line where it starts. */
export type TitleCardCue = { name: string; at: number };

const GROUND = '#1d2026';
const INK = '#eef0f3';
const DIM = '#6d737d';
const LIT = '#f2c14e';
const MARGIN = 120;
const STRIP_Y = CAPTION_SAFE_TOP - 70;

export function TitleCard({ id, n, note, cues = [] }: { id: string; n?: number; note?: string; cues?: readonly TitleCardCue[] }) {
  const s = useScene();
  const sorted = [...cues].sort((a, b) => a.at - b.at);
  const x = (at: number) => MARGIN + (W - 2 * MARGIN) * clamp(at / s.dur);
  return (
    <AbsoluteFill {...unmeasuredAttrs('title card')} style={{ background: GROUND, color: INK }}>
      <div style={{ position: 'absolute', left: MARGIN, top: 150, font: `600 26px ${MONO_FONT}`, letterSpacing: '0.12em', color: DIM }}>
        {n !== undefined ? `SCENE ${String(n).padStart(2, '0')} · ` : ''}CARD
      </div>
      <div style={{ position: 'absolute', left: MARGIN - 6, top: 200, font: `800 132px/1 ${DISPLAY_FONT}`, letterSpacing: '-0.025em' }}>{id}</div>
      {note && <div style={{ position: 'absolute', left: MARGIN, top: 370, width: 1400, font: `500 40px/1.35 ${DISPLAY_FONT}`, color: '#c3c8cf' }}>{note}</div>}
      <div style={{ position: 'absolute', left: MARGIN, right: MARGIN, top: STRIP_Y - 120, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        {sorted.map((cue) => {
          // Lights on its frame, with a short swell so a cue landing mid-sentence of the voice still catches the eye.
          const k = seg(s.t, cue.at, cue.at + 0.25, motionCurves.expressive.entrance);
          const pop = 1 + 0.12 * (1 - seg(s.t, cue.at + 0.1, cue.at + 0.5)) * k;
          return (
            <span key={`${cue.name}@${cue.at}`} style={{
              font: `600 26px ${MONO_FONT}`, padding: '8px 16px', borderRadius: 6, transform: `scale(${pop})`,
              color: k > 0.5 ? GROUND : DIM, background: `rgba(242, 193, 78, ${k})`, border: `2px solid ${k > 0.5 ? LIT : '#3a3f48'}`,
            }}>{cue.name}</span>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: MARGIN, width: W - 2 * MARGIN, top: STRIP_Y, height: 2, background: '#3a3f48' }} />
      {sorted.map((cue) => (
        <div key={`tick ${cue.name}@${cue.at}`} style={{ position: 'absolute', left: x(cue.at) - 1, top: STRIP_Y - 12, width: 3, height: 26, background: s.t >= cue.at ? LIT : DIM }} />
      ))}
      <div style={{ position: 'absolute', left: x(s.t) - 2, top: STRIP_Y - 22, width: 4, height: 46, background: INK }} />
    </AbsoluteFill>
  );
}
