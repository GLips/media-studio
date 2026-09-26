// end-card-kit-stage.tsx: the Kit pieces stage for EndCard: the closing card fading in over a stand-in page.
import { AbsoluteFill } from 'remotion';
import { seg } from '#models/motion/motion.ts';
import { EndCard } from '../../kit/kit.tsx';
import { LAB_COLORS } from '../lab-format.ts';
import { KIT_STAGE_HOLD, KIT_STAGE_LEAD, useKitStageSeconds } from './kit-stage-clock.tsx';
import type { KitDarkGround } from './kit-stage-palette.ts';
import { KitStandInPage } from './kit-stand-in-page.tsx';

export type EndCardKitProps = { title: string; bg: KitDarkGround; duration: number };

export const END_CARD_KIT_DEFAULTS: EndCardKitProps = { title: 'Simple buy box', bg: LAB_COLORS.ink, duration: 0.6 };

export const endCardKitSeconds = (p: EndCardKitProps) => KIT_STAGE_LEAD + p.duration + KIT_STAGE_HOLD;

export function EndCardKitStage(p: EndCardKitProps) {
  const t = useKitStageSeconds();
  return (
    <AbsoluteFill>
      <KitStandInPage />
      <EndCard k={seg(t, 0, p.duration)} title={p.title} bg={p.bg} />
    </AbsoluteFill>
  );
}
