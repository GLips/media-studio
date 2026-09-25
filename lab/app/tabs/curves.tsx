// curves.tsx: the lab's Curves & springs tab. One card makes the same journey three times, stacked: at constant
// speed, on a named studio curve from lib/studio/motion.ts, and on a deadline spring (springBy). The journey follows
// the role picked: in from off the frame, between two spots, or off the frame. Under each lane a speed graph, with a
// dot riding the current moment, shows where the move is fast and where it eases.
import { useMemo, useState } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { DISPLAY_FONT, MONO_FONT } from '../../../lib/studio/fonts.ts';
import { motionCurves, motionDurations, springBy, type DeadlineSpring, type EaseFn } from '../../../lib/studio/motion.ts';
import { LAB_COLORS, LabBench, LabButtons, LabChoice, LabControls, LabNote, LabSlider, LabStage, LabTabIntro } from '../ui.tsx';
import './curves.css';

type CurveSystem = 'productive' | 'expressive' | 'cubic' | 'expo' | 'dissolve';
type CurveRole = 'standard' | 'entrance' | 'exit';
type CurvesDurationKey = 'press' | 'dissolve' | 'exit' | 'enterSmall' | 'enterLarge' | 'travelLong' | 'cameraPush';

// `plain` leads in the lab; `value` is the name agents and lib/studio/motion.ts use, shown beside it.
const CURVE_SYSTEMS: readonly { value: CurveSystem; plain: string; gloss: string; why: string }[] = [
  { value: 'productive', plain: 'Brisk', gloss: 'calm app walkthroughs', why: 'Brisk and plain. For walkthroughs of an app, where motion should do its job and get out of the way.' },
  { value: 'expressive', plain: 'Soft', gloss: 'a walkthrough’s big reveals', why: 'A longer, softer landing. For a walkthrough’s reveals and moments that matter.' },
  { value: 'cubic', plain: 'House default', gloss: 'captions, cards, the camera', why: 'What the studio’s captions, text, cards and camera already move on. Stronger at both ends than Brisk.' },
  { value: 'expo', plain: 'Snap', gloss: 'teasers and reels cut to music', why: 'Half the distance in the first tenth of the time, then a long glide in. Lands hard on a music beat. Too punchy for a calm walkthrough.' },
  { value: 'dissolve', plain: 'Even', gloss: 'fades, not moves', why: 'Even and symmetric, made for fading things in and out: a fade shouldn’t visibly speed up. It is one curve, whatever the move is doing.' },
];

