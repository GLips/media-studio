// curves-springs-stage.tsx: the Curves & springs tab's spring stage. The studio's spring, `perceptualSpring` (Apple's
// spring(duration:bounce:)), at four bounces on one move, timed three ways against a beat light: arriving on it (the
// studio's rule), settling on it, or all starting together. Each row goes out and comes back on its spring, so the
// loop never jumps.
import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, lerp, perceptualSpring, type PerceptualSpring } from '#models/motion/motion.ts';
import { DISPLAY_FONT, MONO_FONT } from '#models/type/faces.ts';
import { ShutterBlur } from '#studio/film/motion-blur.tsx';
import { LAB_COLORS, LAB_FORMAT } from '../lab-format.ts';

export type SpringsMove = 'slide' | 'pop' | 'toggle';
export type SpringsTiming = 'arrival' | 'duration' | 'together';
export type SpringsLook = 'video' | 'videoBlur' | 'screen';

// Apple's named springs are these bounces (smooth, snappy, bouncy); 0.5 is past where a UI spring usually goes.
export const SPRINGS_LADDER = [
  { name: 'Smooth', bounce: 0 },
  { name: 'Snappy', bounce: 0.15 },
  { name: 'Bouncy', bounce: 0.3 },
  { name: 'Very bouncy', bounce: 0.5 },
] as const;

export const SPRINGS_MOVES: readonly { value: SpringsMove; label: string }[] = [
  { value: 'slide', label: 'Slide across' },
  { value: 'pop', label: 'Pop in' },
  { value: 'toggle', label: 'Flip a switch' },
];

export const SPRINGS_TIMINGS: readonly { value: SpringsTiming; label: string; why: string }[] = [
  { value: 'arrival', label: 'Arrive on the beat', why: 'Each row starts early by its own arrival, so all four get there as the light flashes. This is the studio’s rule for a move on a beat or a word.' },
  { value: 'duration', label: 'Settle on the beat', why: 'Each row starts a full duration before the beat, so it has stopped moving by the light. Watch the bouncy rows: they hit and overshoot well before it, so the beat reads late.' },
  { value: 'together', label: 'Start together', why: 'All four start at once, to show the pace is the same at every bounce: the bouncier the row, the sooner it gets there and the further it overshoots.' },
];

/** How a curves stage is seen: a video's frame rate, blurred or sharp, or a screen's 60 fps. */
export const SPRINGS_LOOKS: readonly { value: SpringsLook; label: string; fps: number }[] = [
  { value: 'videoBlur', label: 'Video, blurred', fps: LAB_FORMAT.fps },
  { value: 'video', label: 'Video, sharp', fps: LAB_FORMAT.fps },
  { value: 'screen', label: 'Screen, 60 fps', fps: 60 },
];

/** How much slower than real time a curves stage plays: its `slow` prop. */
export const CURVES_WATCH_SPEEDS = [{ value: 1, label: 'Real speed' }, { value: 2, label: '½ speed' }, { value: 4, label: '¼ speed' }] as const;

/** Both curves stages draw on this frame, smaller than the lab's so their type reads at the bench's width. */
export const CURVES_STAGE_SIZE = { width: 1600, height: 900 } as const;

const STAGE_W = CURVES_STAGE_SIZE.width;
const LABEL_W = 360;
const LANE_X = 400;
const LANE_W = 1160;
const ROW_TOP = 150;
const ROW_H = 180;
const BEAT = 1.4; // seconds into the loop of the outbound beat: room for a 1 s spring to start early and still be seen from rest
// How long each way gets before the loop turns it round: long enough for the bounciest row to have nearly settled.
const HALF_MIN = 1.2;
const HALF_MAX = 2.4;
const SLIDE_TRAVEL = 700;
const CARD_W = 200;
const CARD_H = 104;
const SPRING_COLOR = LAB_COLORS.red;

export type SpringsStageProps = { move: SpringsMove; duration: number; timing: SpringsTiming; look: SpringsLook; slow: number };

const springsRows = (duration: number) => SPRINGS_LADDER.map((r) => ({ ...r, spring: perceptualSpring(duration, r.bounce) }));

const springsHalf = (duration: number) =>
  clamp(Math.max(...springsRows(duration).map((r) => r.spring.settled)), HALF_MIN, HALF_MAX);

export const springsLoopSeconds = (duration: number) => BEAT + 2 * springsHalf(duration);

// How long before the beat a row starts: its arrival, its whole duration, or all at a shared start before the beat.
const springsLeadIn = (spring: PerceptualSpring, timing: SpringsTiming) =>
  timing === 'arrival' ? spring.arrival : timing === 'duration' ? spring.duration : spring.duration * 0.6;

