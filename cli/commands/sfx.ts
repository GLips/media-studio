// studio sfx: sound effects from the seeded recipes in lib/timing/sound/models/recipes.ts.
import { defineCommand } from 'citty';
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

const rerender = defineCommand({
  meta: {
    name: 'rerender',
    description: "Rerender every sound `studio sfx render` wrote into a folder, after a recipe or the renderer changes.",
    about: "Each module records its request, which is rendered again. Prints the modules.",
  },
  args: { dir: { type: 'positional', required: true, description: "A folder of rendered sounds, e.g. a project's sfx/" } },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { rerenderSfxFiles } = await import('#lib/timing/sound/engine/sfx-files.ts');
    const modules = rerenderSfxFiles(resolve(args.dir));
    if (!modules.length) throw new Error(`${args.dir} has no sound modules written by \`studio sfx render\``);
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
    description: "Render seeded sound effects, and draft a video's cue list from its events.",
    about: "Recipes include whoosh, riser, impact, chime and click; `studio sfx list` prints them all.",
  },
  subCommands: { list, render, rerender, kit, showcase, draft },
});
