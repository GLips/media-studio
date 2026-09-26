import { DRAW_PATH_KIT_PRESET_OPTIONS, type DrawPathKitProps } from '#studio/lab/kit/draw-path-kit-stage.tsx';
import { KIT_ACCENT_OPTIONS } from '#studio/lab/kit/kit-stage-palette.ts';
import { LabChoice } from '../lab-choice.tsx';
import { LabSlider } from '../lab-slider.tsx';
import type { LabKitControlsProps } from './lab-kit-piece.ts';

export function LabKitDrawPathControls({ props: p, set }: LabKitControlsProps<DrawPathKitProps>) {
  return (
    <>
      <LabChoice label="What it draws" options={DRAW_PATH_KIT_PRESET_OPTIONS} value={p.preset} onChange={(preset) => set({ preset })} />
      <LabSlider label="Thickness" value={p.width} min={2} max={40} step={1} format={(v) => `${v}px`} onChange={(width) => set({ width })} />
      <LabChoice label="Colour" options={KIT_ACCENT_OPTIONS} value={p.color} onChange={(color) => set({ color })} />
      <LabSlider label="Draws in" value={p.duration} min={0.2} max={2.5} step={0.05} format={(v) => `${v.toFixed(2)}s`} onChange={(duration) => set({ duration })} />
    </>
  );
}
