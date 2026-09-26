// curves-eases-stage.tsx: the Curves & springs tab's easing stage. The studio's curve families race the same card over
// the same move, one lane each under a linear one, with each curve drawn beside its lane and a dot riding it. The move
// plays out and back (or in and away) so the loop never jumps.
import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, motionCurves, motionDurations, seg, type EaseFn } from '#models/motion/motion.ts';
import { DISPLAY_FONT, MONO_FONT } from '#models/type/faces.ts';
import { ShutterBlur } from '#studio/film/motion-blur.tsx';
import { LAB_COLORS } from '../lab-format.ts';
import { CURVES_STAGE_SIZE, type SpringsLook } from './curves-springs-stage.tsx';

export type EasesRole = 'standard' | 'entrance' | 'exit';
type EasesFamily = 'linear' | 'productive' | 'expressive' | 'cubic' | 'expo';
export type EasesDurationKey = 'enterSmall' | 'enterLarge' | 'travelLong' | 'cameraPush';

// `plain` leads in the lab; `value` is the name agents and lib/models/motion/motion.ts use.
export const EASES_FAMILIES: readonly { value: EasesFamily; plain: string; gloss: string }[] = [
  { value: 'linear', plain: 'Linear', gloss: 'no easing: a machine' },
  { value: 'productive', plain: 'Brisk', gloss: 'calm app walkthroughs' },
  { value: 'expressive', plain: 'Soft', gloss: 'a walkthrough’s reveals' },
  { value: 'cubic', plain: 'House', gloss: 'captions, cards, camera' },
  { value: 'expo', plain: 'Snap', gloss: 'reels cut to music' },
];

export const EASES_ROLES: readonly { value: EasesRole; label: string; why: string }[] = [
  { value: 'entrance', label: 'Arriving', why: 'Slides in from off the frame. Starts fast and slows to a stop: slowing at the end reads as “it’s here”.' },
  { value: 'standard', label: 'Moving across', why: 'From one spot on screen to another and back. Eases out of rest and into rest, like anything with weight.' },
  { value: 'exit', label: 'Leaving', why: 'Slides off the frame. Starts slowly and speeds away: the eye has already moved on, so it needn’t see it stop.' },
];

export const EASES_DURATIONS: readonly { value: EasesDurationKey; token: string; label: string; seconds: number }[] = [
  { value: 'enterSmall', token: 'enter.small', label: 'A label', seconds: motionDurations.enter.small },
  { value: 'enterLarge', token: 'enter.large', label: 'A card', seconds: motionDurations.enter.large },
  { value: 'travelLong', token: 'travel.long', label: 'Across the screen', seconds: motionDurations.travel.long },
  { value: 'cameraPush', token: 'camera.push', label: 'A camera push', seconds: motionDurations.camera.push },
];

const easeFor = (family: EasesFamily, role: EasesRole): EaseFn => (family === 'linear' ? motionCurves.linear : motionCurves[family][role]);

const STAGE_W = CURVES_STAGE_SIZE.width;
const ROW_TOP = 60;
const ROW_H = 164;
const LANE_X = 420;
const LANE_W = 1140;
const CARD_W = 220;
const CARD_H = 104;
const HOME_X = (LANE_W - CARD_W) / 2;
const PLOT_W = 110;
const PLOT_H = 86;
const LEAD = 0.4;
const HOLD = 0.8;
const RESET = 0.3; // the quick fade that puts an arrived or departed card back for the next loop

export type EasesStageProps = { role: EasesRole; seconds: number; look: SpringsLook; slow: number };

export const easesLoopSeconds = (seconds: number, role: EasesRole) =>
  LEAD + seconds + HOLD + (role === 'standard' ? seconds : RESET) + HOLD;

// Where the card is and how visible, `t` seconds into the loop, for a move of `d` seconds on `ease`. A move across
// returns on the same curve; an arrival or departure fades back to its start instead of playing backwards.
function easesPose(role: EasesRole, ease: EaseFn, d: number, t: number) {
  const back = LEAD + d + HOLD;
  if (role === 'standard') {
    const k = seg(t, LEAD, LEAD + d, ease) - seg(t, back, back + d, ease);
    return { x: 40 + k * (LANE_W - CARD_W - 80), opacity: 1 };
  }
  const k = seg(t, LEAD, LEAD + d, ease);
  if (t < back) {
    const [from, to] = role === 'entrance' ? [-CARD_W, HOME_X] : [HOME_X, LANE_W];
    return { x: from + k * (to - from), opacity: 1 };
  }
  const reset = seg(t, back, back + RESET, motionCurves.dissolve);
  return { x: HOME_X, opacity: role === 'entrance' ? 1 - reset : reset };
}

