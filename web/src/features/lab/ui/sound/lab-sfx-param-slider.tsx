import type { SfxParamSpec, SfxRecipeName } from '#sfx/recipes.ts';
import { sfxParamWords } from '#models/lab/lab-sound-words.ts';
import { LabSlider } from '../lab-slider.tsx';
import { LabSfxParamName } from './lab-sfx-param-name.tsx';

const formatLabSfxParam = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : String(Number(v.toPrecision(3))));

type LabSfxParamSliderProps = {
  readonly recipe: SfxRecipeName;
  readonly name: string;
  readonly spec: SfxParamSpec;
  readonly value: number;
  /** Moved off the preset: marked with a •. */
  readonly changed: boolean;
  readonly onChange: (value: number) => void;
};

/** A slider for one parameter. Log-scaled parameters slide in log space, as mutate moves them, so each end gets room. */
export function LabSfxParamSlider({ recipe, name, spec, value, changed, onChange }: LabSfxParamSliderProps) {
  const whole = /semitones|rounded/i.test(spec.doc);
  const words = sfxParamWords(recipe, name);
  const label = `${words.label}${changed ? ' •' : ''}`;
  const hint = <>{words.hint} <LabSfxParamName>{name}</LabSfxParamName></>;
  if (spec.log) {
    const [lo, hi] = [Math.log(spec.min), Math.log(spec.max)];
    return (
      <LabSlider label={label} value={Math.log(value)} min={lo} max={hi} step={(hi - lo) / 400}
        onChange={(v) => onChange(Math.min(spec.max, Math.max(spec.min, Math.exp(v))))} format={() => formatLabSfxParam(value)} hint={hint} />
    );
  }
  return (
    <LabSlider label={label} value={value} min={spec.min} max={spec.max} step={whole ? 1 : (spec.max - spec.min) / 400}
      onChange={onChange} format={formatLabSfxParam} hint={hint} />
  );
}