const CURVE_ROLES: readonly { value: CurveRole; label: string; why: string }[] = [
  { value: 'entrance', label: 'Arriving', why: 'Slides in from off the frame. Starts fast and slows to a stop, like something set down on a table: slowing at the end reads as “it’s here”.' },
  { value: 'standard', label: 'Moving within the frame', why: 'Goes from one spot on screen to another. Eases out of rest and into rest, like anything with weight.' },
  { value: 'exit', label: 'Leaving', why: 'Slides off the frame. Starts slowly and speeds away: the eye has already moved on, so it needn’t see it stop. Watch a bouncy spring swing back into view.' },
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

// Narrower than the studio's 1920 frame, so the lanes' type stays legible in the bench's stage column, and packed
// tight so the stage fits one screen beside the controls.
const STAGE_W = 1600;
const STAGE_H = 1000;
const LEAD = 0.5; // seconds the card waits before every lane starts, so the start is seen from rest
const HOLD = 1.0; // seconds after the last lane settles, so the landing is visible before the loop restarts
const TRACK_X0 = 80;
const TRACK_X1 = 1520;
const CARD_W = 330;
const CARD_H = 96;
// Home sits left of centre so the bounciest spring (about 45% overshoot) arriving from off the frame stays on it.
const HOME_X = 760;
const LANE_TOP = [84, 382, 680];
const CARD_Y = 50;
const GRAPH_Y = 176;
const GRAPH_H = 80;
const GRAPH_SAMPLES = 360;
const SPRING_STROKE = '#8f91ff'; // cobalt lifted so a thin line reads on the near-black ground

// Where the card starts and ends for each role. Off the frame means just past its edge, so "gone" is exactly k = 1.
const CURVES_PATHS: Record<CurveRole, { from: number; to: number }> = {
  entrance: { from: -CARD_W, to: HOME_X },
  standard: { from: TRACK_X0, to: HOME_X },
  exit: { from: HOME_X, to: STAGE_W },
};

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

const CURVES_WORDS: Record<CurveRole, { moving: string; done: string; start: string; end: string; tagline: string }> = {
  entrance: { moving: 'Arriving', done: 'Arrived', start: 'starts', end: 'arrives', tagline: 'THREE WAYS TO ARRIVE' },
  standard: { moving: 'Moving', done: 'Arrived', start: 'starts', end: 'arrives', tagline: 'THREE WAYS TO GET THERE' },
  exit: { moving: 'Leaving', done: 'Gone', start: 'leaves', end: 'gone', tagline: 'THREE WAYS TO LEAVE' },
};

function CurvesStage({ system, role, curveSeconds, springSeconds, bounce, slow }: CurvesStageProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps / slow - LEAD;
  const path = CURVES_PATHS[role];
  const words = CURVES_WORDS[role];

  const { lanes, graphs, tEnd, scales } = useMemo(() => {
    const ease = curveFor(system, role);
    const spring = springBy(springSeconds, bounce);
    const end = curvesMoveEnd(curveSeconds, spring) + HOLD;
    const tween = (fn: EaseFn) => (s: number) => fn(s / curveSeconds);
    const tweenStatus = (s: number) => (s < 0 ? 'Waiting' : s < curveSeconds ? words.moving : words.done);
    const picked = CURVE_SYSTEMS.find((c) => c.value === system)!;
    const roleWord = system === 'dissolve' ? '' : ` · ${words.moving.toLowerCase()}`;
    // Leaving on a spring: past the edge it overshoots further off, then may swing back into view before settling.
    const springStatus = role === 'exit'
      ? (s: number) => (s < 0 ? 'Waiting' : spring(s) >= 1 ? 'Gone' : s < spring.landed ? 'Leaving' : 'Swung back into view')
      : (s: number) => (s < 0 ? 'Waiting' : s < spring.landed ? words.moving : s < spring.settled ? 'Landed · still wobbling' : 'Settled');
    const built: CurvesLane[] = [
      {
        name: 'Linear', sub: `Constant speed · ${curveSeconds}s`, color: LAB_COLORS.dim, stroke: LAB_COLORS.cream,
        at: tween(motionCurves.linear), status: tweenStatus, marks: [{ t: curveSeconds, label: words.end }],
      },
      {
        name: 'Studio curve', sub: `${picked.plain} (${picked.value})${roleWord} · ${curveSeconds}s`, color: LAB_COLORS.red, stroke: LAB_COLORS.red,
        at: tween(ease), status: tweenStatus, marks: [{ t: curveSeconds, label: words.end }],
      },
      {
        name: 'Spring',
        sub: role === 'exit'
          ? `Bounce ${bounce.toFixed(2)} · gone at ${spring.landed.toFixed(2)}s`
          : `Bounce ${bounce.toFixed(2)} · lands ${spring.landed.toFixed(2)}s · still ${spring.settled.toFixed(2)}s`,
        color: LAB_COLORS.cobalt, stroke: SPRING_STROKE, at: spring, status: springStatus,
        marks: role === 'exit'
          ? [{ t: spring.landed, label: 'gone' }]
          : [{ t: spring.landed, label: 'lands' }, { t: spring.settled, label: 'still' }],
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
  }, [system, role, curveSeconds, springSeconds, bounce, words]);

  const graphW = TRACK_X1 - TRACK_X0;
  const timeX = (s: number) => ((s + LEAD) / (tEnd + LEAD)) * graphW;
  const cardX = (k: number) => path.from + k * (path.to - path.from);
  const pastFrames = Array.from({ length: frame + 1 }, (_, f) => f / fps / slow - LEAD);
  const inFrame = (x: number) => x >= 0 && x + CARD_W <= STAGE_W;

  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground, color: LAB_COLORS.cream, fontFamily: DISPLAY_FONT }}>
      <div style={{ position: 'absolute', left: TRACK_X0, right: STAGE_W - TRACK_X1, top: 28, display: 'flex', justifyContent: 'space-between', fontFamily: MONO_FONT, fontSize: 26, letterSpacing: '0.08em', color: LAB_COLORS.dim }}>
        <span>SAME CARD · {words.tagline}</span>
        <span>{slow > 1 ? `${slow}× SLOWER · ` : ''}T = {Math.max(0, t).toFixed(2)}S</span>
      </div>
      {lanes.map((lane, i) => {
        const k = lane.at(t);
        const speeds = graphs[i];
        const { top: speedTop, bottom: speedBottom } = scales[i];
        const speedY = (v: number) => (GRAPH_H * (speedTop - v)) / (speedTop - speedBottom);
        const graph = speeds.map((v, j) => `${j ? 'L' : 'M'}${(graphW * j) / GRAPH_SAMPLES},${speedY(v).toFixed(1)}`).join(' ');
        const zeroY = speedY(0);
        const nowV = speeds[Math.round(((t + LEAD) / (tEnd + LEAD)) * GRAPH_SAMPLES)] ?? 0;
        return (
          <div key={i} style={{ position: 'absolute', left: 0, top: LANE_TOP[i], width: STAGE_W, height: 290 }}>
            <div style={{ position: 'absolute', left: TRACK_X0, right: STAGE_W - TRACK_X1, top: 0, display: 'flex', alignItems: 'baseline', gap: 20 }}>
              <span style={{ fontSize: 40, fontWeight: 900, fontStretch: '80%', textTransform: 'uppercase', color: lane.stroke }}>{lane.name}</span>
              <span style={{ fontFamily: MONO_FONT, fontSize: 22, letterSpacing: '0.04em', color: LAB_COLORS.dim, textTransform: 'uppercase' }}>{lane.sub}</span>
              <span style={{ marginLeft: 'auto', fontFamily: MONO_FONT, fontSize: 22, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: 999, border: `2px solid ${lane.stroke}`, color: lane.stroke }}>{lane.status(t)}</span>
            </div>
            {/* The start and end spots that are on screen, drawn under the card so an overshoot past home is plain. */}
            {inFrame(path.from) && <div style={{ position: 'absolute', left: path.from, top: CARD_Y, width: CARD_W, height: CARD_H, borderRadius: 16, border: `2px dashed ${LAB_COLORS.line}` }} />}
            {inFrame(path.to) && <div style={{ position: 'absolute', left: path.to, top: CARD_Y, width: CARD_W, height: CARD_H, borderRadius: 16, border: `2px dashed ${lane.stroke}`, opacity: 0.5 }} />}
            {/* One tick per video frame at where the card was: bunched ticks are slow stretches, spread ticks fast. */}
            <svg style={{ position: 'absolute', left: 0, top: CARD_Y + CARD_H + 6 }} width={STAGE_W} height={18}>
              {pastFrames.map((s, f) => {
                const x = cardX(lane.at(s)) + CARD_W / 2;
                return <line key={f} x1={x} x2={x} y1={0} y2={14} stroke={lane.stroke} strokeWidth={2} opacity={0.55} />;
              })}
            </svg>
            <CurvesCard x={cardX(k)} y={CARD_Y} color={lane.color} />
            <svg style={{ position: 'absolute', left: TRACK_X0, top: GRAPH_Y, overflow: 'visible' }} width={graphW} height={GRAPH_H}>
              <rect x={0} y={0} width={graphW} height={GRAPH_H} fill={LAB_COLORS.panel} rx={6} />
              <line x1={0} x2={graphW} y1={zeroY} y2={zeroY} stroke={LAB_COLORS.line} strokeWidth={2} />
              <path d={`${graph} L${graphW},${zeroY} L0,${zeroY} Z`} fill={lane.stroke} opacity={0.18} />
              <path d={graph} fill="none" stroke={lane.stroke} strokeWidth={3} strokeLinejoin="round" />
              {[{ t: 0, label: words.start }, ...lane.marks].filter((m) => m.t <= tEnd).map((m, j) => (
                <g key={m.label}>
                  <line x1={timeX(m.t)} x2={timeX(m.t)} y1={0} y2={GRAPH_H} stroke={LAB_COLORS.dim} strokeWidth={1.5} strokeDasharray="4 5" />
                  <text x={timeX(m.t) + 6} y={j % 2 ? GRAPH_H - 8 : 24} fill={LAB_COLORS.dim} fontFamily={MONO_FONT} fontSize={20} letterSpacing="0.04em">{m.label.toUpperCase()}</text>
                </g>
              ))}
              <line x1={timeX(t)} x2={timeX(t)} y1={-4} y2={GRAPH_H + 4} stroke={LAB_COLORS.cream} strokeWidth={2} opacity={0.6} />
              <circle cx={timeX(t)} cy={speedY(nowV)} r={9} fill={LAB_COLORS.cream} stroke={LAB_COLORS.ground} strokeWidth={3} />
            </svg>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: TRACK_X0, right: STAGE_W - TRACK_X1, top: 948, display: 'flex', justifyContent: 'space-between', fontFamily: MONO_FONT, fontSize: 22, letterSpacing: '0.04em', color: LAB_COLORS.dim }}>
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

/** The curve family picker: each option leads with a plain name, then its real name and what it's for. */
function CurvesFamilyPicker({ value, onChange }: { value: CurveSystem; onChange: (v: CurveSystem) => void }) {
  return (
    <div className="choice">
      <span>Studio curve</span>
      <div className="curves-family">
        {CURVE_SYSTEMS.map((c) => (
          <button key={c.value} type="button" className={c.value === value ? 'on' : undefined} onClick={() => onChange(c.value)}>
            <b>{c.plain}</b> <code>{c.value}</code>
            <small>{c.gloss}</small>
          </button>
        ))}
      </div>
      <small>{CURVE_SYSTEMS.find((c) => c.value === value)!.why}</small>
    </div>
  );
}

export function CurvesTab() {
  const [system, setSystem] = useState<CurveSystem>('productive');
  const [role, setRole] = useState<CurveRole>('entrance');
  const [durationKey, setDurationKey] = useState<CurvesDurationKey>('travelLong');
  const [springSeconds, setSpringSeconds] = useState(1);
  const [bounce, setBounce] = useState(0.3);
  const [slow, setSlow] = useState<number>(1);
  // Bumped to remount the Player, which restarts the loop from its first frame.
  const [replays, setReplays] = useState(0);

  const curveSeconds = CURVE_DURATIONS.find((d) => d.value === durationKey)!.seconds;
  const spring = springBy(springSeconds, bounce);
  const loopSeconds = curvesLoopSeconds({ curveSeconds, springSeconds, bounce });
  const roleWhy = CURVE_ROLES.find((r) => r.value === role)!.why;
  const durationToken = { press: 'press', dissolve: 'dissolve', exit: 'exit', enterSmall: 'enter.small', enterLarge: 'enter.large', travelLong: 'travel.long', cameraPush: 'camera.push' }[durationKey];

  return (
    <>
      <LabTabIntro
        number={1}
        title="Curves & springs"
        what={<>How something gets from A to B. Almost nothing in the real world moves at a steady speed: it picks up speed, then slows to a stop. An <b>easing curve</b> is that speed-up and slow-down, written down so every move in a video shares it; the studio has a few named ones. A <b>spring</b> is the physical version: the object is pulled home as if by a rubber band, and can overshoot and wobble before it settles.</>}
        when="Every move in every video: a card sliding in, a caption popping up, the camera pushing in on a detail. Walkthroughs of an app use calm curves; teasers and showreels cut to music use snappier ones and springs."
        bad="Linear motion: the thing starts at full speed and stops dead, like a robot. Or a mix of unrelated curves, so the video feels twitchy, or a bouncy spring on something serious."
        good="Things arrive fast and slow into place, so the eye knows exactly when they’ve landed. One family of curves throughout, and springs saved for things that should feel alive."
      />
      <LabBench
        stage={
          <LabStage
            key={replays}
            component={CurvesStage}
            inputProps={{ system, role, curveSeconds, springSeconds, bounce, slow }}
            seconds={loopSeconds * slow}
            width={STAGE_W}
            height={STAGE_H}
            label="LINEAR vs STUDIO CURVE vs SPRING"
          />
        }
      >
        <LabControls>
          <LabButtons label="Race" buttons={[{ label: 'Replay all three from the start', onClick: () => setReplays((n) => n + 1) }]} />
          <LabChoice label="Watch at" options={WATCH_SPEEDS} value={slow} onChange={setSlow} hint="Slow it down to see a short move, like a button press, that’s over in a few frames." />
          <LabChoice
            label="What the card is doing"
            options={CURVE_ROLES}
            value={role}
            onChange={setRole}
            hint={system === 'dissolve' ? `${roleWhy} Even is one curve for fades, so only the path changes for it.` : roleWhy}
          />
          <CurvesFamilyPicker value={system} onChange={setSystem} />
          <LabChoice
            label="How long the move takes"
            options={CURVE_DURATIONS.map((d) => ({ value: d.value, label: `${d.label} · ${d.seconds}s` }))}
            value={durationKey}
            onChange={setDurationKey}
            hint="The studio’s standard lengths, short because the viewer sees each move once, at full speed. Linear and the studio curve both use this."
          />
          <LabSlider
            label="Spring: arrives after"
            value={springSeconds}
            min={0.2}
            max={1.5}
            step={0.05}
            format={(v) => `${v.toFixed(2)}s`}
            onChange={setSpringSeconds}
            hint="The spring is timed to reach its spot at this moment, so it can land on a word or a beat. It may keep wobbling after."
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
              : `Overshoots and swings back. It gets there at ${spring.landed.toFixed(2)}s but isn’t still until ${spring.settled.toFixed(2)}s.`}
          />
        </LabControls>
      </LabBench>
      <LabNote>
        Each graph under a card is its <b>speed</b>: the bump is where it’s fastest, and flat along the bottom is standing still.
        Linear is a flat-topped box, which is why it looks mechanical. (Linear and the studio curve share a scale; the spring’s graph has its own.) The ticks under each card mark where it was on every frame of video: bunched up where it’s slow, spread out where it’s quick.
      </LabNote>
      <LabNote>
        <b>The takeaway:</b> an arrival that slows down reads as “it’s here”, and a departure that speeds up reads as “gone”; linear reads as a machine. Springs feel physical and playful, and a bouncy one keeps moving after it lands, so give it room before the next thing happens.
      </LabNote>
      <details className="curves-agents">
        <summary>For agents</summary>
        <p>What the current settings are in <code>lib/studio/motion.ts</code>:</p>
        <pre>{[
          `ease:     ${system === 'dissolve' ? 'motionCurves.dissolve' : `motionCurves.${system}.${role}`}`,
          `duration: motionDurations.${durationToken}  // ${curveSeconds}s`,
          `spring:   springBy(${springSeconds}, ${bounce})  // landed ${spring.landed.toFixed(2)}s, settled ${spring.settled.toFixed(2)}s`,
          `seg(t, start, start + ${curveSeconds}, ease)`,
        ].join('\n')}</pre>
      </details>
    </>
  );
}
