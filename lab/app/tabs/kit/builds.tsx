// builds.tsx: the Kit pieces tab's entries for lib/studio/kit/kit.tsx's builds: WordReveal, Odometer and DrawPath, each
// with a stage that plays it on the showcase ground and the controls for its props.
import type { ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { DISPLAY_FONT, MONO_FONT } from '#models/type/faces.ts';
import { FULL_FRAME } from '#models/frame/frame.ts';
import { DrawPath, Odometer, WordReveal, wordRevealFinish, type OdometerMode } from '#studio/kit/kit.tsx';
import { lerp, motionCurves, seg } from '#models/motion/motion.ts';
import { LAB_COLORS, LabButtons, LabChoice, LabSlider } from '../../ui.tsx';
import { defineKitPiece, KIT_COLOR_OPTIONS, KitTextField } from './piece.tsx';

const LEAD = 0.5; // seconds of empty stage before the piece starts, so its first frame is seen
const HOLD = 1.6; // seconds the finished piece holds before the loop restarts

function KitHud({ left, right }: { left: string; right?: string }) {
  return (
    <div style={{ position: 'absolute', left: 120, right: 120, top: 56, display: 'flex', justifyContent: 'space-between', fontFamily: MONO_FONT, fontSize: 22, letterSpacing: '0.08em', color: LAB_COLORS.dim, textTransform: 'uppercase' }}>
      <span>{left}</span>
      {right && <span>{right}</span>}
    </div>
  );
}

const useKitSeconds = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps - LEAD;
};

// ---------- WordReveal ----------

// The max slider's far end means "no cap", so one control covers both.
const WORD_MAX_TOP = 2;

type WordRevealStageProps = {
  text: string; size: number; weight: number; letters: boolean; each: number; maxSlider: number; duration: number; rise: number;
  align: 'left' | 'center' | 'right';
};

const wordTiming = (p: WordRevealStageProps) => ({ each: p.each, duration: p.duration, max: p.maxSlider >= WORD_MAX_TOP ? undefined : p.maxSlider });

function WordRevealStage(p: WordRevealStageProps) {
  const t = useKitSeconds();
  const timing = wordTiming(p);
  const finish = wordRevealFinish(p.text, { letters: p.letters, timing });
  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground }}>
      <KitHud left={`Words one by one · ${p.letters ? 'letter by letter' : 'word by word'}`} right={`all in by ${finish.toFixed(2)}s · now ${Math.max(0, t).toFixed(2)}s in`} />
      <WordReveal t={t} text={p.text} x={160} y={380} width={1600} size={p.size} weight={p.weight} color={LAB_COLORS.cream}
        align={p.align} rise={p.rise} letters={p.letters} timing={timing} />
    </AbsoluteFill>
  );
}

export const WORD_REVEAL_PIECE = defineKitPiece<WordRevealStageProps>({
  id: 'word-reveal',
  name: 'WordReveal',
  title: 'Words one by one',
  blurb: 'Words that come in one after another.',
  source: 'lib/studio/kit/kit.tsx',
  whenUsed: 'A headline or a key line of the voice-over, so the words arrive as they’re read rather than all at once.',
  note: <>It uses the system font on purpose: it’s a walkthrough piece, and there the words should look like the product’s own screens. Letter by letter is for one short word; on a sentence it takes too long.</>,
  defaults: { text: 'Every order ships the same day', size: 110, weight: 800, letters: false, each: 0.08, maxSlider: WORD_MAX_TOP, duration: 0.45, rise: 24, align: 'left' },
  seconds: (p) => LEAD + wordRevealFinish(p.text, { letters: p.letters, timing: wordTiming(p) }) + HOLD,
  Stage: WordRevealStage,
  Controls: ({ props: p, set }) => (
    <>
      <KitTextField label="Words" value={p.text} onChange={(text) => set({ text })} />
      <LabChoice label="Comes in" options={[{ value: 'words', label: 'Word by word' }, { value: 'letters', label: 'Letter by letter' }]}
        value={p.letters ? 'letters' : 'words'} onChange={(v) => set({ letters: v === 'letters' })} />
      <LabSlider label="Gap between each" value={p.each} min={0.02} max={0.25} step={0.01} format={(v) => `${Math.round(v * 1000)} ms`} onChange={(each) => set({ each })}
        hint="40–80 ms reads as one gesture. Much longer and it reads as a list being typed." />
      <LabSlider label="Whole ripple capped at" value={p.maxSlider} min={0.2} max={WORD_MAX_TOP} step={0.05} format={(v) => (v >= WORD_MAX_TOP ? 'no cap' : `${v.toFixed(2)}s`)}
        onChange={(maxSlider) => set({ maxSlider })} hint="Squeezes the gaps so a long line still finishes in time." />
      <LabSlider label="Each word’s fade-in" value={p.duration} min={0.1} max={1.2} step={0.05} format={(v) => `${v.toFixed(2)}s`} onChange={(duration) => set({ duration })} />
      <LabSlider label="Rise" value={p.rise} min={0} max={80} step={2} format={(v) => `${v}px`} onChange={(rise) => set({ rise })} hint="How far each word floats up as it appears." />
      <LabSlider label="Size" value={p.size} min={40} max={180} step={2} format={(v) => `${v}px`} onChange={(size) => set({ size })} />
      <LabSlider label="Weight" value={p.weight} min={300} max={900} step={100} onChange={(weight) => set({ weight })} />
      <LabChoice label="Align" options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]}
        value={p.align} onChange={(align) => set({ align })} />
    </>
  ),
});

