// studio sfx: sound effects from the seeded recipes in lib/timing/sound/models/recipes.ts, or generated with ElevenLabs.
import { defineCommand } from 'citty';
import { refuseOptionsBeforeSubcommand } from '../command-flags.ts';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

const kit = defineCommand({
  meta: {
    name: 'kit',
    description: "Rewrite the studio's own kit sounds (SFX.click, SFX.whoosh, …), seeded so a rerun writes the same files.",
    hidden: true,
  },
  async run() {
    const { writeSfxKit } = await import('#lib/timing/sound/engine/sfx-files.ts');
    for (const file of writeSfxKit()) console.log(file);
  },
});

const list = defineCommand({
  meta: { name: 'list', description: "Print every recipe with its presets and parameters." },
  async run() {
    const { describeSfxRecipes } = await import('#lib/timing/sound/engine/sfx-files.ts');
    console.log(describeSfxRecipes());
  },
});

const render = defineCommand({
  meta: {
    name: 'render',
    description: "Render one sound to a .wav, with a .ts beside it for the video to import.",
    about: "Its default export goes to <Sfx sound>. Prints both files, then the sound's length, where it lands and its loudness.",
  },
  args: {
    sound: { type: 'positional', required: true, description: 'recipe or recipe.preset, e.g. whoosh.whip' },
    out: { type: 'string', required: true, valueHint: 'sfx/reveal.wav', description: 'The .wav to write, inside the studio checkout; a relative path starts at the current directory' },
    seed: { type: 'string', description: 'The id of the event it marks, so each event gets its own take' },
    set: { type: 'string', valueHint: 'brightness=0.8,decay=1.2', description: 'Parameters over the preset' },
    mutate: { type: 'string', valueHint: '0.2', description: 'How far (0–1) to vary every parameter, from the seed' },
    category: { type: 'string', valueHint: 'accent', description: "Level it as ui or accent instead of its recipe's own category, when its role differs" },
  },
  async run({ args }) {
    const { resolve } = await import('node:path');
    if (args.category !== undefined && args.category !== 'ui' && args.category !== 'accent') throw new Error(`--category is ui or accent, not "${args.category}"`);
    const { writeSfxFile } = await import('#lib/timing/sound/engine/sfx-files.ts');
    const set = Object.fromEntries((args.set ?? '').split(',').filter(Boolean).map((pair) => {
      const at = pair.indexOf('='), k = pair.slice(0, at).trim(), v = pair.slice(at + 1).trim();
      if (at < 0 || !k || !v || !Number.isFinite(Number(v))) throw new Error(`--set takes name=number pairs, not "${pair}"`);
      return [k, Number(v)];
    }));
    const { wav, module, rendered } = writeSfxFile({ sound: args.sound, seed: args.seed, set, mutate: args.mutate ? Number(args.mutate) : undefined, category: args.category }, resolve(args.out));
    console.log(`${wav}\n${module}\n${rendered.seconds.toFixed(2)} s, lands at ${rendered.landsAt.toFixed(2)} s, ${rendered.lufs.toFixed(1)} LUFS`);
  },
});

function numberFlag(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(Number(value))) throw new Error(`--${flag} must be a number, not ${value}`);
  return Number(value);
}

const gen = defineCommand({
  meta: {
    name: 'gen',
    description: "Generate a sound no recipe makes (a munch, an egg crack, a yawn) with ElevenLabs, written as `render` writes (paid).",
    about: "Each take is levelled as a recipe of its --category and lands on its first attack. There's no seed: a take is generated once and cached by its request and number (in the workspace's generated/, wherever it's written), so asking again costs nothing and --takes 4 after --takes 2 pays for two. Outside the studio, --out gets a plain clip: no module, no lead-in silence. Needs ELEVENLABS_API_KEY and ELEVENLABS_PLAN (the key's plan, recorded on every take: the free plan is non-commercial and needs attribution). Prints each take's .wav, its .ts, then its length, where it lands and its loudness.",
  },
  args: {
    prompt: { type: 'positional', required: true, description: 'The sound: what makes it, the material, the space, e.g. "a crisp apple munch, close"' },
    out: { type: 'string', required: true, valueHint: 'sfx/munch.wav', description: 'The .wav to write; with --takes, munch-1.wav, munch-2.wav… A relative path starts at the current directory' },
    duration: { type: 'string', valueHint: '1.5', description: 'Seconds, 0.5–30; default ElevenLabs guesses from the prompt' },
    influence: { type: 'string', valueHint: '0.3', description: 'How closely to follow the prompt, 0–1 (ElevenLabs default 0.3): higher varies less' },
    takes: { type: 'string', default: '1', description: 'How many takes to generate, each paid for once' },
    model: { type: 'string', default: 'eleven_text_to_sound_v2', description: 'eleven_text_to_sound_v2 or eleven_text_to_sound_v3' },
    category: { type: 'string', default: 'accent', description: 'Level it as ui (a click or tick, 17 LU under the voice) or accent (8 under)' },
    decide: { type: 'boolean', description: "With --takes 2 or more in a project: post the takes as a `studio review` decision, sfx-<name>, so the reviewer picks by ear" },
  },
  async run({ args }) {
    const { basename, resolve } = await import('node:path');
    if (args.category !== 'ui' && args.category !== 'accent') throw new Error(`--category is ui or accent, not "${args.category}"`);
    const takes = numberFlag('takes', args.takes)!, out = resolve(args.out);
    if (args.decide && takes < 2) throw new Error('--decide needs --takes 2 or more to choose between');
    const { generateSfxFiles } = await import('#lib/timing/sound/engine/sfx-files.ts');
    const { studioProjectOfFile } = await import('#lib/platform/project/engine/studio-project.ts');
    const project = args.decide ? studioProjectOfFile(out) : null;
    if (args.decide && !project) throw new Error(`--decide posts to a project's review, and ${args.out} isn't in one`);
    const settled = await generateSfxFiles({
      prompt: args.prompt, out, takes, model: args.model, category: args.category,
      durationSeconds: numberFlag('duration', args.duration), influence: numberFlag('influence', args.influence),
    });
    const made = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    for (const take of made) {
      if (take.plan === 'free') console.error(`${take.wav} was made on ElevenLabs' free plan: non-commercial use only, crediting ElevenLabs`);
      console.log([take.wav, take.module, `${take.seconds.toFixed(2)} s, lands at ${take.landsAt.toFixed(2)} s, ${take.lufs.toFixed(1)} LUFS`].filter(Boolean).join('\n'));
    }
    // Printed first, so takes already paid for are named before a refused one fails the run.
    const refused = settled.find((s) => s.status === 'rejected');
    if (refused) throw refused.reason;
    if (!project) return;
    const { applyReviewOps } = await import('#lib/output/review/engine/review-file.ts');
    const { reviewCandidateOf } = await import('#lib/output/review/engine/review-handoff.ts');
    const topic = `sfx-${basename(out, '.wav')}`;
    const candidates = made.map((take, i) => reviewCandidateOf(basename(project), String.fromCharCode(97 + i), { path: take.wav, label: `take ${take.take}`, meta: { model: args.model, plan: take.plan } }));
    const applied = applyReviewOps(project, [{ op: 'decision.put', decision: { topic, question: `Which take of "${args.prompt}"?`, choose: 'one', candidates } }], 'agent');
    if ('conflict' in applied) throw new Error('posting a decision never conflicts');
    console.log(`posted #${applied.changed[0]} ${topic}: ${candidates.map((c) => `${c.key} ${c.label}`).join(', ')}`);
  },
});

