// sfx-files.ts: sounds out to WAV files: the kit in lib/timing/sound/studio/, one recipe's sound or ElevenLabs' takes
// of a prompt for a project, and a showcase folder to listen through. `studio sfx` runs these. Node only.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { decodeAudioChannels } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { generatePaidMedia } from '#lib/platform/paid-generation/engine/paid-generation.ts';
import { STUDIO_ROOT, STUDIO_WORKSPACE_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { wavFromSamples } from '#lib/platform/wav/models/wav.ts';
import { detectAudioAttacks } from '../models/audio-attacks.ts';
import { SFX_RATE } from '../models/dsp.ts';
import {
  isSfxGenerated, levelSfxSamples, renderSfx, sfxParamSpecs, SFX_LOUDNESS_UNDER_VOICE, SFX_PRE_ROLL_SECONDS,
  type RenderedSfx, type SfxGeneratedRequest, type SfxRequest, type SfxSoundRequest,
} from '../models/library.ts';
import { SFX_RECIPES, type SfxCategory, type SfxRecipe } from '../models/recipes.ts';

/**
 * The kit's sounds, as `SFX.<name>` in lib/timing/sound/studio/kit.ts. Sounds that repeat within a scene get several seeded
 * takes, and `<Sfx id>` picks one per event, so a run of clicks doesn't sound machine-made.
 */
const SFX_KIT: Readonly<Record<string, { sound: string; takes?: number }>> = {
  click: { sound: 'click', takes: 4 },
  key: { sound: 'key', takes: 6 },
  toggleOn: { sound: 'toggle.on', takes: 2 },
  toggleOff: { sound: 'toggle.off', takes: 2 },
  pop: { sound: 'pop', takes: 3 },
  whoosh: { sound: 'whoosh' },
  whip: { sound: 'whoosh.whip' },
  riser: { sound: 'riser' },
  impact: { sound: 'impact' },
  chime: { sound: 'chime' },
  success: { sound: 'chime.success' },
  ding: { sound: 'ding' },
};

const round = (x: number) => Math.round(x * 1e4) / 1e4;

/** Rewrites lib/timing/sound/studio/: every kit sound's takes, and kit.ts to import them. Returns the files written. */
export function writeSfxKit(): string[] {
  const dir = join(STUDIO_ROOT, 'lib/timing/sound/studio');
  mkdirSync(dir, { recursive: true });
  for (const file of readdirSync(dir)) if (file.endsWith('.wav')) rmSync(join(dir, file));
  const written: string[] = [], imports: string[] = [], entries: string[] = [];
  for (const [name, { sound, takes = 1 }] of Object.entries(SFX_KIT)) {
    const sounds = Array.from({ length: takes }, (_, i) => {
      const file = `${name}-${i + 1}.wav`, id = `${name}${i + 1}`;
      const request = { sound, seed: `kit:${name}:${i + 1}` };
      const rendered = renderSfx(request);
      writeFileSync(join(dir, file), wavFromSamples(rendered.samples, SFX_RATE));
      written.push(join(dir, file));
      imports.push(`import ${id} from './${file}';`);
      return `{ src: ${id}, seconds: ${round(rendered.seconds)}, landsAt: ${round(rendered.landsAt)}, request: ${JSON.stringify(request)} }`;
    });
    entries.push(`  /** ${sound} */\n  ${name}: [${sounds.join(', ')}],`);
  }
  const kit = join(dir, 'kit.ts');
  writeFileSync(kit, [
    '// kit.ts: written by `studio sfx kit` from lib/timing/sound/engine/sfx-files.ts. Change the kit there and rerun, rather than editing this.',
    "import type { SfxSound } from './sfx.tsx';",
    ...imports,
    '',
    'export const SFX = {',
    ...entries,
    '} as const satisfies Record<string, readonly SfxSound[]>;',
    '',
  ].join('\n'));
  return [...written, kit];
}

const describeRequest = ({ sound, seed, mutate, set, category }: SfxRequest, out: string) =>
  [`studio sfx render ${sound}`, `--out ${relative(STUDIO_ROOT, out)}`, seed !== undefined && `--seed ${JSON.stringify(String(seed))}`, mutate && `--mutate ${mutate}`,
    set && Object.keys(set).length && `--set ${Object.entries(set).map(([k, v]) => `${k}=${v}`).join(',')}`,
    category && `--category ${category}`].filter(Boolean).join(' ');

/**
 * Writes `out` (a .wav) and a module beside it with the same name (.ts) that a video imports: its default export is
 * the `SfxSound` `<Sfx>` takes, so the timing it lands on stays in step when the sound is rerendered.
 */
export function writeSfxFile(request: SfxRequest, out: string): { wav: string; module: string; rendered: RenderedSfx } {
  if (!out.endsWith('.wav')) throw new Error(`--out must be a .wav file, not ${out}`);
  // Its module imports `#studio`, which resolves only under the studio's package.json.
  if (!isInStudio(out)) throw new Error(`--out must be inside the studio (${STUDIO_ROOT}), not ${out}`);
  const rendered = renderSfx(request);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, wavFromSamples(rendered.samples, SFX_RATE));
  const module = writeSfxModule(out, `Written by \`${describeRequest(request, out)}\`. Rerun that to change it.`, { ...rendered, request });
  return { wav: out, module, rendered };
}

