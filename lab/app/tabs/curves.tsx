// curves.tsx: the lab's Curves & springs tab. One card makes the same journey three times, stacked: at constant
// speed, on a named curve token from lib/studio/motion.ts, and on a deadline spring (springBy). Under each lane a speed
// graph, with a dot riding the current moment, shows where the move is fast and where it eases.
import { useMemo, useState } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { DISPLAY_FONT, MONO_FONT } from '../../../lib/studio/fonts.ts';
import { motionCurves, motionDurations, springBy, type DeadlineSpring, type EaseFn } from '../../../lib/studio/motion.ts';
import { LAB_COLORS, LabChoice, LabControls, LabNote, LabSlider, LabStage, LabTabIntro } from '../ui.tsx';
import './curves.css';

type CurveSystem = 'productive' | 'expressive' | 'cubic' | 'expo' | 'dissolve';
type CurveRole = 'standard' | 'entrance' | 'exit';
type CurvesDurationKey = 'press' | 'dissolve' | 'exit' | 'enterSmall' | 'enterLarge' | 'travelLong' | 'cameraPush';

const CURVE_SYSTEMS: readonly { value: CurveSystem; label: string; why: string }[] = [
  { value: 'productive', label: 'Productive', why: 'Brisk and plain. For walkthroughs of an app, where motion should do its job and get out of the way.' },
  { value: 'expressive', label: 'Expressive', why: 'A longer, softer landing. For a walkthrough’s reveals and moments that matter.' },
  { value: 'cubic', label: 'Cubic', why: 'The studio’s house default: captions, text, cards and the camera already move on it. Stronger at both ends than Productive.' },
  { value: 'expo', label: 'Expo', why: 'The showreel snap: half the distance in the first tenth of the time, then a long glide in. Lands hard on a music beat. Too punchy for a calm walkthrough, right for teasers and reels.' },
  { value: 'dissolve', label: 'Dissolve', why: 'Even and symmetric, made for fades rather than moves: a fade shouldn’t visibly speed up. It has no roles.' },
];

const CURVE_ROLES: readonly { value: CurveRole; label: string; why: string }[] = [
  { value: 'entrance', label: 'Arriving', why: 'Starts fast and slows to a stop, like something set down on a table. Slowing down at the end reads as “arrived”.' },
  { value: 'standard', label: 'Moving within the frame', why: 'Eases out of rest and eases into rest, like anything with weight moving from one place to another.' },
  { value: 'exit', label: 'Leaving', why: 'Starts slowly and speeds away. Meant for things leaving the frame: the eye has already moved on, so it needn’t see them stop.' },
];

const CURVE_DURATIONS: readonly { value: CurvesDurationKey; label: string; seconds: number }[] = [
  { value: 'press', label: 'A button press', seconds: motionDurations.press },
  { value: 'dissolve', label: 'A page fading', seconds: motionDurations.dissolve },
  { value: 'exit', label: 'Something leaving', seconds: motionDurations.exit },
  { value: 'enterSmall', label: 'A label arriving', seconds: motionDurations.enter.small },
  { value: 'enterLarge', label: 'A card arriving', seconds: motionDurations.enter.large },
  { value: 'travelLong', label: 'Crossing the screen', seconds: motionDurations.travel.long },
  { value: 'cameraPush', label: 'A camera push-in', seconds: motionDurations.camera.push },
];

const WATCH_SPEEDS = [
  { value: 1, label: 'Real speed' },
  { value: 2, label: '½ speed' },
  { value: 4, label: '¼ speed' },
] as const;

const curveFor = (system: CurveSystem, role: CurveRole): EaseFn =>
  system === 'dissolve' ? motionCurves.dissolve : motionCurves[system][role];

// ---------- the stage ----------