export function SpringsStage({ move, duration, timing, look, slow }: SpringsStageProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps / slow;
  const rows = useMemo(() => springsRows(duration), [duration]);
  const half = springsHalf(duration);
  const beats = [BEAT, BEAT + half];
  // Out on the spring before the first beat, back on the same spring before the second. A spring is linear, so the
  // return is its own curve subtracted, and a row still wobbling as it turns round carries that into the return.
  const there = (s: PerceptualSpring, t: number) => {
    const lead = springsLeadIn(s, timing);
    return s(t - (beats[0] - lead)) - s(t - (beats[1] - lead));
  };
  const beatGlow = timing === 'together' ? 0 : Math.max(...beats.map((b) => clamp(1 - (Math.abs(t - b) * fps) / (3 * slow))));

  const scene = (t: number) => (
    <AbsoluteFill style={{ background: LAB_COLORS.ground, color: LAB_COLORS.cream, fontFamily: DISPLAY_FONT }}>
      <div style={{ position: 'absolute', left: 40, top: 36 }}>
        <div style={{ fontSize: 50, fontWeight: 900, fontStretch: '78%', textTransform: 'uppercase', lineHeight: 1 }}>One pace, four bounces</div>
        <div style={{ marginTop: 10, fontFamily: MONO_FONT, fontSize: 22, letterSpacing: '0.04em', color: LAB_COLORS.dim }}>perceptualSpring({duration.toFixed(2)}, bounce)</div>
      </div>
      {rows.map((row, r) => {
        const p = there(row.spring, t);
        const y0 = ROW_TOP + r * ROW_H;
        return (
          <div key={row.name} style={{ position: 'absolute', left: 0, top: y0, width: STAGE_W, height: ROW_H }}>
            <div style={{ position: 'absolute', left: 40, top: 44, width: LABEL_W - 40 }}>
              <div style={{ fontSize: 40, fontWeight: 900, fontStretch: '78%', textTransform: 'uppercase', lineHeight: 1 }}>{row.name}</div>
              <div style={{ marginTop: 10, fontFamily: MONO_FONT, fontSize: 19, letterSpacing: '0.04em', color: LAB_COLORS.dim, textTransform: 'uppercase' }}>
                bounce {row.bounce} · arrives {row.spring.arrival.toFixed(2)}s
              </div>
            </div>
            <div style={{ position: 'absolute', left: LANE_X, top: 18, width: LANE_W, height: ROW_H - 36, borderRadius: 14, background: LAB_COLORS.panel }}>
              <SpringsMover move={move} p={p} color={SPRING_COLOR} />
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill>
      {look === 'videoBlur' ? <ShutterBlur t={t} render={scene} /> : scene(t)}
      {/* The beat light sits outside the blur: it's a readout, not a thing that moves. */}
      {timing !== 'together' && (
        <div style={{ position: 'absolute', right: 40, top: 44, display: 'flex', alignItems: 'center', gap: 14, fontFamily: MONO_FONT, fontSize: 22, letterSpacing: '0.08em', color: LAB_COLORS.dim }}>
          <span>BEAT</span>
          <div style={{ width: 40, height: 40, borderRadius: 20, border: `2px solid ${LAB_COLORS.cream}`, background: LAB_COLORS.cream, opacity: 0.15 + 0.85 * beatGlow, boxShadow: `0 0 ${36 * beatGlow}px ${LAB_COLORS.cream}` }} />
        </div>
      )}
      {slow > 1 && <div style={{ position: 'absolute', right: 40, bottom: 16, fontFamily: MONO_FONT, fontSize: 20, letterSpacing: '0.08em', color: LAB_COLORS.dim }}>{slow}× SLOWER</div>}
    </AbsoluteFill>
  );
}

/** One row's moving thing at progress `p` (0 at rest, 1 there, past 1 while it overshoots). */
function SpringsMover({ move, p, color }: { move: SpringsMove; p: number; color: string }) {
  const laneTop = 20;
  if (move === 'slide') {
    return (
      <>
        <div style={{ position: 'absolute', left: 60 + SLIDE_TRAVEL, top: laneTop, width: CARD_W, height: CARD_H, borderRadius: 16, border: `2px dashed ${color}`, opacity: 0.35 }} />
        <SpringsCard x={60 + p * SLIDE_TRAVEL} y={laneTop} color={color} />
      </>
    );
  }
  if (move === 'pop') {
    const scale = lerp(0.2, 1, p);
    return (
      <div style={{ position: 'absolute', left: (LANE_W - CARD_W) / 2, top: laneTop, transform: `scale(${Math.max(0, scale)})`, opacity: clamp(p * 4) }}>
        <SpringsCard x={0} y={0} color={color} />
      </div>
    );
  }
  const trackW = 200, trackH = 104, knob = 86, pad = (trackH - knob) / 2;
  const left = (LANE_W - trackW) / 2;
  return (
    <div style={{ position: 'absolute', left, top: laneTop, width: trackW, height: trackH, borderRadius: trackH / 2, background: LAB_COLORS.line, overflow: 'visible' }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: trackH / 2, background: color, opacity: clamp(p) }} />
      <div style={{ position: 'absolute', top: pad, left: pad + p * (trackW - knob - 2 * pad), width: knob, height: knob, borderRadius: knob / 2, background: LAB_COLORS.cream, boxShadow: '0 6px 14px rgba(0,0,0,0.4)' }} />
    </div>
  );
}

function SpringsCard({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: CARD_W, height: CARD_H, borderRadius: 16, background: LAB_COLORS.cream, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', boxShadow: '0 12px 26px rgba(0,0,0,0.45)' }}>
      <div style={{ width: 44, height: 44, borderRadius: 22, background: color, flex: 'none' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <div style={{ height: 12, borderRadius: 6, background: '#c9c4b8' }} />
        <div style={{ height: 10, width: '60%', borderRadius: 5, background: '#dcd8cd' }} />
      </div>
    </div>
  );
}
