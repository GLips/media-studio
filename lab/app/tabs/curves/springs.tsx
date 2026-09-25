// springs.tsx: the Curves & springs tab's spring bench. The studio's two spring models side by side, on the same move
// and the same four bounces: `springBy`, whose duration is a deadline it arrives on, and `perceptualSpring` (Apple's
// spring(duration:bounce:)), whose duration is the pace of its swing. Each row goes out and comes back on its spring,
// so the loop never jumps; a beat light flashes at the deadline so "lands on the beat" can be seen.
import { useMemo, useState } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { DISPLAY_FONT, MONO_FONT } from '../../../../lib/studio/fonts.ts';
import { FPS } from '../../../../lib/studio/frame.ts';
import { ShutterBlur } from '../../../../lib/studio/motion-blur.tsx';
import { clamp, lerp, perceptualSpring, springBy } from '../../../../lib/studio/motion.ts';
import { LAB_COLORS, LabBench, LabChoice, LabControls, LabNote, LabSlider, LabStage } from '../../ui.tsx';

type SpringsMove = 'slide' | 'pop' | 'toggle';
type SpringsModel = 'deadline' | 'perceptual';
export type SpringsLook = 'video' | 'videoBlur' | 'screen';

// Apple's named springs are these bounces (smooth, snappy, bouncy); 0.5 is past where a UI spring usually goes.
const SPRINGS_LADDER = [
  { name: 'Smooth', bounce: 0 },
  { name: 'Snappy', bounce: 0.15 },
  { name: 'Bouncy', bounce: 0.3 },
  { name: 'Very bouncy', bounce: 0.5 },
] as const;

const SPRINGS_MOVES: readonly { value: SpringsMove; label: string }[] = [
  { value: 'slide', label: 'Slide across' },
  { value: 'pop', label: 'Pop in' },
  { value: 'toggle', label: 'Flip a switch' },
];

export const SPRINGS_LOOKS: readonly { value: SpringsLook; label: string; fps: number }[] = [
  { value: 'videoBlur', label: 'Video, blurred', fps: FPS },
  { value: 'video', label: 'Video, sharp', fps: FPS },
  { value: 'screen', label: 'Screen, 60 fps', fps: 60 },
];

const WATCH_SPEEDS = [{ value: 1, label: 'Real speed' }, { value: 2, label: '½ speed' }, { value: 4, label: '¼ speed' }] as const;

const STAGE_W = 1600;
const STAGE_H = 940;
const COL_X = [40, 820];
const COL_W = 740;
const ROW_TOP = 210;
const ROW_H = 176;
const LEAD = 0.4; // seconds at rest before it goes, so the start is seen from still
// How long each way gets before the loop turns it round: long enough for the bounciest row to have nearly settled.
const HALF_MIN = 1.1;
const HALF_MAX = 2.4;
const SLIDE_TRAVEL = 420;
const CARD_W = 170;
const CARD_H = 96;
const COL_COLORS: Record<SpringsModel, string> = { deadline: '#8f91ff', perceptual: LAB_COLORS.red };

type SpringsStageProps = { move: SpringsMove; duration: number; look: SpringsLook; slow: number };

function springsRows(duration: number) {
  return SPRINGS_LADDER.map((r) => ({ ...r, deadline: springBy(duration, r.bounce), perceptual: perceptualSpring(duration, r.bounce) }));
}

const springsHalf = (duration: number) =>
  clamp(Math.max(...springsRows(duration).flatMap((r) => [r.deadline.settled, r.perceptual.settled])), HALF_MIN, HALF_MAX);

export const springsLoopSeconds = (duration: number) => LEAD + 2 * springsHalf(duration);

