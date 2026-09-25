// cards.tsx: the Kit pieces tab's entries for lib/studio/kit.tsx's cards that need no capture: GlassCard,
// SectionCard and EndCard. Each is shown over a stand-in scene, since in a video they always sit on top of one.
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT } from '#models/frame/frame.ts';
import { EndCard, GlassCard, SectionCard } from '../../../../lib/studio/kit.tsx';
import { motionCurves, seg } from '#models/motion/motion.ts';
import { LAB_COLORS, LabChoice, LabSlider } from '../../ui.tsx';
import { defineKitPiece, KIT_COLOR_OPTIONS, KitTextField } from './piece.tsx';

const LEAD = 0.5; // seconds before the piece starts, so its first frame is seen
const HOLD = 1.6; // seconds the finished piece holds before the loop restarts

const useKitCardSeconds = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps - LEAD;
};

// These cards draw white type (Text's default), so their backgrounds must be dark.
const DARK_BG_OPTIONS = [
  { value: LAB_COLORS.ink, label: 'Ink' },
  { value: '#1d1f7a', label: 'Deep cobalt' },
  { value: '#b8330f', label: 'Deep red' },
] as const;
type KitDarkBg = (typeof DARK_BG_OPTIONS)[number]['value'];
type KitColor = (typeof KIT_COLOR_OPTIONS)[number]['value'];

/** A stand-in for the product page a card sits over: a heading and a few rows, in the system font. */
function KitStandInPage() {
  return (
    <AbsoluteFill style={{ background: LAB_COLORS.cream, fontFamily: FONT, color: LAB_COLORS.ink }}>
      <div style={{ position: 'absolute', left: 160, top: 150, fontSize: 64, fontWeight: 800 }}>Your orders</div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ position: 'absolute', left: 160, top: 290 + i * 130, width: 1600, height: 100, borderRadius: 18, background: '#fff', display: 'flex', alignItems: 'center', gap: 28, padding: '0 32px', boxShadow: '0 4px 16px rgba(20,11,14,0.08)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: i % 2 ? LAB_COLORS.cobalt : LAB_COLORS.red }} />
          <div style={{ width: 420 - i * 40, height: 22, borderRadius: 11, background: '#d9d4c7' }} />
          <div style={{ marginLeft: 'auto', fontSize: 34, fontWeight: 700 }}>${(49 + i * 23).toFixed(2)}</div>
        </div>
      ))}
    </AbsoluteFill>
  );
}

// ---------- GlassCard ----------

type GlassCardStageProps = { eyebrow: string; line1: string; line2: string; line3: string; accent: string; duration: number };

function GlassCardStage(p: GlassCardStageProps) {
  const t = useKitCardSeconds();
  const points = [p.line1, p.line2, p.line3].filter((line) => line.trim());
  return (
    <AbsoluteFill>
      {/* As in a real video (see ClickToBlur): the page, blurred, under a tinted wash, so white glass reads as a pane. */}
      {/* Scaled up so the blur's soft edge falls outside the frame. */}
      <AbsoluteFill style={{ filter: 'blur(30px)', transform: 'scale(1.08)' }}><KitStandInPage /></AbsoluteFill>
      <AbsoluteFill style={{ background: 'rgba(29, 31, 122, 0.55)' }} />
      <GlassCard k={seg(t, 0, p.duration, motionCurves.cubic.entrance)} eyebrow={p.eyebrow} points={points} accent={p.accent} ink={LAB_COLORS.ink} />
    </AbsoluteFill>
  );
}

export const GLASS_CARD_PIECE = defineKitPiece<GlassCardStageProps>({
  id: 'glass-card',
  name: 'GlassCard',
  title: 'Frosted summary card',
  blurb: 'A frosted card whose few big lines come in one by one.',
  source: 'lib/studio/kit.tsx',
  whenUsed: 'The closing summary of a walkthrough: “In short”, then two or three lines, over the blurred product.',
  note: <>The glass needs something blurred and tinted behind it, which in a video is the page the viewer just watched. Keep it to three short lines: it holds while the voice reads them.</>,
  defaults: { eyebrow: 'IN SHORT', line1: 'One price per customer', line2: 'Set once, applied everywhere', line3: 'Live for every store today', accent: LAB_COLORS.red, duration: 0.9 },
  seconds: (p) => LEAD + p.duration + 0.6 + HOLD,
  Stage: GlassCardStage,
  Controls: ({ props: p, set }) => (
    <>
      <KitTextField label="Small heading" value={p.eyebrow} onChange={(eyebrow) => set({ eyebrow })} />
      <KitTextField label="Line 1" value={p.line1} onChange={(line1) => set({ line1 })} />
      <KitTextField label="Line 2" value={p.line2} onChange={(line2) => set({ line2 })} />
      <KitTextField label="Line 3" value={p.line3} onChange={(line3) => set({ line3 })} hint="Leave a line empty to drop it." />
      <LabChoice label="Heading colour" options={KIT_COLOR_OPTIONS} value={p.accent as KitColor} onChange={(accent) => set({ accent })} />
      <LabSlider label="Comes in over" value={p.duration} min={0.3} max={2.5} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(duration) => set({ duration })}
        hint="The card rises and each line follows a beat after the one above." />
    </>
  ),
});

