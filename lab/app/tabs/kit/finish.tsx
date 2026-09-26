// finish.tsx: the Kit pieces tab's entries for the reel foundations that finish a frame rather than add to it: film
// grain and a vignette (lib/studio/film/grade.tsx), and the shutter blur that smooths fast moves at 30 fps
// (lib/studio/film/motion-blur.tsx).
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { DISPLAY_FONT, MONO_FONT } from '#models/type/faces.ts';
import { FilmGrain, Vignette } from '#studio/film/grade.tsx';
import { motionCurves, seg } from '#models/motion/motion.ts';
import { ShutterBlur } from '#studio/film/motion-blur.tsx';
import { LAB_COLORS, LAB_FORMAT, LabChoice, LabSlider } from '../../ui.tsx';
import { defineKitPiece } from './piece.tsx';

const HUD = { fontFamily: MONO_FONT, fontSize: 22, letterSpacing: '0.08em', textTransform: 'uppercase' } as const;

// ---------- FilmGrain + Vignette ----------

type GradeCompare = 'split' | 'with' | 'without';

type GradeStageProps = { grain: number; grainScale: number; vignette: number; inner: number; compare: GradeCompare };

const GRADE_SECONDS = 5;

/** A showreel title card: heavy Archivo on the showcase red, with a soft gradient where banding would show. */
function GradeSampleShot() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const push = 1 + 0.04 * (frame / fps / GRADE_SECONDS);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 90% at 40% 45%, #f2653d 0%, ${LAB_COLORS.red} 45%, #a82f10 100%)` }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', transform: `scale(${push})` }}>
        <div style={{ ...HUD, fontSize: 30, color: LAB_COLORS.ink, marginBottom: 24 }}>MOTION SHOWCASE · 2026</div>
        <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 900, fontStretch: '72%', fontSize: 300, lineHeight: 0.86, color: LAB_COLORS.cream, textTransform: 'uppercase', letterSpacing: '-0.01em', textAlign: 'center', whiteSpace: 'nowrap' }}>Made<br />to move</div>
      </div>
    </AbsoluteFill>
  );
}

function GradeStage(p: GradeStageProps) {
  const graded = (
    <>
      <GradeSampleShot />
      <FilmGrain amount={p.grain} scale={p.grainScale} />
      <Vignette amount={p.vignette} inner={p.inner} />
    </>
  );
  if (p.compare === 'with') return <AbsoluteFill>{graded}</AbsoluteFill>;
  if (p.compare === 'without') return <AbsoluteFill><GradeSampleShot /></AbsoluteFill>;
  return (
    <AbsoluteFill>
      <GradeSampleShot />
      <AbsoluteFill style={{ clipPath: `inset(0 0 0 ${LAB_FORMAT.width / 2}px)` }}>{graded}</AbsoluteFill>
      <div style={{ position: 'absolute', left: LAB_FORMAT.width / 2 - 2, top: 0, width: 4, height: '100%', background: LAB_COLORS.cream, opacity: 0.8 }} />
      <div style={{ ...HUD, position: 'absolute', left: 60, top: 50, color: LAB_COLORS.cream }}>Without</div>
      <div style={{ ...HUD, position: 'absolute', right: 60, top: 50, color: LAB_COLORS.cream }}>With grain + vignette</div>
    </AbsoluteFill>
  );
}

export const GRADE_PIECE = defineKitPiece<GradeStageProps>({
  id: 'grade',
  name: 'FilmGrain + Vignette',
  title: 'Film grain & dark corners',
  blurb: 'A fine flicker of film grain and darkened corners, laid over the whole frame.',
  source: 'lib/studio/film/grade.tsx',
  whenUsed: 'Teasers and showreels, over every frame: grain makes flat colour look filmed rather than drawn (and hides the stripes a smooth gradient can show), and a vignette holds the eye in the middle.',
  note: <>Grain is fine by nature and this stage is shrunk to fit the page: press the player’s full-screen button to see it at size. Around 0.06–0.1 reads as film; past 0.15 it becomes a look of its own. Grain barely shows on near-black, by design.</>,
  defaults: { grain: 0.1, grainScale: 0.9, vignette: 0.45, inner: 0.5, compare: 'split' },
  seconds: () => GRADE_SECONDS,
  Stage: GradeStage,
  Controls: ({ props: p, set }) => (
    <>
      <LabChoice label="Show" options={[{ value: 'split', label: 'Before | after' }, { value: 'with', label: 'With' }, { value: 'without', label: 'Without' }]}
        value={p.compare} onChange={(compare) => set({ compare })} />
      <LabSlider label="Grain" value={p.grain} min={0} max={0.3} step={0.01} format={(v) => v.toFixed(2)} onChange={(grain) => set({ grain })} hint="How strong the grain is. 0 turns it off." />
      <LabSlider label="Grain fineness" value={p.grainScale} min={0.3} max={1.5} step={0.05} format={(v) => v.toFixed(2)} onChange={(grainScale) => set({ grainScale })}
        hint="Lower is coarser, chunkier grain; higher is finer." />
      <LabSlider label="Vignette" value={p.vignette} min={0} max={0.9} step={0.05} format={(v) => v.toFixed(2)} onChange={(vignette) => set({ vignette })} hint="How dark the corners get." />
      <LabSlider label="Vignette starts at" value={p.inner} min={0.1} max={0.9} step={0.05} format={(v) => `${Math.round(v * 100)}% out`} onChange={(inner) => set({ inner })}
        hint="How far from the centre the darkening begins. Lower creeps further in." />
    </>
  ),
});