// ---------- Odometer ----------

type OdometerFormat = 'plain' | 'dollars' | 'percent';
type OdometerCurve = 'calm' | 'fast';

type OdometerStageProps = {
  from: number; to: number; decimals: number; format: OdometerFormat; mode: OdometerMode; spin: number;
  duration: number; curve: OdometerCurve; punch: number; blur: number; fade: number;
};

// No bouncy curve on offer: the Odometer's value is data, and a price that overshoots says a wrong number.
const ODOMETER_CURVES = { calm: motionCurves.cubic.entrance, fast: motionCurves.expo.entrance } as const;

const ODOMETER_CAPTIONS: Record<OdometerFormat, string> = { plain: 'ORDERS TODAY', dollars: 'REVENUE THIS MONTH', percent: 'SCORE' };

const odometerAffixes = (format: OdometerFormat) => ({ plain: {}, dollars: { prefix: '$' }, percent: { suffix: '%' } })[format];

const odometerValue = (p: OdometerStageProps) => (t: number) => lerp(p.from, p.to, seg(t, 0, p.duration, ODOMETER_CURVES[p.curve]));

function OdometerStage(p: OdometerStageProps) {
  const t = useKitSeconds();
  const value = odometerValue(p);
  const { prefix = '', suffix = '' } = odometerAffixes(p.format);
  const shown = `${prefix}${p.to.toLocaleString('en-US', { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals })}${suffix}`;
  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground }}>
      <KitHud left={`Rolling number · ${ODOMETER_MODE_WORDS[p.mode]}`} right={t >= p.duration ? `landed on ${shown}` : `rolling · ${Math.round(Math.max(0, t / p.duration) * 100)}% of the time`} />
      <div style={{ position: 'absolute', left: 160, right: 160, top: 330, textAlign: 'center', fontFamily: MONO_FONT, fontSize: 30, letterSpacing: '0.1em', color: LAB_COLORS.red }}>{ODOMETER_CAPTIONS[p.format]}</div>
      <Odometer t={t} value={value} x={960} y={640} size={250} align="center" color={LAB_COLORS.cream} decimals={p.decimals} prefix={prefix} suffix={suffix}
        mode={p.mode} spin={p.spin} punch={p.punch} blur={p.blur} fade={p.fade} />
    </AbsoluteFill>
  );
}

const ODOMETER_MODE_WORDS: Record<OdometerMode, string> = { mechanical: 'geared', direct: 'straight there', slot: 'slot machine' };

const ODOMETER_PRESETS: readonly { label: string; props: Partial<OdometerStageProps> }[] = [
  { label: 'A total in a walkthrough', props: { from: 0, to: 1299, decimals: 0, format: 'dollars', mode: 'direct', duration: 1.8, curve: 'calm', punch: 0 } },
  { label: 'A price in a reel', props: { from: 0, to: 48250, decimals: 0, format: 'dollars', mode: 'mechanical', duration: 0.75, curve: 'fast', punch: 0.06 } },
  { label: 'A score, just for fun', props: { from: 0, to: 98, decimals: 0, format: 'percent', mode: 'slot', spin: 2, duration: 1.6, curve: 'calm', punch: 0 } },
];