const isInStudio = (file: string) => !relative(STUDIO_ROOT, file).startsWith('..');

/** Writes the module beside `wav` that a video imports, and returns its path. Its first line is `comment`. */
function writeSfxModule(wav: string, comment: string, { seconds, landsAt, request }: { seconds: number; landsAt: number; request: SfxSoundRequest }): string {
  const module = wav.replace(/\.wav$/, '.ts');
  // `satisfies` checks the sound where it's written and keeps its `category` a literal: widened to a string, it
  // wouldn't pass as an SfxSound.
  writeFileSync(module, [
    `// ${comment}`,
    "import type { SfxSound } from '#lib/timing/sound/studio/sfx.tsx';",
    `import src from './${basename(wav)}';`,
    '',
    `export default { src, seconds: ${round(seconds)}, landsAt: ${round(landsAt)}, request: ${JSON.stringify(request)} } satisfies SfxSound;`,
    '',
  ].join('\n'));
  return module;
}

/** ElevenLabs' sound-effects models, its own default first. */
export const ELEVENLABS_SFX_MODELS = ['eleven_text_to_sound_v2', 'eleven_text_to_sound_v3'] as const;
/** What ElevenLabs makes, in seconds. */
export const ELEVENLABS_SFX_SECONDS = { min: 0.5, max: 30 } as const;

/** What `studio sfx gen` asks for: `takes` generations of one prompt, written to `out` (or `<out>-1.wav`, `-2`… for several). */
export type SfxGenerationAsk = {
  prompt: string;
  out: string;
  takes: number;
  model: string;
  category: SfxCategory;
  /** Left out, ElevenLabs guesses the length from the prompt. */
  durationSeconds?: number;
  /** ElevenLabs' prompt_influence, 0–1 (its default 0.3): higher follows the prompt closer and varies less. */
  influence?: number;
};

export type GeneratedSfxTake = { take: number; wav: string; module: string | null; seconds: number; landsAt: number; lufs: number; plan: string };

/**
 * Generates each take with ElevenLabs (paid once, cached by its request and number), levels it as a recipe of
 * `category` and writes it, with its module inside the studio, else as a plain clip with no pre-roll. Every take
 * settles, so those paid for are written beside any refused.
 */
