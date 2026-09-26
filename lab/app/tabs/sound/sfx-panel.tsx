// sfx-panel.tsx: the sound effects half of the Sound tab. It calls lib/sfx's renderSfx in the browser, exactly as a
// render does, plays the samples through Web Audio and draws them.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SFX_RATE } from '#sfx/dsp.ts';
import { renderSfx, sfxParamSpecs, sfxRecipeNamed, SFX_LOUDNESS_UNDER_VOICE, type SfxRequest } from '#sfx/library.ts';
import { SFX_RECIPES, type SfxParamSpec, type SfxRecipeName } from '#sfx/recipes.ts';
import { LabBench, LabChoice, LabNote, LabSlider } from '../../ui.tsx';
import { audioBufferFromChannels, playLabBuffer, useLabPlayhead } from './lab-audio.ts';
import { SfxWaveform } from './sfx-waveform.tsx';
import { SFX_RECIPE_WORDS, sfxParamWords, SoundForAgents } from './sound-words.tsx';

const SFX_PLAYER_ID = 'sfx';
const SFX_RECIPE_NAMES = Object.keys(SFX_RECIPES) as SfxRecipeName[];
/** The preset choice that means the recipe's own defaults. */
const STANDARD_PRESET = '';

/** Recipe docs mark names with backticks; show those as code. */
const sfxDocText = (doc: string): ReactNode =>
  doc.split(/(`[^`]+`)/).map((part, i) => (part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part));

const playLabSfx = (samples: Float32Array) => playLabBuffer(SFX_PLAYER_ID, audioBufferFromChannels([samples], SFX_RATE));

const formatSfxParam = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : String(Number(v.toPrecision(3))));

/** A slider for one parameter. Log-scaled parameters slide in log space, as mutate moves them, so each end gets room. */
function SfxParamSlider({ recipe, name, spec, value, changed, onChange }: {
  recipe: SfxRecipeName; name: string; spec: SfxParamSpec; value: number; changed: boolean; onChange: (v: number) => void;
}) {
  const whole = /semitones|rounded/i.test(spec.doc);
  const words = sfxParamWords(recipe, name);
  const label = `${words.label}${changed ? ' •' : ''}`;
  const hint = <>{words.hint} <code className="sfx-param-name">{name}</code></>;
  if (spec.log) {
    const [lo, hi] = [Math.log(spec.min), Math.log(spec.max)];
    return (
      <LabSlider label={label} value={Math.log(value)} min={lo} max={hi} step={(hi - lo) / 400}
        onChange={(v) => onChange(Math.min(spec.max, Math.max(spec.min, Math.exp(v))))} format={() => formatSfxParam(value)} hint={hint} />
    );
  }
  return (
    <LabSlider label={label} value={value} min={spec.min} max={spec.max} step={whole ? 1 : (spec.max - spec.min) / 400}
      onChange={onChange} format={formatSfxParam} hint={hint} />
  );
}

/** True when a key press is meant for a field or the page's own controls, not for playing the sound. */
const keyIsForAField = (e: KeyboardEvent) =>
  e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && (e.target as HTMLInputElement).type !== 'range'));

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

  // The last take stays faintly behind the new one, so a change of take or setting shows what it changed.
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

  // P plays the sound, like a drum pad; shift-P plays a new take of it.
  const latest = useRef(rendered.floats);
  latest.current = rendered.floats;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'p' || e.repeat || keyIsForAField(e)) return;
      e.preventDefault();
      if (e.shiftKey) setSeed((s) => s + 1);
      else playLabSfx(latest.current);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const specs = sfxParamSpecs(recipe);
  const request: SfxRequest = { sound, ...(Object.keys(set).length ? { set } : {}), seed, ...(vary ? { mutate: vary } : {}) };
  const stage = (
    <div className="sfx-stage">
      <SfxWaveform samples={rendered.floats} ghost={ghost} rate={SFX_RATE} landsAt={rendered.landsAt} playhead={playhead} />
      <div className="sfx-actions">
        <button type="button" className="sound-button primary" onClick={play}>▶ Play <kbd>P</kbd></button>
        <button type="button" className="sound-button" onClick={() => setSeed((s) => s + 1)}>↻ Same sound, played again <kbd>⇧P</kbd></button>
        <span className="hud">
          take {seed} · {rendered.seconds.toFixed(2)} s · {recipe.category === 'ui' ? 'a small sound: set well under the voice' : 'an accent: set a little quieter than the voice'}
        </span>
      </div>
      <LabNote>
        <b>Played again</b> is the same sound with new tiny random details (the exact grain of the noise, a hair of pitch),
        the way no two real clicks match, so ten clicks in a row don't sound like a machine gun. The faint grey wave is the
        previous take. The red line marks where the hit lands: a video lines that moment up with what you see (a click
        with the cursor press, a whoosh's loudest point with the fastest part of a move), even when the sound starts earlier.
      </LabNote>
    </div>
  );

  return (
    <section className="sound-part">
      <header className="sound-part-head">
        <span className="hud">01 — Sound effects</span>
        <h3>Clicks, whooshes and chimes, made from scratch</h3>
      </header>

      <LabBench stage={stage}>
        <div className="controls">
          <LabChoice label="Sound" value={recipeName} options={SFX_RECIPE_NAMES.map((n) => ({ value: n, label: n }))}
            onChange={(n) => { setRecipeName(n); setPreset(STANDARD_PRESET); setSet({}); }}
            hint={SFX_RECIPE_WORDS[recipeName]} />
          <LabChoice label="Preset" value={preset}
            options={[{ value: STANDARD_PRESET, label: 'standard' }, ...Object.keys(recipe.presets).map((p) => ({ value: p, label: p }))]}
            onChange={(p) => { setPreset(p); setSet({}); }}
            hint="A named starting point for the settings below." />
          {Object.entries(specs).map(([name, spec]) => (
            <SfxParamSlider key={`${sound}/${name}`} recipe={recipeName} name={name} spec={spec} value={rendered.params[name]} changed={name in set}
              onChange={(v) => setSet((s) => ({ ...s, [name]: v }))} />
          ))}
          <LabSlider label="Variation" value={vary} min={0} max={1} step={0.01} onChange={setVary} format={(v) => v.toFixed(2)}
            hint={<>Lets each take also nudge the settings above (the ones without a •) by up to this much of their range. For sounds that repeat a lot. <code className="sfx-param-name">mutate</code></>} />
          <div className="sfx-reset">
            <button type="button" className="sound-button" disabled={!Object.keys(set).length} onClick={() => setSet({})}>Reset to the preset</button>
            <small>A • marks a setting you've moved.</small>
          </div>
        </div>
        <SoundForAgents>
          <p>What a video asks lib/sfx for, to get this exact sound:</p>
          <pre>{JSON.stringify(request, null, 1).replace(/\n\s*/g, ' ')}</pre>
          <p>
            {rendered.lufs.toFixed(1)} LUFS: the {recipe.category} category sits {-SFX_LOUDNESS_UNDER_VOICE[recipe.category]} LU under
            the voice (ui {SFX_LOUDNESS_UNDER_VOICE.ui}, accent {SFX_LOUDNESS_UNDER_VOICE.accent}). The seed is the take number here;
            in a video it's the event's id.
          </p>
          <p>{sfxDocText(recipe.doc)}</p>
          <ul>
            {Object.entries(specs).map(([name, spec]) => <li key={name}><code>{name}</code> {spec.min}–{spec.max}: {sfxDocText(spec.doc)}</li>)}
          </ul>
        </SoundForAgents>
      </LabBench>
      <LabNote>
        <b>Why make sounds instead of downloading them?</b> A sample library gives you one fixed recording per sound. Here
        each sound is a small recipe: a model of what makes it (a plastic switch snapping, air rushing past, a struck
        glass). So the studio can make a click a little different every time, stretch a whoosh to exactly the length of a
        move, put a riser's peak right on a reveal, and set every sound at the same level quieter than the voice (small
        sounds like clicks well under it, accents like whooshes and chimes a little under). No licences, no hunting for
        files, and the same request always makes the same sound.
      </LabNote>
    </section>
  );
}
