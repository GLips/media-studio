// word-reveal-kit-stage.tsx: the Kit pieces stage for WordReveal: a line of words rippling in on the showcase ground,
// with when the last one lands.
import { AbsoluteFill, useVideoConfig } from 'remotion';
import { WordReveal, wordRevealFinish } from '../../kit/kit.tsx';
import { LAB_COLORS, LAB_FORMAT } from '../lab-format.ts';
import { KIT_STAGE_HOLD, KIT_STAGE_LEAD, KitStageHud, useKitStageSeconds } from './kit-stage-clock.tsx';

/** The "capped at" slider's far end, which means no cap, so one control covers both. */
export const WORD_REVEAL_KIT_UNCAPPED = 2;

export type WordRevealKitProps = {
  text: string; size: number; weight: number; letters: boolean; each: number; maxSlider: number; duration: number; rise: number;
  align: 'left' | 'center' | 'right';
};

export const WORD_REVEAL_KIT_DEFAULTS: WordRevealKitProps = {
  text: 'Every order ships the same day', size: 110, weight: 800, letters: false, each: 0.08, maxSlider: WORD_REVEAL_KIT_UNCAPPED,
  duration: 0.45, rise: 24, align: 'left',
};

const wordRevealKitTiming = (p: WordRevealKitProps) => ({
  each: p.each, duration: p.duration, max: p.maxSlider >= WORD_REVEAL_KIT_UNCAPPED ? undefined : p.maxSlider,
});

export const wordRevealKitSeconds = (p: WordRevealKitProps) =>
  KIT_STAGE_LEAD + wordRevealFinish(p.text, { fps: LAB_FORMAT.fps, letters: p.letters, timing: wordRevealKitTiming(p) }) + KIT_STAGE_HOLD;

export function WordRevealKitStage(p: WordRevealKitProps) {
  const t = useKitStageSeconds();
  const { fps } = useVideoConfig();
  const timing = wordRevealKitTiming(p);
  const finish = wordRevealFinish(p.text, { fps, letters: p.letters, timing });
  return (
    <AbsoluteFill style={{ background: LAB_COLORS.ground }}>
      <KitStageHud left={`Words one by one · ${p.letters ? 'letter by letter' : 'word by word'}`} right={`all in by ${finish.toFixed(2)}s · now ${Math.max(0, t).toFixed(2)}s in`} />
      <WordReveal t={t} text={p.text} x={160} y={380} width={1600} size={p.size} weight={p.weight} color={LAB_COLORS.cream}
        align={p.align} rise={p.rise} letters={p.letters} timing={timing} />
    </AbsoluteFill>
  );
}
