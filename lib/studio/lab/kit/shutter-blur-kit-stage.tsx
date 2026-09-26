// shutter-blur-kit-stage.tsx: the Kit pieces stage for ShutterBlur: a card whipping across two lanes, one without
// motion blur and one with, each ticking where the card was on every frame so far.
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { motionCurves, seg } from '#models/motion/motion.ts';
import { DISPLAY_FONT } from '#models/type/faces.ts';
import { ShutterBlur } from '../../film/motion-blur.tsx';
import { LAB_COLORS, LAB_FORMAT } from '../lab-format.ts';
import { KIT_STAGE_HUD_TYPE } from './kit-stage-clock.tsx';

export type ShutterBlurKitProps = { shutter: number; samples: number; crossing: number; slow: number };

export const SHUTTER_BLUR_KIT_DEFAULTS: ShutterBlurKitProps = { shutter: 0.5, samples: 8, crossing: 0.4, slow: 1 };

const SHUTTER_LEAD = 0.3;
const SHUTTER_PAUSE = 0.6;
const LANE_H = 470;
const LANE_TOPS = [50, 560];
const PUCK = 230;
const PUCK_X0 = 120;
const PUCK_X1 = LAB_FORMAT.width - 120 - PUCK;

export const shutterBlurKitSeconds = (p: ShutterBlurKitProps) => (SHUTTER_LEAD + 2 * (p.crossing + SHUTTER_PAUSE)) * p.slow;

/** Where the card is at `t` seconds: a whip right, a pause, a whip back. */
function shutterPuckX(t: number, crossing: number) {
  const back = SHUTTER_LEAD + crossing + SHUTTER_PAUSE;
  const k = seg(t, SHUTTER_LEAD, SHUTTER_LEAD + crossing, motionCurves.cubic.standard) - seg(t, back, back + crossing, motionCurves.cubic.standard);
  return PUCK_X0 + k * (PUCK_X1 - PUCK_X0);
}

/** One lane at time `t`, drawing its own background: ShutterBlur's averaging is only exact over opaque frames. */
function ShutterLane({ t, crossing }: { t: number; crossing: number }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: LAB_COLORS.panel }}>
      <div style={{ position: 'absolute', left: shutterPuckX(t, crossing), top: (LANE_H - PUCK) / 2, width: PUCK, height: PUCK, borderRadius: 32, background: LAB_COLORS.cream, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 900, fontStretch: '70%', fontSize: 120, color: LAB_COLORS.red, lineHeight: 1 }}>GO</div>
      </div>
    </div>
  );
}

export function ShutterBlurKitStage(p: ShutterBlurKitProps) {
  const frame = useCurrentFrame();
  // Slowed down, each 30 fps frame is held `slow` times over, so its jumps are seen rather than smoothed away.
  const videoFrame = Math.floor(frame / p.slow);
  const t = videoFrame / LAB_FORMAT.fps;
  const framesSoFar = Array.from({ length: videoFrame + 1 }, (_, f) => shutterPuckX(f / LAB_FORMAT.fps, p.crossing) + PUCK / 2);
  const lanes = [
    { label: '30 frames a second · no motion blur', blurred: false },
    { label: `30 frames a second · shutter ${Math.round(p.shutter * 360)}° · ${p.samples} copies blended`, blurred: true },
  ];
  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground }}>
      {lanes.map((lane, i) => (
        <div key={lane.label} style={{ position: 'absolute', left: 0, top: LANE_TOPS[i], width: LAB_FORMAT.width, height: LANE_H, overflow: 'hidden' }}>
          {lane.blurred
            ? <ShutterBlur t={t} shutter={p.shutter} samples={p.samples} render={(at) => <ShutterLane t={at} crossing={p.crossing} />} />
            : <ShutterLane t={t} crossing={p.crossing} />}
          <div style={{ ...KIT_STAGE_HUD_TYPE, position: 'absolute', left: 40, top: 28, color: lane.blurred ? LAB_COLORS.red : LAB_COLORS.dim }}>{lane.label}</div>
          {/* A tick where the card was on each frame so far: wide gaps are the jumps the eye sees as strobing. */}
          <svg style={{ position: 'absolute', left: 0, bottom: 20 }} width={LAB_FORMAT.width} height={24}>
            {framesSoFar.map((x, f) => <line key={f} x1={x} x2={x} y1={0} y2={20} stroke={lane.blurred ? LAB_COLORS.red : LAB_COLORS.cream} strokeWidth={3} opacity={0.5} />)}
          </svg>
        </div>
      ))}
      <div style={{ ...KIT_STAGE_HUD_TYPE, position: 'absolute', left: 40, right: 40, top: 1040, fontSize: 18, color: LAB_COLORS.dim, textAlign: 'right' }}>
        {p.slow > 1 ? `${p.slow}× slower · each frame held ${p.slow}×` : 'real speed'} · frame {videoFrame}
      </div>
    </AbsoluteFill>
  );
}
