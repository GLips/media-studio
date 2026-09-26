import type { EndCardKitProps } from '#studio/lab/kit/end-card-kit-stage.tsx';
import { KIT_DARK_GROUND_OPTIONS } from '#studio/lab/kit/kit-stage-palette.ts';
import { LabChoice } from '../lab-choice.tsx';
import { LabSlider } from '../lab-slider.tsx';
import type { LabKitControlsProps } from './lab-kit-piece.ts';
import { LabKitTextField } from './lab-kit-text-field.tsx';

export function LabKitEndCardControls({ props: p, set }: LabKitControlsProps<EndCardKitProps>) {
  return (
    <>
      <LabKitTextField label="Title" value={p.title} onChange={(title) => set({ title })} />
      <LabChoice label="Background" options={KIT_DARK_GROUND_OPTIONS} value={p.bg} onChange={(bg) => set({ bg })} />
      <LabSlider label="Fades in over" value={p.duration} min={0.2} max={2} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(duration) => set({ duration })} />
    </>
  );
}