export const ODOMETER_PIECE = defineKitPiece<OdometerStageProps>({
  id: 'odometer',
  name: 'Odometer',
  title: 'Rolling number',
  blurb: 'A number whose digits roll on wheels, like a car’s mileage counter, and land sharp on the final value.',
  source: 'lib/studio/kit/kit.tsx',
  whenUsed: 'A result worth dwelling on: a price, a total, a percentage saved. The roll makes the viewer watch the number arrive.',
  note: <>A digit blurs while its wheel turns and is pin-sharp once it stops, so a fast roll reads as motion, not as a flicker of numbers. Every digit sits in a box of the same width, so the number never wobbles sideways. How fast the value moves is up to the curve: the <b>calm</b> one eases in, the <b>fast</b> one arrives almost at once and creeps the last bit.</>,
  defaults: { from: 0, to: 1299, decimals: 0, format: 'dollars', mode: 'direct', spin: 2, duration: 1.8, curve: 'calm', punch: 0, blur: 1, fade: 0.28 },
  seconds: (p) => LEAD + p.duration + 0.5 + HOLD,
  Stage: OdometerStage,
  Controls: ({ props: p, set }) => (
    <>
      <LabButtons label="Start from" buttons={ODOMETER_PRESETS.map((preset) => ({ label: preset.label, onClick: () => set(preset.props) }))} />
      <LabChoice label="How the wheels turn" options={[{ value: 'mechanical', label: 'Geared' }, { value: 'direct', label: 'Straight there' }, { value: 'slot', label: 'Slot machine' }] as const}
        value={p.mode} onChange={(mode) => set({ mode })}
        hint={{
          mechanical: <>Each wheel turns only as the one to its right rolls past 9, like a real counter: the last digits blur by, the first ones click over. A big jump is all blur, which suits a quick reel. <code>mechanical</code></>,
          direct: <>Every wheel rolls straight to its new digit, all together. The calm, readable roll for a walkthrough. <code>direct</code></>,
          slot: <>Every wheel spins a few extra turns, then they lock one by one from the left. <code>slot</code></>,
        }[p.mode]} />
      {p.mode === 'slot' && <LabSlider label="Extra turns" value={p.spin} min={0} max={5} step={1} onChange={(spin) => set({ spin })} />}
      <LabSlider label="From" value={p.from} min={0} max={10000} step={1} format={(v) => v.toLocaleString('en-US')} onChange={(from) => set({ from })} />
      <LabSlider label="To" value={p.to} min={0} max={100000} step={1} format={(v) => v.toLocaleString('en-US')} onChange={(to) => set({ to })} />
      <LabChoice label="Shown as" options={[{ value: 'plain', label: '1,299' }, { value: 'dollars', label: '$' }, { value: 'percent', label: '%' }] as const} value={p.format} onChange={(format) => set({ format })} />
      <LabChoice label="Decimal places" options={[{ value: 0, label: '0' }, { value: 2, label: '2' }]} value={p.decimals} onChange={(decimals) => set({ decimals })} />
      <LabSlider label="Rolls for" value={p.duration} min={0.3} max={3} step={0.05} format={(v) => `${v.toFixed(2)}s`} onChange={(duration) => set({ duration })}
        hint="1.2–2.5 s in a walkthrough, so it can be read; 0.6–0.8 s in a fast reel." />
      <LabChoice label="Speed along the way" options={[{ value: 'calm', label: 'Calm' }, { value: 'fast', label: 'Fast arrival' }] as const} value={p.curve} onChange={(curve) => set({ curve })}
        hint={<>Nothing bouncy: a number that overshoots says the wrong number. <code>{p.curve === 'calm' ? 'motionCurves.cubic.entrance' : 'motionCurves.expo.entrance'}</code></>} />
      <LabSlider label="Pop as it lands" value={p.punch} min={0} max={0.15} step={0.01} format={(v) => (v ? `${Math.round(v * 100)}% bigger` : 'off')} onChange={(punch) => set({ punch })}
        hint={<>A quick swell when the number lands, for a reel's beat. 6% is plenty. <code>punch</code></>} />
      <LabSlider label="Motion blur" value={p.blur} min={0} max={1} step={0.05} format={(v) => (v ? `${Math.round(v * 100)}%` : 'off')} onChange={(blur) => set({ blur })}
        hint={<>Turn it off to see the digits step frame by frame instead of blurring. <code>blur</code></>} />
      <LabSlider label="Soft edges" value={p.fade} min={0} max={0.28} step={0.01} format={(v) => (v ? v.toFixed(2) : 'hard')} onChange={(fade) => set({ fade })}
        hint={<>How gently digits fade in and out at the top and bottom of their window. <code>fade</code></>} />
    </>
  ),
});

// ---------- DrawPath ----------

type DrawPathPreset = 'check' | 'underline' | 'circle' | 'arrow';

type DrawPathStageProps = { preset: DrawPathPreset; width: number; color: string; duration: number };

const DISPLAY_TEXT = { fontFamily: DISPLAY_FONT, fontWeight: 900, textTransform: 'uppercase', color: LAB_COLORS.cream, lineHeight: 1 } as const;

// Each preset is the thing a stroke points at, and the stroke, in frame pixels unless it gives its own viewBox.
const DRAW_PATH_PRESETS: Record<DrawPathPreset, { label: string; d: string; viewBox?: string; box?: { x: number; y: number; w: number; h: number }; behind: () => ReactNode }> = {
  check: {
    label: 'A checkmark',
    d: 'M24 53 L43 71 L78 31',
    viewBox: '0 0 100 100',
    box: { x: 610, y: 190, w: 700, h: 700 },
    behind: () => <div style={{ position: 'absolute', left: 660, top: 240, width: 600, height: 600, borderRadius: '50%', border: `4px solid ${LAB_COLORS.line}` }} />,
  },
  underline: {
    label: 'An underline swash',
    d: 'M520 700 C 760 640, 1120 628, 1420 672 C 1300 668, 1120 676, 980 712',
    behind: () => <div style={{ ...DISPLAY_TEXT, position: 'absolute', left: 0, right: 0, top: 400, textAlign: 'center', fontSize: 260, fontStretch: '90%' }}>Faster</div>,
  },
  circle: {
    label: 'A circle around something',
    d: 'M800 385 C 1020 330, 1290 400, 1275 545 C 1260 690, 900 730, 700 650 C 560 590, 610 420, 880 372',
    behind: () => (
      <>
        <div style={{ ...DISPLAY_TEXT, position: 'absolute', left: 0, right: 0, top: 430, textAlign: 'center', fontSize: 220, fontStretch: '80%' }}>$49</div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 800, textAlign: 'center', fontFamily: MONO_FONT, fontSize: 28, letterSpacing: '0.1em', color: LAB_COLORS.dim }}>WAS $79 · PER MONTH</div>
      </>
    ),
  },
  arrow: {
    label: 'An arrow',
    d: 'M430 780 C 600 520, 900 430, 1210 500 M1210 500 L1140 452 M1210 500 L1152 562',
    behind: () => (
      <>
        <div style={{ position: 'absolute', left: 300, top: 810, fontFamily: MONO_FONT, fontSize: 28, letterSpacing: '0.1em', color: LAB_COLORS.dim }}>START HERE</div>
        <div style={{ position: 'absolute', left: 1250, top: 420, width: 420, height: 160, borderRadius: 24, background: LAB_COLORS.cream, color: LAB_COLORS.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 56 }}>Checkout</div>
      </>
    ),
  },
};