// ---------- SectionCard ----------

type SectionCardStageProps = { number: number; of: number; title: string; bg: string; accent: string; hold: number };

function SectionCardStage(p: SectionCardStageProps) {
  const t = useKitCardSeconds();
  return (
    <AbsoluteFill>
      <KitStandInPage />
      {t > 0 && <SectionCard t={t} number={p.number} of={p.of} title={p.title} bg={p.bg} accent={p.accent} hold={p.hold} />}
    </AbsoluteFill>
  );
}

export const SECTION_CARD_PIECE = defineKitPiece<SectionCardStageProps>({
  id: 'section-card',
  name: 'SectionCard',
  title: 'Chapter card',
  blurb: 'A full-screen chapter title that slides away to reveal the next part.',
  source: 'lib/studio/kit.tsx',
  whenUsed: 'Longer walkthroughs split into parts: “3 / 6 · Finding a colour”, so the viewer knows where they are and how much is left.',
  note: <>The voice starts the next part while the card is still up, so the chapter title costs no extra time. Here the “scene underneath” is a stand-in page.</>,
  defaults: { number: 3, of: 6, title: 'Finding a colour', bg: LAB_COLORS.ink, accent: LAB_COLORS.red, hold: 1.3 },
  seconds: (p) => LEAD + p.hold + 0.55 + HOLD,
  Stage: SectionCardStage,
  Controls: ({ props: p, set }) => (
    <>
      <KitTextField label="Title" value={p.title} onChange={(title) => set({ title })} />
      <LabSlider label="Part" value={p.number} min={1} max={p.of} step={1} onChange={(number) => set({ number })} />
      <LabSlider label="Of" value={p.of} min={2} max={12} step={1} onChange={(of) => set({ of, number: Math.min(p.number, of) })} />
      <LabSlider label="Holds for" value={p.hold} min={0.4} max={3} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(hold) => set({ hold })}
        hint="How long it stays before sliding up. Long enough to read the title, no more." />
      <LabChoice label="Background" options={DARK_BG_OPTIONS} value={p.bg as KitDarkBg} onChange={(bg) => set({ bg })} />
      <LabChoice label="Accent" options={KIT_COLOR_OPTIONS} value={p.accent as KitColor} onChange={(accent) => set({ accent })} />
    </>
  ),
});

// ---------- EndCard ----------

type EndCardStageProps = { title: string; bg: string; duration: number };

function EndCardStage(p: EndCardStageProps) {
  const t = useKitCardSeconds();
  return (
    <AbsoluteFill>
      <KitStandInPage />
      <EndCard k={seg(t, 0, p.duration)} title={p.title} bg={p.bg} />
    </AbsoluteFill>
  );
}

export const END_CARD_PIECE = defineKitPiece<EndCardStageProps>({
  id: 'end-card',
  name: 'EndCard',
  title: 'End card',
  blurb: 'The last frame: a solid colour with one centred line.',
  source: 'lib/studio/kit.tsx',
  whenUsed: 'The very end of a walkthrough: the feature’s name, held for a moment so the video doesn’t just stop.',
  defaults: { title: 'Simple buy box', bg: LAB_COLORS.ink, duration: 0.6 },
  seconds: (p) => LEAD + p.duration + HOLD,
  Stage: EndCardStage,
  Controls: ({ props: p, set }) => (
    <>
      <KitTextField label="Title" value={p.title} onChange={(title) => set({ title })} />
      <LabChoice label="Background" options={DARK_BG_OPTIONS} value={p.bg as KitDarkBg} onChange={(bg) => set({ bg })} />
      <LabSlider label="Fades in over" value={p.duration} min={0.2} max={2} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(duration) => set({ duration })} />
    </>
  ),
});