const LEAD = 0.5; // seconds the card waits before every lane starts, so the start is seen from rest
const HOLD = 1.0; // seconds after the last lane settles, so the landing is visible before the loop restarts
const TRACK_X0 = 150;
const TRACK_X1 = 1770;
const CARD_W = 330;
// Home sits left of the track's end, leaving room for the bounciest spring's overshoot to stay on screen.
const HOME_X = 1100;
const CARD_H = 96;
const LANE_TOP = [120, 440, 760];
const GRAPH_H = 96;
const GRAPH_SAMPLES = 360;
const SPRING_STROKE = '#8f91ff'; // cobalt lifted so a thin line reads on the near-black ground

type CurvesStageProps = {
  system: CurveSystem;
  role: CurveRole;
  curveSeconds: number;
  springSeconds: number;
  bounce: number;
  slow: number;
};

type CurvesLane = {
  name: string;
  sub: string;
  color: string;
  stroke: string;
  at: (t: number) => number;
  status: (t: number) => string;
  marks: { t: number; label: string }[];
};

// A very bouncy spring takes many seconds to settle fully; past a couple of seconds of wobble the loop stops waiting,
// so the short moves beside it aren't squashed to slivers on the time axis.
const SPRING_WATCH = 2.5;
const curvesMoveEnd = (curveSeconds: number, spring: DeadlineSpring) =>
  Math.max(curveSeconds, Math.min(spring.settled, spring.landed + SPRING_WATCH));

function curvesLoopSeconds({ curveSeconds, springSeconds, bounce }: Pick<CurvesStageProps, 'curveSeconds' | 'springSeconds' | 'bounce'>) {
  return LEAD + curvesMoveEnd(curveSeconds, springBy(springSeconds, bounce)) + HOLD;
}

