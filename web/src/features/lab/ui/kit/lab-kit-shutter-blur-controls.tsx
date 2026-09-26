import type { ShutterBlurKitProps } from '#studio/lab/kit/shutter-blur-kit-stage.tsx';
import { LabChoice } from '../lab-choice.tsx';
import { LabSlider } from '../lab-slider.tsx';
import type { LabKitControlsProps } from './lab-kit-piece.ts';

export function LabKitShutterBlurControls({ props: p, set }: LabKitControlsProps<ShutterBlurKitProps>) {
  return (
    <>
      <LabSlider label="Shutter" value={p.shutter} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 360)}°`} onChange={(shutter) => set({ shutter })}
        hint="How long the shutter stays open in each frame, as film cameras measure it: 180° is half the frame and the classic film look. 0 is no blur; 360° smears the whole way." />
      <LabSlider label="Copies per frame" value={p.samples} min={1} max={16} step={1} onChange={(samples) => set({ samples })}
        hint="How many copies are blended into each frame. Too few and you see separate ghosts; 6–10 is smooth. Each one costs another render." />
      <LabSlider label="Crossing takes" value={p.crossing} min={0.15} max={1.5} step={0.05} format={(v) => `${v.toFixed(2)}s`} onChange={(crossing) => set({ crossing })}
        hint="Faster crossings jump further between frames. At a second or more there’s little to fix." />
      <LabChoice label="Watch at" options={[{ value: 1, label: 'Real speed' }, { value: 2, label: '½ speed' }, { value: 4, label: '¼ speed' }]}
        value={p.slow} onChange={(slow) => set({ slow })} />
    </>
  );
}