export async function generateSfxFiles(ask: SfxGenerationAsk): Promise<PromiseSettledResult<GeneratedSfxTake>[]> {
  if (!ask.out.endsWith('.wav')) throw new Error(`--out must be a .wav file, not ${ask.out}`);
  if (!(Number.isInteger(ask.takes) && ask.takes >= 1)) throw new Error(`--takes must be a whole number, 1 or more, not ${ask.takes}`);
  if (!ELEVENLABS_SFX_MODELS.some((m) => m === ask.model)) throw new Error(`--model is one of ${ELEVENLABS_SFX_MODELS.join(', ')}, not ${ask.model}`);
  const { min, max } = ELEVENLABS_SFX_SECONDS;
  if (ask.durationSeconds !== undefined && !(ask.durationSeconds >= min && ask.durationSeconds <= max)) {
    throw new Error(`--duration must be ${min}–${max} seconds, not ${ask.durationSeconds}: ElevenLabs makes nothing shorter or longer`);
  }
  if (ask.influence !== undefined && !(ask.influence >= 0 && ask.influence <= 1)) throw new Error(`--influence must be 0–1, not ${ask.influence}`);
  mkdirSync(dirname(ask.out), { recursive: true });
  const takes = Array.from({ length: ask.takes }, (_, i) => i + 1);
  return Promise.allSettled(takes.map(async (take): Promise<GeneratedSfxTake> => {
    const generated = {
      prompt: ask.prompt, model: ask.model, take,
      ...(ask.durationSeconds !== undefined && { durationSeconds: ask.durationSeconds }), ...(ask.influence !== undefined && { influence: ask.influence }),
    };
    const out = ask.takes > 1 ? ask.out.replace(/\.wav$/, `-${take}.wav`) : ask.out;
    const { file, plan } = await generatedSfxTake(generated, out, { pay: true });
    return writeGeneratedSfxFile({ generated: { ...generated, plan }, category: ask.category }, file, out);
  }));
}

/**
 * A generated take's raw file and the plan it was made on, from the cache or, with `pay`, from ElevenLabs. One cache
 * for every take, wherever it's written, so moving a sound never pays for it again.
 */
async function generatedSfxTake(generated: Omit<SfxGeneratedRequest['generated'], 'plan'>, out: string, { pay }: { pay: boolean }) {
  const { files: [file], provenance } = await generatePaidMedia(STUDIO_WORKSPACE_DIR, {
    kind: 'sound-effect', model: generated.model, name: `sfx-${basename(out, '.wav')}`, prompt: generated.prompt, take: generated.take,
    params: { ...(generated.durationSeconds !== undefined && { duration_seconds: generated.durationSeconds }), ...(generated.influence !== undefined && { prompt_influence: generated.influence }) },
    beforePaying: async () => {
      if (!pay) throw new Error(`${out}: its take is no longer in ${join(STUDIO_WORKSPACE_DIR, 'generated')}; \`studio sfx gen\` with the same request pays for it again`);
    },
  });
  // SAFETY: a sound effect's provenance always records its plan: generateElevenLabsSoundEffect refuses without one.
  return { file, plan: provenance.plan! };
}

/**
 * Levels a generated take as a recipe of its category, from its first audible sample (within 50 dB of its peak), and
 * writes it to `out`. It lands on its first attack, or its start where it swells in without one.
 */
function writeGeneratedSfxFile(request: SfxGeneratedRequest, raw: string, out: string): GeneratedSfxTake {
  const inStudio = isInStudio(out);
  const [decoded] = decodeAudioChannels(raw, 1, SFX_RATE);
  const floor = decoded.reduce((m, v) => Math.max(m, Math.abs(v)), 0) * 10 ** (-50 / 20);
  const audible = decoded.subarray(Math.max(0, decoded.findIndex((v) => Math.abs(v) >= floor)));
  const attack = detectAudioAttacks(audible, SFX_RATE, 10)[0]?.t ?? 0;
  const { samples, lufs } = levelSfxSamples(Float64Array.from(audible), request.category, { preRoll: inStudio });
  writeFileSync(out, wavFromSamples(samples, SFX_RATE));
  const seconds = samples.length / SFX_RATE, landsAt = attack + (inStudio ? SFX_PRE_ROLL_SECONDS : 0);
  const { prompt, model, take, plan } = request.generated;
  const module = inStudio
    ? writeSfxModule(out, `Written by \`studio sfx gen\`: take ${take} of ${JSON.stringify(prompt)} (${model}, ElevenLabs ${plan} plan). \`studio sfx rerender\` relevels it.`, { seconds, landsAt, request })
    : null;
  return { take, wav: out, module, seconds, landsAt, lufs, plan };
}