export function EasesStage({ role, seconds, look, slow }: EasesStageProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps / slow;
  const plots = useMemo(() => EASES_FAMILIES.map((f) => {
    const ease = easeFor(f.value, role);
    return Array.from({ length: 61 }, (_, i) => `${i ? 'L' : 'M'}${(PLOT_W * i) / 60},${(PLOT_H * (1 - ease(i / 60))).toFixed(1)}`).join(' ');
  }), [role]);

  const scene = (t: number) => (
    <AbsoluteFill style={{ background: LAB_COLORS.ground, color: LAB_COLORS.cream, fontFamily: DISPLAY_FONT }}>
      {EASES_FAMILIES.map((f, i) => {
        const ease = easeFor(f.value, role);
        const pose = easesPose(role, ease, seconds, t);
        const color = f.value === 'linear' ? LAB_COLORS.dim : LAB_COLORS.red;
        const y0 = ROW_TOP + i * ROW_H;
        const plotK = clamp((t - LEAD) / seconds);
        return (
          <div key={f.value} style={{ position: 'absolute', left: 0, top: y0, width: STAGE_W, height: ROW_H }}>
            <div style={{ position: 'absolute', left: 40, top: 26 }}>
              <div style={{ fontSize: 42, fontWeight: 900, fontStretch: '78%', textTransform: 'uppercase', lineHeight: 1, color: f.value === 'linear' ? LAB_COLORS.dim : LAB_COLORS.cream }}>{f.plain}</div>
              <div style={{ marginTop: 8, fontFamily: MONO_FONT, fontSize: 19, letterSpacing: '0.04em', color: LAB_COLORS.dim }}>{f.value === 'linear' ? 'linear' : `${f.value}.${role}`}</div>
              <div style={{ marginTop: 4, fontSize: 20, color: LAB_COLORS.dim }}>{f.gloss}</div>
            </div>
            {/* The curve itself: time along, progress up. The dot rides it through the outbound move. */}
            <svg style={{ position: 'absolute', left: 270, top: (ROW_H - PLOT_H) / 2, overflow: 'visible' }} width={PLOT_W} height={PLOT_H}>
              <rect x={0} y={0} width={PLOT_W} height={PLOT_H} fill={LAB_COLORS.panel} rx={6} />
              <path d={plots[i]} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" />
              <circle cx={PLOT_W * plotK} cy={PLOT_H * (1 - ease(plotK))} r={7} fill={LAB_COLORS.cream} />
            </svg>
            <div style={{ position: 'absolute', left: LANE_X, top: (ROW_H - CARD_H) / 2 - 12, width: LANE_W, height: CARD_H + 24, borderRadius: 14, background: LAB_COLORS.panel, overflow: 'hidden' }}>
              {role !== 'exit' && <div style={{ position: 'absolute', left: role === 'entrance' ? HOME_X : LANE_W - CARD_W - 40, top: 12, width: CARD_W, height: CARD_H, borderRadius: 14, border: `2px dashed ${LAB_COLORS.line}` }} />}
              <EasesCard x={pose.x} y={12} opacity={pose.opacity} color={color} />
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill>
      {look === 'videoBlur' ? <ShutterBlur t={t} render={scene} /> : scene(t)}
      {slow > 1 && <div style={{ position: 'absolute', right: 40, bottom: 16, fontFamily: MONO_FONT, fontSize: 20, letterSpacing: '0.08em', color: LAB_COLORS.dim }}>{slow}× SLOWER</div>}
    </AbsoluteFill>
  );
}

function EasesCard({ x, y, opacity, color }: { x: number; y: number; opacity: number; color: string }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: CARD_W, height: CARD_H, opacity, borderRadius: 14, background: LAB_COLORS.cream, display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px', boxShadow: '0 10px 24px rgba(0,0,0,0.45)' }}>
      <div style={{ width: 50, height: 50, borderRadius: 25, background: color, flex: 'none' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
        <div style={{ height: 13, borderRadius: 7, background: '#c9c4b8' }} />
        <div style={{ height: 11, width: '60%', borderRadius: 6, background: '#dcd8cd' }} />
      </div>
    </div>
  );
}