function CurvesStage({ system, role, curveSeconds, springSeconds, bounce, slow }: CurvesStageProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps / slow - LEAD;

  const { lanes, graphs, tEnd, scales } = useMemo(() => {
    const ease = curveFor(system, role);
    const spring = springBy(springSeconds, bounce);
    const end = curvesMoveEnd(curveSeconds, spring) + HOLD;
    const tween = (fn: EaseFn) => (s: number) => fn(s / curveSeconds);
    const tweenStatus = (s: number) => (s < 0 ? 'Waiting' : s < curveSeconds ? 'Moving' : 'Arrived');
    const systemLabel = CURVE_SYSTEMS.find((c) => c.value === system)!.label;
    const roleLabel = system === 'dissolve' ? '' : ` · ${CURVE_ROLES.find((r) => r.value === role)!.label.toLowerCase()}`;
    const built: CurvesLane[] = [
      {
        name: 'Linear', sub: `No easing · constant speed · ${curveSeconds}s`, color: LAB_COLORS.dim, stroke: LAB_COLORS.cream,
        at: tween(motionCurves.linear), status: tweenStatus, marks: [{ t: curveSeconds, label: 'arrives' }],
      },
      {
        name: `${systemLabel}${roleLabel}`, sub: `Curve token · ${curveSeconds}s`, color: LAB_COLORS.red, stroke: LAB_COLORS.red,
        at: tween(ease), status: tweenStatus, marks: [{ t: curveSeconds, label: 'arrives' }],
      },
      {
        name: 'Spring', sub: `Bounce ${bounce.toFixed(2)} · lands ${spring.landed.toFixed(2)}s · settles ${spring.settled.toFixed(2)}s`,
        color: LAB_COLORS.cobalt, stroke: SPRING_STROKE, at: spring,
        status: (s) => (s < 0 ? 'Waiting' : s < spring.landed ? 'Moving' : s < spring.settled ? 'Landed · still settling' : 'Settled'),
        marks: [{ t: spring.landed, label: 'lands' }, { t: spring.settled, label: 'settles' }],
      },
    ];
    // Speed is progress per second, sampled across the whole loop. Linear and the curve share a scale (same duration,
    // so a taller bump really is a faster card); the spring gets its own, or a short curve would flatten it to nothing.
    const h = 1 / 240;
    const speeds = built.map((lane) =>
      Array.from({ length: GRAPH_SAMPLES + 1 }, (_, i) => {
        const s = -LEAD + ((end + LEAD) * i) / GRAPH_SAMPLES;
        return (lane.at(s + h) - lane.at(s - h)) / (2 * h);
      }));
    const range = (vs: number[]) => ({ top: Math.max(...vs), bottom: Math.min(0, ...vs) });
    const tweens = range([...speeds[0], ...speeds[1]]);
    return { lanes: built, graphs: speeds, tEnd: end, scales: [tweens, tweens, range(speeds[2])] };
  }, [system, role, curveSeconds, springSeconds, bounce]);

  const timeX = (s: number) => TRACK_X0 + ((s + LEAD) / (tEnd + LEAD)) * (TRACK_X1 - TRACK_X0);
  const cardX = (k: number) => TRACK_X0 + k * (HOME_X - TRACK_X0);
  const pastFrames = Array.from({ length: frame + 1 }, (_, f) => f / fps / slow - LEAD);

  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground, color: LAB_COLORS.cream, fontFamily: DISPLAY_FONT }}>
      <div style={{ position: 'absolute', left: TRACK_X0, right: 1920 - TRACK_X1, top: 44, display: 'flex', justifyContent: 'space-between', fontFamily: MONO_FONT, fontSize: 22, letterSpacing: '0.08em', color: LAB_COLORS.dim }}>
        <span>SAME CARD · SAME DISTANCE · THREE WAYS TO GET THERE</span>
        <span>{slow > 1 ? `${slow}× SLOWER · ` : ''}T = {Math.max(0, t).toFixed(2)}S</span>
      </div>
      {lanes.map((lane, i) => {
        const top = LANE_TOP[i];
        const k = lane.at(t);
        const speeds = graphs[i];
        const { top: speedTop, bottom: speedBottom } = scales[i];
        const speedY = (v: number) => (GRAPH_H * (speedTop - v)) / (speedTop - speedBottom);
        const path = speeds.map((v, j) => `${j ? 'L' : 'M'}${(TRACK_X1 - TRACK_X0) * j / GRAPH_SAMPLES},${speedY(v).toFixed(1)}`).join(' ');
        const zeroY = speedY(0);
        const nowV = speeds[Math.round(((t + LEAD) / (tEnd + LEAD)) * GRAPH_SAMPLES)] ?? 0;
        return (
          <div key={i} style={{ position: 'absolute', left: 0, top, width: 1920, height: 300 }}>
            <div style={{ position: 'absolute', left: TRACK_X0, right: 1920 - TRACK_X1, top: 0, display: 'flex', alignItems: 'baseline', gap: 20 }}>
              <span style={{ fontSize: 36, fontWeight: 900, fontStretch: '80%', textTransform: 'uppercase', color: lane.stroke }}>{lane.name}</span>
              <span style={{ fontFamily: MONO_FONT, fontSize: 18, letterSpacing: '0.06em', color: LAB_COLORS.dim, textTransform: 'uppercase' }}>{lane.sub}</span>
              <span style={{ marginLeft: 'auto', fontFamily: MONO_FONT, fontSize: 18, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: 999, border: `2px solid ${lane.stroke}`, color: lane.stroke }}>{lane.status(t)}</span>
            </div>
            {/* The start and home slots, drawn under the card so an overshoot past home is plain to see. */}
            <div style={{ position: 'absolute', left: TRACK_X0, top: 54, width: CARD_W, height: CARD_H, borderRadius: 16, border: `2px dashed ${LAB_COLORS.line}` }} />
            <div style={{ position: 'absolute', left: cardX(1), top: 54, width: CARD_W, height: CARD_H, borderRadius: 16, border: `2px dashed ${lane.stroke}`, opacity: 0.5 }} />
            {/* One tick per video frame at where the card was: bunched ticks are slow stretches, spread ticks fast. */}
            <svg style={{ position: 'absolute', left: 0, top: 54 + CARD_H + 6 }} width={1920} height={18}>
              {pastFrames.map((s, f) => {
                const x = cardX(lane.at(s)) + CARD_W / 2;
                return <line key={f} x1={x} x2={x} y1={0} y2={14} stroke={lane.stroke} strokeWidth={2} opacity={0.55} />;
              })}
            </svg>
            <CurvesCard x={cardX(k)} y={54} color={lane.color} />
            <svg style={{ position: 'absolute', left: TRACK_X0, top: 188, overflow: 'visible' }} width={TRACK_X1 - TRACK_X0} height={GRAPH_H}>
              <rect x={0} y={0} width={TRACK_X1 - TRACK_X0} height={GRAPH_H} fill={LAB_COLORS.panel} rx={6} />
              <line x1={0} x2={TRACK_X1 - TRACK_X0} y1={zeroY} y2={zeroY} stroke={LAB_COLORS.line} strokeWidth={2} />
              <path d={`${path} L${TRACK_X1 - TRACK_X0},${zeroY} L0,${zeroY} Z`} fill={lane.stroke} opacity={0.18} />
              <path d={path} fill="none" stroke={lane.stroke} strokeWidth={3} strokeLinejoin="round" />
              {[{ t: 0, label: 'starts' }, ...lane.marks].filter((m) => m.t <= tEnd).map((m, j) => (
                <g key={m.label}>
                  <line x1={timeX(m.t) - TRACK_X0} x2={timeX(m.t) - TRACK_X0} y1={0} y2={GRAPH_H} stroke={LAB_COLORS.dim} strokeWidth={1.5} strokeDasharray="4 5" />
                  <text x={timeX(m.t) - TRACK_X0 + 6} y={j % 2 ? 22 : GRAPH_H - 8} fill={LAB_COLORS.dim} fontFamily={MONO_FONT} fontSize={16} letterSpacing="0.06em">{m.label.toUpperCase()}</text>
                </g>
              ))}
              <line x1={timeX(t) - TRACK_X0} x2={timeX(t) - TRACK_X0} y1={-4} y2={GRAPH_H + 4} stroke={LAB_COLORS.cream} strokeWidth={2} opacity={0.6} />
              <circle cx={timeX(t) - TRACK_X0} cy={speedY(nowV)} r={9} fill={LAB_COLORS.cream} stroke={LAB_COLORS.ground} strokeWidth={3} />
            </svg>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: TRACK_X0, right: 1920 - TRACK_X1, top: 1040, display: 'flex', justifyContent: 'space-between', fontFamily: MONO_FONT, fontSize: 18, letterSpacing: '0.06em', color: LAB_COLORS.dim }}>
        <span>GRAPHS: SPEED OVER TIME — HIGHER IS FASTER, BELOW THE LINE IS BACKWARDS</span>
        <span>TIME →</span>
      </div>
    </AbsoluteFill>
  );
}