const rerender = defineCommand({
  meta: {
    name: 'rerender',
    description: "Rerender every sound `studio sfx render` or `gen` wrote into a folder, after a recipe or the levelling changes.",
    about: "Each module records its request, which is rendered again; a generated sound is levelled again from its cached take, and never paid for: one no longer cached fails, naming it. Prints the modules.",
  },
  args: { dir: { type: 'positional', required: true, description: "A folder of rendered sounds, e.g. a project's sfx/" } },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { rerenderSfxFiles } = await import('#lib/timing/sound/engine/sfx-files.ts');
    const modules = await rerenderSfxFiles(resolve(args.dir));
    if (!modules.length) throw new Error(`${args.dir} has no sound modules written by \`studio sfx render\` or \`gen\``);
    for (const module of modules) console.log(module);
  },
});

const showcase = defineCommand({
  meta: {
    name: 'showcase',
    description: "Render every recipe's presets and a few variants into a folder, with an index.html to listen from.",
    about: "Prints the index.",
  },
  args: { out: { type: 'positional', required: false, default: 'scratch/sfx-showcase', description: 'The folder to write' } },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { writeSfxShowcase } = await import('#lib/timing/sound/engine/sfx-files.ts');
    console.log(writeSfxShowcase(resolve(args.out)));
  },
});

const draft = defineCommand({
  meta: {
    name: 'draft',
    description: "Draft a cue for each of the video's events into sfx/cues.json, keeping its edits.",
    about: "Measures the events (clicks, keys, placed sounds, scene changes, camera moves, reveals) with a full studio check. The video plays the cue list with defineVideo({ sfxCueList: true }); `studio mix --sfx-cues` auditions it first. Prints the cue list and the file.",
  },
  args: {
    project: studioProjectArg,
    'click-style': { type: 'string', valueHint: 'soft|mechanical|pop|tick', description: "How the video's clicks sound; default the cue list's, or soft" },
  },
  async run({ args }) {
    const { checkProject, writeCheckReports } = await import('#lib/output/render/engine/render-pipeline.ts');
    const { SFX_CLICK_STYLES } = await import('#lib/output/sfx-cues/models/cues.ts');
    const { draftProjectSfxCueList } = await import('#lib/output/sfx-cues/engine/project-cue-list.ts');
    const style = args['click-style'];
    if (style !== undefined && !Object.hasOwn(SFX_CLICK_STYLES, style)) throw new Error(`--click-style is one of ${Object.keys(SFX_CLICK_STYLES).join(', ')}, not ${style}`);
    const session = await openStudioRenderSession(args.project);
    const check = await checkProject(session);
    writeCheckReports(session, check);
    const lines = draftProjectSfxCueList(session.project, { timeline: check.timeline, events: check.sfxEvents, clickStyle: style as keyof typeof SFX_CLICK_STYLES | undefined });
    for (const line of lines) console.log(line);
  },
});

export default defineCommand({
  meta: {
    name: 'sfx',
    description: "Render seeded sound effects, generate ones no recipe makes, and draft a video's cue list from its events.",
    about: "Recipes include whoosh, riser, impact, chime and click; `studio sfx list` prints them all. `gen` asks ElevenLabs for anything else.",
  },
  setup: refuseOptionsBeforeSubcommand,
  subCommands: { list, render, gen, rerender, kit, showcase, draft },
});
