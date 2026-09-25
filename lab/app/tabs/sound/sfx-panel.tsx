// sfx-panel.tsx: the sound effects half of the Sound tab. It calls lib/sfx's renderSfx in the browser, exactly as a
// render does, plays the samples through Web Audio and draws them.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SFX_RATE } from '../../../../lib/sfx/dsp.ts';
import { renderSfx, sfxParamSpecs, sfxRecipeNamed, SFX_LOUDNESS_UNDER_VOICE } from '../../../../lib/sfx/library.ts';
import { SFX_RECIPES, type SfxParamSpec, type SfxRecipeName } from '../../../../lib/sfx/recipes.ts';
import { LabChoice, LabControls, LabNote, LabSlider } from '../../ui.tsx';
import { audioBufferFromChannels, playLabBuffer, useLabPlayhead } from './lab-audio.ts';
import { SfxWaveform } from './sfx-waveform.tsx';

const SFX_PLAYER_ID = 'sfx';
const SFX_RECIPE_NAMES = Object.keys(SFX_RECIPES) as SfxRecipeName[];
/** The preset choice that means the recipe's own defaults. */
const STANDARD_PRESET = '';

/** Recipe docs mark names with backticks; show those as code. */
export const sfxDocText = (doc: string): ReactNode =>
  doc.split(/(`[^`]+`)/).map((part, i) => (part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part));

const playLabSfx = (samples: Float32Array) => playLabBuffer(SFX_PLAYER_ID, audioBufferFromChannels([samples], SFX_RATE));

const formatSfxParam = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : String(Number(v.toPrecision(3))));

/** A slider for one parameter. Log-scaled parameters slide in log space, as mutate moves them, so each end gets room. */
function SfxParamSlider({ name, spec, value, changed, onChange }: {
  name: string; spec: SfxParamSpec; value: number; changed: boolean; onChange: (v: number) => void;
}) {
  const whole = /semitones|rounded/i.test(spec.doc);
  const label = `${name}${changed ? ' •' : ''}`;
  if (spec.log) {
    const [lo, hi] = [Math.log(spec.min), Math.log(spec.max)];
    return (
      <LabSlider label={label} value={Math.log(value)} min={lo} max={hi} step={(hi - lo) / 400}
        onChange={(v) => onChange(Math.min(spec.max, Math.max(spec.min, Math.exp(v))))} format={() => formatSfxParam(value)} hint={sfxDocText(spec.doc)} />
    );
  }
  return (
    <LabSlider label={label} value={value} min={spec.min} max={spec.max} step={whole ? 1 : (spec.max - spec.min) / 400}
      onChange={onChange} format={formatSfxParam} hint={sfxDocText(spec.doc)} />
  );
}

export function SfxPanel() {
  const [recipeName, setRecipeName] = useState<SfxRecipeName>('chime');
  const [preset, setPreset] = useState('success');
  const [set, setSet] = useState<Record<string, number>>({});
  const [seed, setSeed] = useState(1);
  const [vary, setVary] = useState(0);
  const recipe = sfxRecipeNamed(recipeName);
  const sound = preset === STANDARD_PRESET ? recipeName : `${recipeName}.${preset}`;

  const rendered = useMemo(() => {
    const sfx = renderSfx({ sound, set, seed, mutate: vary });
    return { ...sfx, floats: Float32Array.from(sfx.samples, (v) => v / 32767) };
  }, [sound, set, seed, vary]);

  // The last take stays faintly behind the new one, so a change of seed or setting shows what it changed.
  const previous = useRef<typeof rendered | undefined>(undefined);
  const [ghost, setGhost] = useState<Float32Array | undefined>();
  useEffect(() => {
    setGhost(previous.current?.sound === rendered.sound ? previous.current.floats : undefined);
    previous.current = rendered;
  }, [rendered]);

  const play = () => playLabSfx(rendered.floats);
  // Every change plays the new sound, once the page has had a click (browsers won't make sound before one); arriving
  // on the tab doesn't.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!navigator.userActivation.hasBeenActive) return;
    const timer = setTimeout(() => playLabSfx(rendered.floats), 180);
    return () => clearTimeout(timer);
  }, [rendered]);
  const playhead = useLabPlayhead(SFX_PLAYER_ID);

  const specs = sfxParamSpecs(recipe);
  const underVoice = -SFX_LOUDNESS_UNDER_VOICE[recipe.category];
  return (
    <section className="sound-part">
      <header className="sound-part-head">
        <span className="hud">01 — Sound effects</span>
        <h3>Clicks, whooshes and chimes, made from scratch</h3>
      </header>

      <LabControls>
        <LabChoice label="Sound" value={recipeName} options={SFX_RECIPE_NAMES.map((n) => ({ value: n, label: n }))}
          onChange={(n) => { setRecipeName(n); setPreset(STANDARD_PRESET); setSet({}); }}
          hint={sfxDocText(recipe.doc)} />
        <LabChoice label="Preset" value={preset}
          options={[{ value: STANDARD_PRESET, label: 'standard' }, ...Object.keys(recipe.presets).map((p) => ({ value: p, label: p }))]}
          onChange={(p) => { setPreset(p); setSet({}); }}
          hint={<>A preset is a named starting point: in a video this is <code>{sound}</code>.</>} />
      </LabControls>

      <div className="sfx-stage">
        <SfxWaveform samples={rendered.floats} ghost={ghost} rate={SFX_RATE} landsAt={rendered.landsAt} playhead={playhead} />
        <div className="sfx-actions">
          <button type="button" className="sound-button primary" onClick={play}>▶ Play</button>
          <button type="button" className="sound-button" onClick={() => setSeed((s) => s + 1)}>↻ Same sound, played again</button>
          <span className="hud">take {seed} · {rendered.seconds.toFixed(2)} s · {rendered.lufs.toFixed(1)} LUFS ({underVoice} dB under the voice)</span>
        </div>
      </div>
      <LabNote>
        <b>Play it again</b> gives the sound a new <b>seed</b>, a number that picks its tiny random details: the exact grain
        of the noise, a hair of pitch. It's the same sound played twice, the way no two real clicks match, so ten clicks in
        a row don't sound like a machine gun. The faint grey wave is the previous take. The red line marks
        where the hit lands: a video lines that moment up with what you see (a click with the cursor press, a whoosh's
        loudest point with the fastest part of a move), even when the sound starts earlier.
      </LabNote>

      <LabControls>
        {Object.entries(specs).map(([name, spec]) => (
          <SfxParamSlider key={`${sound}/${name}`} name={name} spec={spec} value={rendered.params[name]} changed={name in set}
            onChange={(v) => setSet((s) => ({ ...s, [name]: v }))} />
        ))}
        <LabSlider label="vary" value={vary} min={0} max={1} step={0.01} onChange={setVary} format={(v) => v.toFixed(2)}
          hint="Lets each take also nudge the settings above (the ones without a •) by up to this much of their range. For sounds that repeat a lot." />
        <div className="sfx-reset">
          <button type="button" className="sound-button" disabled={!Object.keys(set).length} onClick={() => setSet({})}>Reset to the preset</button>
          <small>A • marks a setting you've moved.</small>
        </div>
      </LabControls>

      <LabNote>
        <b>Why make sounds instead of downloading them?</b> A sample library gives you one fixed recording per sound. Here
        each sound is a small recipe: a model of what makes it (a plastic switch snapping, air rushing past, a struck
        glass). So the studio can make a click a little different every time, stretch a whoosh to exactly the length of
        a move, put a riser's peak right on a reveal, and level every sound to the same loudness under the voice
        ({-SFX_LOUDNESS_UNDER_VOICE.ui} dB under it for small sounds like clicks, {-SFX_LOUDNESS_UNDER_VOICE.accent} dB under
        for accents like whooshes and chimes). No licences, no hunting for files, and the same request always makes the same sound.
      </LabNote>
    </section>
  );
}