/**
 * Rerenders every sound module `studio sfx render` or `gen` wrote into `dir` from the request its last line records,
 * so a change to a recipe, to rendering or to levelling reaches the sounds a video already places. A generated
 * sound is levelled again from its cached take, never paid for. Returns the modules rewritten.
 */
export async function rerenderSfxFiles(dir: string): Promise<string[]> {
  const written = await Promise.all(readdirSync(dir).filter((f) => f.endsWith('.ts')).toSorted().map(async (file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    const json = text.match(/request: (\{.*\}) \} satisfies SfxSound;$/m)?.[1];
    if (!/^\/\/ Written by `studio sfx (render|gen)/.test(text) || !json) return null;
    // SAFETY: the line was written by writeSfxModule from a request of this shape.
    const request = JSON.parse(json) as SfxSoundRequest, wav = join(dir, file.replace(/\.ts$/, '.wav'));
    if (!isSfxGenerated(request)) return writeSfxFile(request, wav).module;
    const { file: raw } = await generatedSfxTake(request.generated, wav, { pay: false });
    return writeGeneratedSfxFile(request, raw, wav).module;
  }));
  return written.filter((module) => module !== null);
}

/** Every recipe's parameters and presets, for `studio sfx list`. */
export function describeSfxRecipes(): string {
  return Object.entries(SFX_RECIPES).map(([name, recipe]) => [
    `${name} (${recipe.category}, ${SFX_LOUDNESS_UNDER_VOICE[recipe.category]} LU under the voice): ${recipe.doc}`,
    `  presets: ${[name, ...Object.keys(recipe.presets).map((p) => `${name}.${p}`)].join(', ')}`,
    ...Object.entries(sfxParamSpecs(recipe as unknown as SfxRecipe)).map(([param, { min, max, doc }]) =>
      `  ${param} ${min}–${max} (default ${round((recipe.defaults as Record<string, number>)[param])}): ${doc}`),
  ].join('\n')).join('\n\n');
}

const SHOWCASE_MUTATIONS = [{ seed: 'variant-a', mutate: 0.3 }, { seed: 'variant-b', mutate: 0.3 }];

/**
 * Renders every recipe's presets, plus a couple of mutated variants of each, into `dir`, with an index.html to play
 * them from. Returns the index.
 */
export function writeSfxShowcase(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const sections = Object.entries(SFX_RECIPES).map(([name, recipe]) => {
    const requests: SfxRequest[] = [
      { sound: name },
      ...Object.keys(recipe.presets).map((p) => ({ sound: `${name}.${p}` })),
      ...SHOWCASE_MUTATIONS.map((m) => ({ sound: name, ...m })),
    ];
    const rows = requests.map((request) => {
      const file = `${request.sound}${request.mutate ? `~${request.seed}` : ''}.wav`;
      const rendered = renderSfx({ seed: 'showcase', ...request });
      writeFileSync(join(dir, file), wavFromSamples(rendered.samples, SFX_RATE));
      const params = Object.entries(rendered.params).map(([k, v]) => `${k} ${round(v)}`).join(', ');
      return `<tr><td><code>${file}</code></td><td><audio controls preload="none" src="${file}"></audio></td>`
        + `<td>${rendered.seconds.toFixed(2)} s, lands at ${rendered.landsAt.toFixed(2)} s, ${rendered.lufs.toFixed(1)} LUFS</td><td><small>${params}</small></td></tr>`;
    });
    return `<h2>${name} <small>(${recipe.category})</small></h2><p>${recipe.doc}</p><table>${rows.join('\n')}</table>`;
  });
  const index = join(dir, 'index.html');
  writeFileSync(index, `<!doctype html><meta charset="utf-8"><title>studio sfx showcase</title>
<style>body{font:14px system-ui;margin:2em;max-width:80em}td{padding:2px 10px;vertical-align:middle}small{color:#666}</style>
<h1>studio sfx showcase</h1>
<p>Every recipe's presets, then two mutated variants of its defaults (<code>~variant-a</code>, <code>~variant-b</code>, mutate 0.3).
Levels are as they'd sit in a video: ui sounds 17 LU under the voice, accents 8, so turn up to listen.</p>
${sections.join('\n')}\n`);
  return index;
}
