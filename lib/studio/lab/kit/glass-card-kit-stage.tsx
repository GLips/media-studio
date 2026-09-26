// glass-card-kit-stage.tsx: the Kit pieces stage for GlassCard: the frosted summary card over a blurred, tinted
// stand-in page.
import { AbsoluteFill } from 'remotion';
import { motionCurves, seg } from '#models/motion/motion.ts';
import { GlassCard } from '../../kit/kit.tsx';
import { LAB_COLORS } from '../lab-format.ts';
import { KIT_STAGE_HOLD, KIT_STAGE_LEAD, useKitStageSeconds } from './kit-stage-clock.tsx';
import type { KitAccentColor } from './kit-stage-palette.ts';
import { KitStandInPage } from './kit-stand-in-page.tsx';

export type GlassCardKitProps = { eyebrow: string; line1: string; line2: string; line3: string; accent: KitAccentColor; duration: number };

export const GLASS_CARD_KIT_DEFAULTS: GlassCardKitProps = {
  eyebrow: 'IN SHORT', line1: 'One price per customer', line2: 'Set once, applied everywhere', line3: 'Live for every store today',
  accent: LAB_COLORS.red, duration: 0.9,
};

export const glassCardKitSeconds = (p: GlassCardKitProps) => KIT_STAGE_LEAD + p.duration + 0.6 + KIT_STAGE_HOLD;

export function GlassCardKitStage(p: GlassCardKitProps) {
  const t = useKitStageSeconds();
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
