import { PRICE_HOLD_CLEAN, PRICE_HOLD_SECONDS, type PriceHoldParams } from '#models/lab/hold-price.ts';
import { LabButtons } from '../lab-buttons.tsx';
import { LabChoice } from '../lab-choice.tsx';
import { LabControls } from '../lab-controls.tsx';
import { LabSlider } from '../lab-slider.tsx';

const PRICE_HOLD_PRESETS: readonly { label: string; params: PriceHoldParams }[] = [
  { label: 'Clean', params: PRICE_HOLD_CLEAN },
  { label: 'Shaky', params: { ...PRICE_HOLD_CLEAN, wobble: 2.5 } },
  { label: 'Slow arrival', params: { ...PRICE_HOLD_CLEAN, entrance: 3.2 } },
  { label: 'Never stops', params: { ...PRICE_HOLD_CLEAN, drift: 3 } },
  { label: 'Leaves too soon', params: { ...PRICE_HOLD_CLEAN, fadeAt: 1.8 } },
  { label: 'Too faint', params: { ...PRICE_HOLD_CLEAN, peak: 0.85 } },
];

const WITHIN_OPTIONS = [{ value: 2, label: '2px (default)' }, { value: 4, label: '4px' }, { value: 8, label: '8px' }];

type LabHoldControlsProps = { readonly params: PriceHoldParams; readonly onChange: (params: PriceHoldParams) => void };

/** The presets that each break the hold a different way, and a slider per way it can break. */
export function LabHoldControls({ params, onChange }: LabHoldControlsProps) {
  const set = <K extends keyof PriceHoldParams>(k: K) => (v: PriceHoldParams[K]) => onChange({ ...params, [k]: v });
  return (
    <LabControls stacked>
      <LabButtons label="Try a problem" buttons={PRICE_HOLD_PRESETS.map((p) => ({ label: p.label, onClick: () => onChange(p.params) }))}
        hint="Each one breaks the hold a different way. Then drag the sliders to find exactly where it tips over." />
      <LabSlider label="Promised hold" value={params.need} min={0.5} max={4} step={0.1} onChange={set('need')} format={(v) => `${v}s`}
        hint="How long the scene says the price stays readable. Longer is harder to keep." />
      <LabSlider label="Shake" value={params.wobble} min={0} max={6} step={0.1} onChange={set('wobble')} format={(v) => `±${v}px`}
        hint="A hand-held wobble. Even ±1.1px moves it more than the 2px the check allows: tiny on the card, obvious in the zoomed corner." />
      <LabSlider label="Keeps drifting" value={params.drift} min={0} max={12} step={0.1} onChange={set('drift')} format={(v) => `${v}px/s`}
        hint="After it lands, does it keep creeping? A slow drift adds up: 2px of travel ends the steady stretch." />
      <LabSlider label="Arrival takes" value={params.entrance} min={0.2} max={4} step={0.1} onChange={set('entrance')} format={(v) => `${v}s`}
        hint="How long the slide-in lasts. It doesn't count as still until the tail of the slide is under 2px, so a slow arrival eats the hold." />
      <LabSlider label="Starts fading at" value={params.fadeAt} min={1} max={PRICE_HOLD_SECONDS} step={0.1} onChange={set('fadeAt')} format={(v) => (v >= PRICE_HOLD_SECONDS ? 'never' : `${v}s`)}
        hint="When the card begins to fade away. Below 95% solid it no longer counts as visible." />
      <LabSlider label="How solid" value={params.peak} min={0.6} max={1} step={0.01} onChange={set('peak')} format={(v) => `${Math.round(v * 100)}%`}
        hint="How see-through the card is once it's in (100% = fully solid). A see-through card never counts, however still it is." />
      <LabChoice label="Counts as still within" options={WITHIN_OPTIONS} value={params.within} onChange={set('within')}
        hint="How far it may move and still count as still. A scene can loosen this for something that's meant to gently breathe." />
    </LabControls>
  );
}
