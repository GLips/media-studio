import type { GlassCardKitProps } from '#studio/lab/kit/glass-card-kit-stage.tsx';
import { KIT_ACCENT_OPTIONS } from '#studio/lab/kit/kit-stage-palette.ts';
import { LabChoice } from '../lab-choice.tsx';
import { LabSlider } from '../lab-slider.tsx';
import type { LabKitControlsProps } from './lab-kit-piece.ts';
import { LabKitTextField } from './lab-kit-text-field.tsx';

export function LabKitGlassCardControls({ props: p, set }: LabKitControlsProps<GlassCardKitProps>) {
  return (
    <>
      <LabKitTextField label="Small heading" value={p.eyebrow} onChange={(eyebrow) => set({ eyebrow })} />
      <LabKitTextField label="Line 1" value={p.line1} onChange={(line1) => set({ line1 })} />
      <LabKitTextField label="Line 2" value={p.line2} onChange={(line2) => set({ line2 })} />
      <LabKitTextField label="Line 3" value={p.line3} onChange={(line3) => set({ line3 })} hint="Leave a line empty to drop it." />
      <LabChoice label="Heading colour" options={KIT_ACCENT_OPTIONS} value={p.accent} onChange={(accent) => set({ accent })} />
      <LabSlider label="Comes in over" value={p.duration} min={0.3} max={2.5} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(duration) => set({ duration })}
        hint="The card rises and each line follows a beat after the one above." />
    </>
  );
}
