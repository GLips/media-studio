import { KIT_ACCENT_OPTIONS, KIT_DARK_GROUND_OPTIONS } from '#studio/lab/kit/kit-stage-palette.ts';
import type { SectionCardKitProps } from '#studio/lab/kit/section-card-kit-stage.tsx';
import { LabChoice } from '../lab-choice.tsx';
import { LabSlider } from '../lab-slider.tsx';
import type { LabKitControlsProps } from './lab-kit-piece.ts';
import { LabKitTextField } from './lab-kit-text-field.tsx';

export function LabKitSectionCardControls({ props: p, set }: LabKitControlsProps<SectionCardKitProps>) {
  return (
    <>
      <LabKitTextField label="Title" value={p.title} onChange={(title) => set({ title })} />
      <LabSlider label="Part" value={p.number} min={1} max={p.of} step={1} onChange={(number) => set({ number })} />
      <LabSlider label="Of" value={p.of} min={2} max={12} step={1} onChange={(of) => set({ of, number: Math.min(p.number, of) })} />
      <LabSlider label="Holds for" value={p.hold} min={0.4} max={3} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(hold) => set({ hold })}
        hint="How long it stays before sliding up. Long enough to read the title, no more." />
      <LabChoice label="Background" options={KIT_DARK_GROUND_OPTIONS} value={p.bg} onChange={(bg) => set({ bg })} />
      <LabChoice label="Accent" options={KIT_ACCENT_OPTIONS} value={p.accent} onChange={(accent) => set({ accent })} />
    </>
  );
}
