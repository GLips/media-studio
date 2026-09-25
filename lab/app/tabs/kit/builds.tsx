// builds.tsx: the Kit pieces tab's entries for lib/studio/kit.tsx's builds: WordReveal, CountUp and DrawPath, each
// with a stage that plays it on the showcase ground and the controls for its props.
import type { ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { DISPLAY_FONT, MONO_FONT } from '../../../../lib/studio/fonts.ts';
import { FULL_FRAME } from '../../../../lib/studio/frame.ts';
import { CountUp, DrawPath, WordReveal, wordRevealFinish } from '../../../../lib/studio/kit.tsx';
import { LAB_COLORS, LabChoice, LabSlider } from '../../ui.tsx';
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
  source: 'lib/studio/kit.tsx',
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

// ---------- CountUp ----------

type CountUpFormat = 'plain' | 'dollars' | 'euros' | 'percent';

type CountUpStageProps = { from: number; to: number; decimals: number; format: CountUpFormat; duration: number };

const countUpFormatter = (format: CountUpFormat, decimals: number) => {
  const grouped = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return {
    plain: undefined,
    dollars: (v: number) => `$${grouped(v)}`,
    euros: (v: number) => `€${grouped(v)}`,
    percent: (v: number) => `${grouped(v)}%`,
  }[format];
};

function CountUpStage(p: CountUpStageProps) {
  const t = useKitSeconds();
  const k = Math.max(0, t / p.duration);
  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground }}>
      <KitHud left="Counting number" right={k >= 1 ? 'landed exactly on its value' : `counting · ${Math.round(Math.min(1, k) * 100)}% of the time`} />
      <div style={{ position: 'absolute', left: 160, right: 160, top: 330, textAlign: 'center', fontFamily: MONO_FONT, fontSize: 30, letterSpacing: '0.1em', color: LAB_COLORS.red }}>REVENUE THIS MONTH</div>
      <CountUp k={k} from={p.from} to={p.to} decimals={p.decimals} format={countUpFormatter(p.format, p.decimals)}
        x={160} y={420} width={1600} size={220} align="center" color={LAB_COLORS.cream} />
    </AbsoluteFill>
  );
}

export const COUNT_UP_PIECE = defineKitPiece<CountUpStageProps>({
  id: 'count-up',
  name: 'CountUp',
  title: 'Counting number',
  blurb: 'A number that counts up and slows into its final value.',
  source: 'lib/studio/kit.tsx',
  whenUsed: 'A result worth dwelling on: a price, a total, a percentage saved. Counting makes the viewer watch the number arrive.',
  note: <>Every digit is the same width, so the number never wobbles sideways as it counts. It slows down at the end so the eye can read the final value, and lands on it exactly. Like “Words one by one” it uses the system font, by design.</>,
  defaults: { from: 0, to: 48250, decimals: 0, format: 'dollars', duration: 1.2 },
  seconds: (p) => LEAD + p.duration + HOLD,
  Stage: CountUpStage,
  Controls: ({ props: p, set }) => (
    <>
      <LabSlider label="From" value={p.from} min={0} max={10000} step={50} onChange={(from) => set({ from })} />
      <LabSlider label="To" value={p.to} min={0} max={100000} step={50} onChange={(to) => set({ to })} />
      <LabChoice label="Decimal places" options={[{ value: 0, label: '0' }, { value: 1, label: '1' }, { value: 2, label: '2' }]} value={p.decimals} onChange={(decimals) => set({ decimals })} />
      <LabChoice label="Shown as" options={[{ value: 'plain', label: '48,250' }, { value: 'dollars', label: '$' }, { value: 'euros', label: '€' }, { value: 'percent', label: '%' }]}
        value={p.format} onChange={(format) => set({ format })} />
      <LabSlider label="Counts for" value={p.duration} min={0.3} max={3} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(duration) => set({ duration })}
        hint="0.8–1.5 s feels right. Shorter is a blur; longer and the viewer waits on it." />
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
  source: 'lib/studio/kit.tsx',
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
