import type { GradeKitProps } from '#studio/lab/kit/grade-kit-stage.tsx';
import { LabChoice } from '../lab-choice.tsx';
import { LabSlider } from '../lab-slider.tsx';
import type { LabKitControlsProps } from './lab-kit-piece.ts';

export function LabKitGradeControls({ props: p, set }: LabKitControlsProps<GradeKitProps>) {
  return (
    <>
      <LabChoice label="Show" options={[{ value: 'split', label: 'Before | after' }, { value: 'with', label: 'With' }, { value: 'without', label: 'Without' }] as const}
        value={p.compare} onChange={(compare) => set({ compare })} />
      <LabSlider label="Grain" value={p.grain} min={0} max={0.3} step={0.01} format={(v) => v.toFixed(2)} onChange={(grain) => set({ grain })} hint="How strong the grain is. 0 turns it off." />
      <LabSlider label="Grain fineness" value={p.grainScale} min={0.3} max={1.5} step={0.05} format={(v) => v.toFixed(2)} onChange={(grainScale) => set({ grainScale })}
        hint="Lower is coarser, chunkier grain; higher is finer." />
      <LabSlider label="Vignette" value={p.vignette} min={0} max={0.9} step={0.05} format={(v) => v.toFixed(2)} onChange={(vignette) => set({ vignette })} hint="How dark the corners get." />
      <LabSlider label="Vignette starts at" value={p.inner} min={0.1} max={0.9} step={0.05} format={(v) => `${Math.round(v * 100)}% out`} onChange={(inner) => set({ inner })}
        hint="How far from the centre the darkening begins. Lower creeps further in." />
    </>
  );
}
