import { useEffect, useMemo, useRef, useState } from 'react';
import { SFX_RATE } from '#sfx/dsp.ts';
import { renderSfx, sfxRecipeNamed, type SfxRequest } from '#sfx/library.ts';
import { SFX_RECIPES, type SfxRecipeName } from '#sfx/recipes.ts';
import { audioBufferFromChannels, playLabBuffer } from './lab-audio.ts';

export const LAB_SFX_PLAYER_ID = 'sfx';
export const LAB_SFX_RECIPE_NAMES = Object.keys(SFX_RECIPES).filter((n): n is SfxRecipeName => n in SFX_RECIPES);
/** The preset choice that means the recipe's own defaults. */
export const LAB_SFX_STANDARD_PRESET = '';

const playLabSfx = (samples: Float32Array) => playLabBuffer(LAB_SFX_PLAYER_ID, audioBufferFromChannels([samples], SFX_RATE));

/** True when a key press is meant for a field or the page's own controls, not for playing the sound. */
const keyIsForAField = (e: KeyboardEvent) =>
  e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof HTMLElement && (e.target.isContentEditable ||
    (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !(e.target instanceof HTMLInputElement && e.target.type === 'range'))));

/**
 * The sound effects panel's state: a recipe, preset, settings, take and variation, rendered by lib/sfx exactly as a
 * render does. Every change plays the new take, and P plays it (shift-P a new take), like a drum pad.
 */
export function useLabSfxTake() {
  const [recipeName, setRecipeName] = useState<SfxRecipeName>('chime');
  const [preset, setPreset] = useState('success');
  const [set, setSet] = useState<Record<string, number>>({});
  const [seed, setSeed] = useState(1);
  const [vary, setVary] = useState(0);
  const recipe = sfxRecipeNamed(recipeName);
  const sound = preset === LAB_SFX_STANDARD_PRESET ? recipeName : `${recipeName}.${preset}`;

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

  // Every change plays the new sound, once the page has had a click (browsers won't make sound before one); arriving
  // on the tab doesn't.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return undefined;
    }
    if (!navigator.userActivation.hasBeenActive) return undefined;
    const timer = setTimeout(() => playLabSfx(rendered.floats), 180);
    return () => clearTimeout(timer);
  }, [rendered]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'p' || e.repeat || keyIsForAField(e)) return;
      e.preventDefault();
      if (e.shiftKey) setSeed((s) => s + 1);
      else playLabSfx(rendered.floats);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [rendered]);

  const request: SfxRequest = { sound, ...(Object.keys(set).length > 0 && { set }), seed, ...(vary > 0 && { mutate: vary }) };
  return {
    recipeName, recipe, preset, sound, set, seed, vary, rendered, ghost, request,
    play: () => playLabSfx(rendered.floats),
    nextTake: () => setSeed((s) => s + 1),
    chooseRecipe: (name: SfxRecipeName) => { setRecipeName(name); setPreset(LAB_SFX_STANDARD_PRESET); setSet({}); },
    choosePreset: (p: string) => { setPreset(p); setSet({}); },
    setParam: (name: string, v: number) => setSet((s) => ({ ...s, [name]: v })),
    resetParams: () => setSet({}),
    setVary,
  };
}

export type LabSfxTake = ReturnType<typeof useLabSfxTake>;