// ---------- ShutterBlur ----------

type ShutterStageProps = { shutter: number; samples: number; crossing: number; slow: number };

const SHUTTER_LEAD = 0.3;
const SHUTTER_PAUSE = 0.6;
const LANE_H = 470;
const LANE_TOPS = [50, 560];
const PUCK = 230;
const PUCK_X0 = 120;
const PUCK_X1 = LAB_FORMAT.width - 120 - PUCK;

const shutterLoopSeconds = (crossing: number) => SHUTTER_LEAD + 2 * (crossing + SHUTTER_PAUSE);

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

function ShutterStage(p: ShutterStageProps) {
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
        <div key={i} style={{ position: 'absolute', left: 0, top: LANE_TOPS[i], width: LAB_FORMAT.width, height: LANE_H, overflow: 'hidden' }}>
          {lane.blurred
            ? <ShutterBlur t={t} shutter={p.shutter} samples={p.samples} render={(at) => <ShutterLane t={at} crossing={p.crossing} />} />
            : <ShutterLane t={t} crossing={p.crossing} />}
          <div style={{ ...HUD, position: 'absolute', left: 40, top: 28, color: lane.blurred ? LAB_COLORS.red : LAB_COLORS.dim }}>{lane.label}</div>
          {/* A tick where the card was on each frame so far: wide gaps are the jumps the eye sees as strobing. */}
          <svg style={{ position: 'absolute', left: 0, bottom: 20 }} width={LAB_FORMAT.width} height={24}>
            {framesSoFar.map((x, f) => <line key={f} x1={x} x2={x} y1={0} y2={20} stroke={lane.blurred ? LAB_COLORS.red : LAB_COLORS.cream} strokeWidth={3} opacity={0.5} />)}
          </svg>
        </div>
      ))}
      <div style={{ ...HUD, position: 'absolute', left: 40, right: 40, top: 1040, fontSize: 18, color: LAB_COLORS.dim, textAlign: 'right' }}>
        {p.slow > 1 ? `${p.slow}× slower · each frame held ${p.slow}×` : 'real speed'} · frame {videoFrame}
      </div>
    </AbsoluteFill>
  );
}

export const SHUTTER_BLUR_PIECE = defineKitPiece<ShutterStageProps>({
  id: 'shutter-blur',
  name: 'ShutterBlur',
  title: 'Motion blur',
  blurb: 'Smears fast movement a little, like a real camera, so it glides instead of jumping.',
  source: 'lib/studio/film/motion-blur.tsx',
  whenUsed: 'Anything that whips across the screen in a reel: a card flung in, a fast camera pan, type slamming into place.',
  note: <>
    <b>Why fast motion strobes:</b> a video is 30 still pictures a second. If something crosses the screen in a third of a second, it only appears in about ten of them, a hand-width apart each time, and your eye sees it hop between spots instead of moving.
    A real camera’s shutter stays open for part of each frame, so a fast object is caught as a short smear along its path, and the smears join up into motion.
    The studio fakes that by drawing each frame several times across the “open shutter” and blending them. Slow it to ¼ speed to see the difference frame by frame; the ticks under each lane show where the card was on every frame.
  </>,
  defaults: { shutter: 0.5, samples: 8, crossing: 0.4, slow: 1 },
  seconds: (p) => shutterLoopSeconds(p.crossing) * p.slow,
  Stage: ShutterStage,
  Controls: ({ props: p, set }) => (
    <>
      <LabSlider label="Shutter" value={p.shutter} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 360)}°`} onChange={(shutter) => set({ shutter })}
        hint="How long the shutter stays open in each frame, as film cameras measure it: 180° is half the frame and the classic film look. 0 is no blur; 360° smears the whole way." />
      <LabSlider label="Copies per frame" value={p.samples} min={1} max={16} step={1} onChange={(samples) => set({ samples })}
        hint="How many copies are blended into each frame. Too few and you see separate ghosts; 6–10 is smooth. Each one costs another render." />
      <LabSlider label="Crossing takes" value={p.crossing} min={0.15} max={1.5} step={0.05} format={(v) => `${v.toFixed(2)}s`} onChange={(crossing) => set({ crossing })}
        hint="Faster crossings jump further between frames. At a second or more there’s little to fix." />
      <LabChoice label="Watch at" options={[{ value: 1, label: 'Real speed' }, { value: 2, label: '½ speed' }, { value: 4, label: '¼ speed' }]}
        value={p.slow} onChange={(slow) => set({ slow })} />
    </>
  ),
});
