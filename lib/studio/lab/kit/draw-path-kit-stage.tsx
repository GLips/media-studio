// draw-path-kit-stage.tsx: the Kit pieces stage for DrawPath: a pen stroke drawing itself onto the thing it points at
// (a ring, a word, a price, a button), with how far along it is.
import type { ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';
import { DISPLAY_FONT, MONO_FONT } from '#models/type/faces.ts';
import { DrawPath } from '../../kit/kit.tsx';
import { LAB_COLORS } from '../lab-format.ts';
import { KIT_STAGE_HOLD, KIT_STAGE_LEAD, KitStageHud, useKitStageSeconds } from './kit-stage-clock.tsx';
import type { KitAccentColor } from './kit-stage-palette.ts';

export type DrawPathKitPreset = 'check' | 'underline' | 'circle' | 'arrow';

export type DrawPathKitProps = { preset: DrawPathKitPreset; width: number; color: KitAccentColor; duration: number };

export const DRAW_PATH_KIT_DEFAULTS: DrawPathKitProps = { preset: 'underline', width: 14, color: LAB_COLORS.red, duration: 0.8 };

export const drawPathKitSeconds = (p: DrawPathKitProps) => KIT_STAGE_LEAD + p.duration + KIT_STAGE_HOLD;

const DISPLAY_TEXT = { fontFamily: DISPLAY_FONT, fontWeight: 900, textTransform: 'uppercase', color: LAB_COLORS.cream, lineHeight: 1 } as const;

type DrawPathKitScene = { label: string; d: string; viewBox?: string; box?: { x: number; y: number; w: number; h: number }; behind: () => ReactNode };

// Each preset is the thing a stroke points at, and the stroke, in frame pixels unless it gives its own viewBox.
const DRAW_PATH_KIT_SCENES: Record<DrawPathKitPreset, DrawPathKitScene> = {
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

/** The presets in the order they're offered, with their plain-words names. */
export const DRAW_PATH_KIT_PRESET_OPTIONS = (['check', 'underline', 'circle', 'arrow'] as const).map((value) => ({ value, label: DRAW_PATH_KIT_SCENES[value].label }));

export function DrawPathKitStage(p: DrawPathKitProps) {
  const t = useKitStageSeconds();
  const scene = DRAW_PATH_KIT_SCENES[p.preset];
  const k = Math.max(0, t / p.duration);
  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground }}>
      <KitStageHud left={`Pen stroke · ${scene.label}`} right={k >= 1 ? 'drawn' : `drawing · ${Math.round(Math.min(1, k) * 100)}% of the time`} />
      {scene.behind()}
      <DrawPath d={scene.d} k={k} color={p.color} width={p.width} box={scene.box} viewBox={scene.viewBox} />
    </AbsoluteFill>
  );
}
