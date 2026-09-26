import { Code } from '@mantine/core';
import type { OdometerKitProps } from '#studio/lab/kit/odometer-kit-stage.tsx';
import { LabButtons } from '../lab-buttons.tsx';
import { LabChoice } from '../lab-choice.tsx';
import { LabSlider } from '../lab-slider.tsx';
import type { LabKitControlsProps } from './lab-kit-piece.ts';

const ODOMETER_KIT_PRESETS: readonly { label: string; props: Partial<OdometerKitProps> }[] = [
  { label: 'A total in a walkthrough', props: { from: 0, to: 1299, decimals: 0, format: 'dollars', mode: 'direct', duration: 1.8, curve: 'calm', punch: 0 } },
  { label: 'A price in a reel', props: { from: 0, to: 48250, decimals: 0, format: 'dollars', mode: 'mechanical', duration: 0.75, curve: 'fast', punch: 0.06 } },
  { label: 'A score, just for fun', props: { from: 0, to: 98, decimals: 0, format: 'percent', mode: 'slot', spin: 2, duration: 1.6, curve: 'calm', punch: 0 } },
];

const ODOMETER_KIT_MODE_HINTS = {
  mechanical: <>Each wheel turns only as the one to its right rolls past 9, like a real counter: the last digits blur by, the first ones click over. A big jump is all blur, which suits a quick reel. <Code>mechanical</Code></>,
  direct: <>Every wheel rolls straight to its new digit, all together. The calm, readable roll for a walkthrough. <Code>direct</Code></>,
  slot: <>Every wheel spins a few extra turns, then they lock one by one from the left. <Code>slot</Code></>,
} as const;

export function LabKitOdometerControls({ props: p, set }: LabKitControlsProps<OdometerKitProps>) {
  return (
    <>
      <LabButtons label="Start from" buttons={ODOMETER_KIT_PRESETS.map((preset) => ({ label: preset.label, onClick: () => set(preset.props) }))} />
      <LabChoice label="How the wheels turn" options={[{ value: 'mechanical', label: 'Geared' }, { value: 'direct', label: 'Straight there' }, { value: 'slot', label: 'Slot machine' }] as const}
        value={p.mode} onChange={(mode) => set({ mode })} hint={ODOMETER_KIT_MODE_HINTS[p.mode]} />
      {p.mode === 'slot' && <LabSlider label="Extra turns" value={p.spin} min={0} max={5} step={1} onChange={(spin) => set({ spin })} />}
      <LabSlider label="From" value={p.from} min={0} max={10000} step={1} format={(v) => v.toLocaleString('en-US')} onChange={(from) => set({ from })} />
      <LabSlider label="To" value={p.to} min={0} max={100000} step={1} format={(v) => v.toLocaleString('en-US')} onChange={(to) => set({ to })} />
      <LabChoice label="Shown as" options={[{ value: 'plain', label: '1,299' }, { value: 'dollars', label: '$' }, { value: 'percent', label: '%' }] as const}
        value={p.format} onChange={(format) => set({ format })} />
      <LabChoice label="Decimal places" options={[{ value: 0, label: '0' }, { value: 2, label: '2' }]} value={p.decimals} onChange={(decimals) => set({ decimals })} />
      <LabSlider label="Rolls for" value={p.duration} min={0.3} max={3} step={0.05} format={(v) => `${v.toFixed(2)}s`} onChange={(duration) => set({ duration })}
        hint="1.2–2.5 s in a walkthrough, so it can be read; 0.6–0.8 s in a fast reel." />
      <LabChoice label="Speed along the way" options={[{ value: 'calm', label: 'Calm' }, { value: 'fast', label: 'Fast arrival' }] as const}
        value={p.curve} onChange={(curve) => set({ curve })}
        hint={<>Nothing bouncy: a number that overshoots says the wrong number. <Code>{p.curve === 'calm' ? 'motionCurves.cubic.entrance' : 'motionCurves.expo.entrance'}</Code></>} />
      <LabSlider label="Pop as it lands" value={p.punch} min={0} max={0.15} step={0.01} format={(v) => (v ? `${Math.round(v * 100)}% bigger` : 'off')} onChange={(punch) => set({ punch })}
        hint={<>A quick swell when the number lands, for a reel's beat. 6% is plenty. <Code>punch</Code></>} />
      <LabSlider label="Motion blur" value={p.blur} min={0} max={1} step={0.05} format={(v) => (v ? `${Math.round(v * 100)}%` : 'off')} onChange={(blur) => set({ blur })}
        hint={<>Turn it off to see the digits step frame by frame instead of blurring. <Code>blur</Code></>} />
      <LabSlider label="Soft edges" value={p.fade} min={0} max={0.28} step={0.01} format={(v) => (v ? v.toFixed(2) : 'hard')} onChange={(fade) => set({ fade })}
        hint={<>How gently digits fade in and out at the top and bottom of their window. <Code>fade</Code></>} />
    </>
  );
}