function SpringsStage({ move, duration, look, slow }: SpringsStageProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps / slow;
  const rows = useMemo(() => springsRows(duration), [duration]);
  const half = springsHalf(duration);
  // Out on the spring from LEAD, back on the same spring from LEAD + half. A spring is linear, so the return is its
  // own curve subtracted, and a row still wobbling when it turns round carries that wobble smoothly into the return.
  const there = (s: (t: number) => number, t: number) => s(t - LEAD) - s(t - LEAD - half);
  const beats = [LEAD + duration, LEAD + half + duration];
  const beatGlow = Math.max(...beats.map((b) => clamp(1 - Math.abs(t - b) * fps / 3)));

  const scene = (t: number) => (
    <AbsoluteFill style={{ background: LAB_COLORS.ground, color: LAB_COLORS.cream, fontFamily: DISPLAY_FONT }}>
      {(['deadline', 'perceptual'] as const).map((model, c) => {
        const x0 = COL_X[c];
        const color = COL_COLORS[model];
        return (
          <div key={model} style={{ position: 'absolute', left: x0, top: 0, width: COL_W, height: STAGE_H }}>
            <div style={{ position: 'absolute', left: 0, top: 36, right: 0 }}>
              <div style={{ fontSize: 50, fontWeight: 900, fontStretch: '78%', textTransform: 'uppercase', color, lineHeight: 1 }}>
                {model === 'deadline' ? 'Deadline' : 'Perceptual'}
              </div>
              <div style={{ marginTop: 10, fontFamily: MONO_FONT, fontSize: 22, letterSpacing: '0.04em', color: LAB_COLORS.dim }}>
                {model === 'deadline' ? `springBy(${duration.toFixed(2)}, bounce)` : `perceptualSpring(${duration.toFixed(2)}, bounce)`}
              </div>
              <div style={{ marginTop: 6, fontSize: 25, color: LAB_COLORS.cream, opacity: 0.85 }}>
                {model === 'deadline' ? 'Arrives exactly on the beat, whatever the bounce' : 'Swings at the same pace, whatever the bounce'}
              </div>
            </div>
            {rows.map((row, r) => {
              const s = row[model];
              const p = there(s, t);
              const y0 = ROW_TOP + r * ROW_H;
              return (
                <div key={row.name} style={{ position: 'absolute', left: 0, top: y0, width: COL_W, height: ROW_H }}>
                  <div style={{ position: 'absolute', left: 0, right: 0, top: 18, display: 'flex', justifyContent: 'space-between', fontFamily: MONO_FONT, fontSize: 20, letterSpacing: '0.05em', textTransform: 'uppercase', color: LAB_COLORS.dim }}>
                    <span><span style={{ color: LAB_COLORS.cream }}>{row.name}</span> · bounce {row.bounce}</span>
                    <span>there {s.landed.toFixed(2)}s · still {s.settled.toFixed(1)}s</span>
                  </div>
                  <div style={{ position: 'absolute', left: 0, right: 0, top: 54, height: 1, background: LAB_COLORS.line }} />
                  <SpringsMover move={move} p={p} color={color} />
                </div>
              );
            })}
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: COL_X[1] - 40, top: 40, bottom: 40, width: 2, background: LAB_COLORS.line }} />
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill>
      {look === 'videoBlur' ? <ShutterBlur t={t} render={scene} /> : scene(t)}
      {/* The beat light sits outside the blur: it's a readout, not a thing that moves. */}
      <div style={{ position: 'absolute', right: 40, top: 40, display: 'flex', alignItems: 'center', gap: 14, fontFamily: MONO_FONT, fontSize: 20, letterSpacing: '0.08em', color: LAB_COLORS.dim }}>
        <span>BEAT</span>
        <div style={{ width: 30, height: 30, borderRadius: 15, border: `2px solid ${LAB_COLORS.cream}`, background: LAB_COLORS.cream, opacity: 0.2 + 0.8 * beatGlow, boxShadow: `0 0 ${30 * beatGlow}px ${LAB_COLORS.cream}` }} />
      </div>
      {slow > 1 && <div style={{ position: 'absolute', right: 40, bottom: 20, fontFamily: MONO_FONT, fontSize: 20, letterSpacing: '0.08em', color: LAB_COLORS.dim }}>{slow}× SLOWER</div>}
    </AbsoluteFill>
  );
}

/** One row's moving thing at progress `p` (0 at rest, 1 there, past 1 while it overshoots). */
function SpringsMover({ move, p, color }: { move: SpringsMove; p: number; color: string }) {
  const laneTop = 72;
  if (move === 'slide') {
    return (
      <>
        <div style={{ position: 'absolute', left: 40 + SLIDE_TRAVEL, top: laneTop, width: CARD_W, height: CARD_H, borderRadius: 16, border: `2px dashed ${color}`, opacity: 0.35 }} />
        <SpringsCard x={40 + p * SLIDE_TRAVEL} y={laneTop} color={color} />
      </>
    );
  }
  if (move === 'pop') {
    const scale = lerp(0.2, 1, p);
    return (
      <div style={{ position: 'absolute', left: (COL_W - CARD_W) / 2, top: laneTop, transform: `scale(${Math.max(0, scale)})`, opacity: clamp(p * 4) }}>
        <SpringsCard x={0} y={0} color={color} />
      </div>
    );
  }
  const trackW = 190, trackH = 92, knob = 76, pad = (trackH - knob) / 2;
  const left = (COL_W - trackW) / 2;
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

export function CurvesSpringsBench() {
  const [move, setMove] = useState<SpringsMove>('slide');
  const [duration, setDuration] = useState(0.5);
  const [look, setLook] = useState<SpringsLook>('videoBlur');
  const [slow, setSlow] = useState<number>(1);
  const fps = SPRINGS_LOOKS.find((l) => l.value === look)!.fps;

  return (
    <>
      <LabBench
        stage={
          <LabStage
            key={`${look}`}
            component={SpringsStage}
            inputProps={{ move, duration, look, slow }}
            seconds={springsLoopSeconds(duration) * slow}
            width={STAGE_W}
            height={STAGE_H}
            fps={fps}
            label="TWO WAYS TO TIME A SPRING"
          />
        }
      >
        <LabControls>
          <LabChoice label="The move" options={SPRINGS_MOVES} value={move} onChange={setMove} hint="Each row goes there and back on its spring. The four rows are the same spring at four bounces." />
          <LabSlider
            label="Duration"
            value={duration}
            min={0.2}
            max={1}
            step={0.05}
            format={(v) => `${v.toFixed(2)}s`}
            onChange={setDuration}
            hint={<>The same number means two things. <b>Deadline</b>: the moment it gets there, so it can land on a beat (the light flashes then). <b>Perceptual</b>: how long one swing takes, so every bounce feels as quick. Apple’s default is 0.5s.</>}
          />
          <LabChoice
            label="Seen as"
            options={SPRINGS_LOOKS}
            value={look}
            onChange={setLook}
            hint={look === 'screen'
              ? 'How a phone or browser animates: a new picture every 60th of a second. Smoother than any video, so don’t judge a video’s motion by it.'
              : look === 'video'
                ? 'What a video shows: 30 pictures a second, each one sharp. Anything quick visibly jumps between pictures.'
                : 'What a video shows with a camera’s blur on each picture, as the showcase reel renders: fast moves smear instead of jumping.'}
          />
          <LabChoice label="Watch at" options={WATCH_SPEEDS} value={slow} onChange={setSlow} />
        </LabControls>
      </LabBench>
      <LabNote>
        <b>What to look for:</b> down the left, the rows all arrive together on the beat, so the bouncier ones have to move slower to do it; the “very bouncy” one drifts lazily and rings on. Down the right, every row swings at the same pace and a bouncier one only overshoots more. So a bouncy one arrives well before the beat and a smooth one a little after it: the beat is no longer where it lands.
      </LabNote>
      <details className="curves-agents">
        <summary>For agents</summary>
        <pre>{[
          ...SPRINGS_LADDER.map((r) => `springBy(${duration}, ${r.bounce})${' '.repeat(Math.max(1, 6 - String(r.bounce).length))}// there ${springBy(duration, r.bounce).landed.toFixed(2)}s, still ${springBy(duration, r.bounce).settled.toFixed(2)}s`),
          ...SPRINGS_LADDER.map((r) => `perceptualSpring(${duration}, ${r.bounce})${' '.repeat(Math.max(1, 6 - String(r.bounce).length))}// there ${perceptualSpring(duration, r.bounce).landed.toFixed(2)}s, still ${perceptualSpring(duration, r.bounce).settled.toFixed(2)}s`),
        ].join('\n')}</pre>
      </details>
    </>
  );
}