function DrawPathStage(p: DrawPathStageProps) {
  const t = useKitSeconds();
  const preset = DRAW_PATH_PRESETS[p.preset];
  const k = Math.max(0, t / p.duration);
  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground }}>
      <KitHud left={`Pen stroke · ${preset.label}`} right={k >= 1 ? 'drawn' : `drawing · ${Math.round(Math.min(1, k) * 100)}% of the time`} />
      {preset.behind()}
      <DrawPath d={preset.d} k={k} color={p.color} width={p.width} box={preset.box ?? FULL_FRAME} viewBox={preset.viewBox} />
    </AbsoluteFill>
  );
}

export const DRAW_PATH_PIECE = defineKitPiece<DrawPathStageProps>({
  id: 'draw-path',
  name: 'DrawPath',
  title: 'Pen stroke',
  blurb: 'A line that draws itself on, as if by a pen.',
  source: 'lib/studio/kit/kit.tsx',
  whenUsed: 'Pointing at something: ticking off a step, underlining the word that matters, circling a price, an arrow to where to click.',
  note: <>The pen starts fast and slows as it finishes, like a real hand. Thickness is in screen pixels, so the checkmark (drawn in its own little 100×100 box, like an icon) is as thick as the rest.</>,
  defaults: { preset: 'underline', width: 14, color: LAB_COLORS.red, duration: 0.8 },
  seconds: (p) => LEAD + p.duration + HOLD,
  Stage: DrawPathStage,
  Controls: ({ props: p, set }) => (
    <>
      <LabChoice label="What it draws" options={(Object.keys(DRAW_PATH_PRESETS) as DrawPathPreset[]).map((value) => ({ value, label: DRAW_PATH_PRESETS[value].label }))}
        value={p.preset} onChange={(preset) => set({ preset })} />
      <LabSlider label="Thickness" value={p.width} min={2} max={40} step={1} format={(v) => `${v}px`} onChange={(width) => set({ width })} />
      <LabChoice label="Colour" options={KIT_COLOR_OPTIONS} value={p.color as (typeof KIT_COLOR_OPTIONS)[number]['value']} onChange={(color) => set({ color })} />
      <LabSlider label="Draws in" value={p.duration} min={0.2} max={2.5} step={0.05} format={(v) => `${v.toFixed(2)}s`} onChange={(duration) => set({ duration })} />
    </>
  ),
});
