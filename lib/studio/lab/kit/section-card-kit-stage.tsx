// section-card-kit-stage.tsx: the Kit pieces stage for SectionCard: a chapter card over a stand-in page, sliding away
// to reveal it.
import { AbsoluteFill } from 'remotion';
import { SectionCard } from '../../kit/kit.tsx';
import { LAB_COLORS } from '../lab-format.ts';
import { KIT_STAGE_HOLD, KIT_STAGE_LEAD, useKitStageSeconds } from './kit-stage-clock.tsx';
import type { KitAccentColor, KitDarkGround } from './kit-stage-palette.ts';
import { KitStandInPage } from './kit-stand-in-page.tsx';

export type SectionCardKitProps = { number: number; of: number; title: string; bg: KitDarkGround; accent: KitAccentColor; hold: number };

export const SECTION_CARD_KIT_DEFAULTS: SectionCardKitProps = { number: 3, of: 6, title: 'Finding a colour', bg: LAB_COLORS.ink, accent: LAB_COLORS.red, hold: 1.3 };

export const sectionCardKitSeconds = (p: SectionCardKitProps) => KIT_STAGE_LEAD + p.hold + 0.55 + KIT_STAGE_HOLD;

export function SectionCardKitStage(p: SectionCardKitProps) {
  const t = useKitStageSeconds();
  return (
    <AbsoluteFill>
      <KitStandInPage />
      {t > 0 && <SectionCard t={t} number={p.number} of={p.of} title={p.title} bg={p.bg} accent={p.accent} hold={p.hold} />}
    </AbsoluteFill>
  );
}
