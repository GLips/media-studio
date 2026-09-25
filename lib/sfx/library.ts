// library.ts: asking for a sound by name. `chime.soft` is a recipe's preset; overrides set parameters on top of it, and
// mutate nudges them for repeatable variety (sfxr's and ZzFX's scheme). The result is levelled to its category's
// loudness under the voice, not to a peak, so a whoosh and a ding sit alike under the same words. Pure.
import { VOICE_LUFS } from '../studio/mix.ts';
import { addRoom, lerp, SFX_RATE, seededRandom, sfxSeedFromId, subSeed } from './dsp.ts';
import { SFX_RECIPES, SFX_ROOM_PARAM, type SfxCategory, type SfxParamSpec, type SfxRecipe, type SfxRecipeName } from './recipes.ts';
import { measureSfxLufs } from './sfx-loudness.ts';

/**
 * Integrated loudness per category, in LU under the voice (−20 LUFS). A starting convention, not a standard: clicks
 * and keys 15–20 dB under the voice, accents 6–10 under.
 */
export const SFX_LOUDNESS_UNDER_VOICE: Readonly<Record<SfxCategory, number>> = { ui: -17, accent: -8 };

/** The room's reflections against the dry sound, in dB of energy, from `room` 0 (none) to 1. */
const roomWetDb = (room: number) => lerp(-26, -8, room);
/** Normalising never pushes a sample past this; a sound too peaky to reach its loudness comes out quieter instead. */
const SFX_PEAK_CEILING_DB = -1;
/**
 * Silence every rendered sound opens with, counted in its `landsAt`. `<Sfx>` starts a sound on the frame after its
 * exact start and trims the fraction of a frame between them off its front, so the sound lands on its time to the
 * sample; the trim is under a frame, and this is over one at 24 fps, so it only ever takes silence.
 */
export const SFX_PRE_ROLL_SECONDS = 0.05;

export type SfxRequest = {
  /** `recipe` or `recipe.preset`, e.g. `whoosh.whip`. */
  sound: string;
  /** Parameters set on top of the preset; they win over mutate. */
  set?: Readonly<Record<string, number>>;
  /** Seeds the fine detail, and mutate. Use the id of the event the sound marks, so repeats differ. */
  seed?: string | number;
  /** 0–1: how far mutate moves each parameter across its range. */
  mutate?: number;
  /**
   * The loudness it's levelled to, when its role here isn't its recipe's: a pop marking a music-led video's colour flood
   * is an accent, however small the recipe's usual job.
   */
  category?: SfxCategory;
};

export type RenderedSfx = {
  sound: string;
  samples: Int16Array;
  seconds: number;
  /** Seconds into the sound where its event lands; `<Sfx>` lines this up with its `at`. */
  landsAt: number;
  lufs: number;
  params: Readonly<Record<string, number>>;
};

export function sfxRecipeNamed(name: string): SfxRecipe {
  if (!Object.hasOwn(SFX_RECIPES, name)) throw new Error(`no sound recipe "${name}"; there are ${Object.keys(SFX_RECIPES).join(', ')}`);
  return SFX_RECIPES[name as SfxRecipeName] as unknown as SfxRecipe;
}

/** A recipe's own parameters, and the `room` every sound shares. */
export const sfxParamSpecs = (recipe: SfxRecipe): Readonly<Record<string, SfxParamSpec>> => ({ ...recipe.params, room: SFX_ROOM_PARAM });

/**
 * Moves every parameter not marked `fixed` by up to `amount` of its range (on a log scale where the parameter is heard
 * that way), from a stream seeded by `seed`: the same seed and amount always give the same variation.
 */
export function mutateSfxParams(recipe: SfxRecipe, params: Readonly<Record<string, number>>, seed: number, amount: number): Record<string, number> {
  const random = seededRandom(subSeed(seed, 'mutate'));
  return Object.fromEntries(Object.entries(sfxParamSpecs(recipe)).map(([name, { min, max, log, fixed }]) => {
    const offset = (random() * 2 - 1) * amount, value = params[name];
    if (fixed) return [name, value];
    const moved = log ? value * (max / min) ** offset : value + (max - min) * offset;
    return [name, Math.min(max, Math.max(min, moved))];
  }));
}

export function resolveSfxParams({ sound, set = {}, seed = 0, mutate = 0 }: SfxRequest): { recipe: SfxRecipe; params: Record<string, number> } {
  if (!(mutate >= 0 && mutate <= 1)) throw new Error(`mutate must be 0–1, not ${mutate}`);
  const [name, preset, ...rest] = sound.split('.');
  const recipe = sfxRecipeNamed(name);
  if (rest.length || (preset !== undefined && !Object.hasOwn(recipe.presets, preset))) {
    throw new Error(`no preset "${sound}"; ${name} has ${Object.keys(recipe.presets).map((p) => `${name}.${p}`).join(', ')}`);
  }
  for (const [param, value] of Object.entries(set)) {
    const spec = sfxParamSpecs(recipe)[param];
    if (!spec) throw new Error(`${name} has no parameter "${param}"; it has ${Object.keys(sfxParamSpecs(recipe)).join(', ')}`);
    if (!(value >= spec.min && value <= spec.max)) throw new Error(`${name}.${param} must be ${spec.min}–${spec.max}, not ${value}`);
  }
  const base = { ...recipe.defaults, ...(preset ? recipe.presets[preset] : {}) } as Record<string, number>;
  const varied = mutate > 0 ? mutateSfxParams(recipe, base, sfxSeedFromId(seed), mutate) : base;
  return { recipe, params: { ...varied, ...set } };
}

/**
 * Renders a sound at 48 kHz in its room, levelled to its category's loudness, after SFX_PRE_ROLL_SECONDS of silence.
 * The same request always gives the same samples.
 */
export function renderSfx(request: SfxRequest): RenderedSfx {
  const { recipe, params } = resolveSfxParams(request);
  const { samples: dry, landsAt } = recipe.render(params, sfxSeedFromId(request.seed ?? 0));
  const samples = params.room > 0 ? addRoom(dry, roomWetDb(params.room)) : dry;
  const target = VOICE_LUFS + SFX_LOUDNESS_UNDER_VOICE[request.category ?? recipe.category];
  const peakDb = 20 * Math.log10(samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0));
  // Measured twice: the −70 LUFS gate is absolute, so scaling a long tail changes which of its blocks count.
  let gainDb = 0;
  for (let pass = 0; pass < 2; pass++) {
    const lufs = measureSfxLufs(samples.map((v) => v * 10 ** (gainDb / 20)));
    gainDb = Math.min(gainDb + target - lufs, SFX_PEAK_CEILING_DB - peakDb);
  }
  const levelled = samples.map((v) => v * 10 ** (gainDb / 20));
  const preRoll = Math.round(SFX_PRE_ROLL_SECONDS * SFX_RATE);
  const out = new Int16Array(preRoll + levelled.length);
  out.set(Int16Array.from(levelled, (v) => Math.round(v * 32767)), preRoll);
  return {
    sound: request.sound,
    samples: out,
    seconds: out.length / SFX_RATE,
    landsAt: landsAt + preRoll / SFX_RATE,
    lufs: measureSfxLufs(levelled),
    params,
  };
}
