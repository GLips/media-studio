import { WORD_REVEAL_KIT_UNCAPPED, type WordRevealKitProps } from '#studio/lab/kit/word-reveal-kit-stage.tsx';
import { LabChoice } from '../lab-choice.tsx';
import { LabSlider } from '../lab-slider.tsx';
import type { LabKitControlsProps } from './lab-kit-piece.ts';
import { LabKitTextField } from './lab-kit-text-field.tsx';

export function LabKitWordRevealControls({ props: p, set }: LabKitControlsProps<WordRevealKitProps>) {
  return (
    <>
      <LabKitTextField label="Words" value={p.text} onChange={(text) => set({ text })} />
      <LabChoice label="Comes in" options={[{ value: 'words', label: 'Word by word' }, { value: 'letters', label: 'Letter by letter' }]}
        value={p.letters ? 'letters' : 'words'} onChange={(v) => set({ letters: v === 'letters' })} />
      <LabSlider label="Gap between each" value={p.each} min={0.02} max={0.25} step={0.01} format={(v) => `${Math.round(v * 1000)} ms`} onChange={(each) => set({ each })}
        hint="40–80 ms reads as one gesture. Much longer and it reads as a list being typed." />
      <LabSlider label="Whole ripple capped at" value={p.maxSlider} min={0.2} max={WORD_REVEAL_KIT_UNCAPPED} step={0.05}
        format={(v) => (v >= WORD_REVEAL_KIT_UNCAPPED ? 'no cap' : `${v.toFixed(2)}s`)}
        onChange={(maxSlider) => set({ maxSlider })} hint="Squeezes the gaps so a long line still finishes in time." />
      <LabSlider label="Each word’s fade-in" value={p.duration} min={0.1} max={1.2} step={0.05} format={(v) => `${v.toFixed(2)}s`} onChange={(duration) => set({ duration })} />
      <LabSlider label="Rise" value={p.rise} min={0} max={80} step={2} format={(v) => `${v}px`} onChange={(rise) => set({ rise })} hint="How far each word floats up as it appears." />
      <LabSlider label="Size" value={p.size} min={40} max={180} step={2} format={(v) => `${v}px`} onChange={(size) => set({ size })} />
      <LabSlider label="Weight" value={p.weight} min={300} max={900} step={100} onChange={(weight) => set({ weight })} />
      <LabChoice label="Align" options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }] as const}
        value={p.align} onChange={(align) => set({ align })} />
    </>
  );
}