/** A shipping notification: something a real video would move, so the motion reads as an object with weight. */
function CurvesCard({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: CARD_W, height: CARD_H, borderRadius: 16, background: LAB_COLORS.cream, color: LAB_COLORS.ink, display: 'flex', alignItems: 'center', gap: 18, padding: '0 22px', boxShadow: '0 14px 30px rgba(0,0,0,0.45)' }}>
      <svg width={52} height={52} viewBox="0 0 52 52" style={{ flex: 'none' }}>
        <circle cx={26} cy={26} r={26} fill={color} />
        <path d="M15 27 l7 7 l15 -16" fill="none" stroke={LAB_COLORS.cream} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 30, fontWeight: 800, fontStretch: '85%', lineHeight: 1.05 }}>Order shipped</span>
        <span style={{ fontFamily: MONO_FONT, fontSize: 17, letterSpacing: '0.06em', color: '#6b6760' }}>#4821 · 2 ITEMS</span>
      </div>
    </div>
  );
}

// ---------- the tab ----------

export function CurvesTab() {
  const [system, setSystem] = useState<CurveSystem>('productive');
  const [role, setRole] = useState<CurveRole>('entrance');
  const [durationKey, setDurationKey] = useState<CurvesDurationKey>('travelLong');
  const [springSeconds, setSpringSeconds] = useState(1);
  const [bounce, setBounce] = useState(0.3);
  const [slow, setSlow] = useState<number>(1);

  const curveSeconds = CURVE_DURATIONS.find((d) => d.value === durationKey)!.seconds;
  const spring = springBy(springSeconds, bounce);
  const loopSeconds = curvesLoopSeconds({ curveSeconds, springSeconds, bounce });
  const systemWhy = CURVE_SYSTEMS.find((c) => c.value === system)!.why;
  const roleWhy = CURVE_ROLES.find((r) => r.value === role)!.why;

  return (
    <>
      <LabTabIntro
        number={1}
        title="Curves & springs"
        what={<>How something gets from A to B. Almost nothing in the real world moves at a steady speed: it picks up speed, then slows to a stop. An <b>easing curve</b> is that speed-up and slow-down, written down so every move in a video shares it. A <b>spring</b> is the physical version: the object is pulled home as if by a rubber band, and can overshoot and wobble before it settles.</>}
        when="Every move in every video: a card sliding in, a caption popping up, the camera pushing in on a detail. Walkthroughs of an app use calm curves; teasers and showreels cut to music use snappier ones and springs."
        bad="Linear motion: the thing starts at full speed and stops dead, like a robot. Or a mix of unrelated curves, so the video feels twitchy, or a bouncy spring on something serious."
        good="Things arrive fast and slow into place, so the eye knows exactly when they’ve landed. One family of curves throughout, and springs saved for things that should feel alive."
      />
      <LabStage
        component={CurvesStage}
        inputProps={{ system, role, curveSeconds, springSeconds, bounce, slow }}
        seconds={loopSeconds * slow}
        label="LINEAR vs CURVE vs SPRING"
      />
      <LabNote>
        Each graph under a card is its <b>speed</b>: the bump is where it’s fastest, and flat along the bottom is standing still.
        Linear is a flat-topped box, which is why it looks mechanical. (Linear and the curve share a scale; the spring’s graph has its own.) The ticks under each card mark where it was on every frame of video: bunched up where it’s slow, spread out where it’s quick.
      </LabNote>
      <div className="curves-controls">
        <LabControls>
          <LabChoice label="Curve family" options={CURVE_SYSTEMS} value={system} onChange={setSystem} hint={systemWhy} />
          <LabChoice
            label="What the move is doing"
            options={CURVE_ROLES}
            value={role}
            onChange={setRole}
            hint={system === 'dissolve' ? 'Dissolve is one curve for fades, so this has no effect on it.' : roleWhy}
          />
          <LabChoice
            label="How long the move takes"
            options={CURVE_DURATIONS.map((d) => ({ value: d.value, label: `${d.label} · ${d.seconds}s` }))}
            value={durationKey}
            onChange={setDurationKey}
            hint="The studio’s standard lengths. Short: the viewer sees each move once, at full speed. Linear and the curve both use this."
          />
          <LabSlider
            label="Spring: arrives after"
            value={springSeconds}
            min={0.2}
            max={1.5}
            step={0.05}
            format={(v) => `${v.toFixed(2)}s`}
            onChange={setSpringSeconds}
            hint="The spring is timed to reach home at this moment, so it can land on a word or a beat. It may keep wobbling after."
          />
          <LabSlider
            label="Spring: bounce"
            value={bounce}
            min={0}
            max={0.75}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={setBounce}
            hint={bounce === 0
              ? 'No bounce: glides in without overshooting, like a well-damped door.'
              : `Overshoots home and swings back. It lands at ${spring.landed.toFixed(2)}s but isn’t still until ${spring.settled.toFixed(2)}s.`}
          />
          <LabChoice label="Watch at" options={WATCH_SPEEDS} value={slow} onChange={setSlow} hint="Slow it down to see a short move, like a button press, that’s over in a few frames." />
        </LabControls>
      </div>
      <LabNote>
        <b>The takeaway:</b> an arrival that slows down reads as “it’s here”; linear reads as a machine. Springs feel physical and playful, and a bouncy one keeps moving after it lands, so give it room before the next thing happens.
      </LabNote>
    </>
  );
}
