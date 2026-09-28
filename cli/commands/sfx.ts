// studio sfx: sound effects from the seeded recipes in lib/sfx/.
import { defineCommand } from 'citty';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

const kit = defineCommand({
  meta: { name: 'kit', description: "Rewrite the kit's sounds (SFX.click, SFX.whoosh, …) into lib/studio/sfx/, seeded so a rerun writes the same files. Prints the files." },
  async run() {
    const { writeSfxKit } = await import('#sfx/sfx-files.ts');
    for (const file of writeSfxKit()) console.log(file);
  },
});

const list = defineCommand({
  meta: { name: 'list', description: 'Print every recipe with its presets and parameters.' },
  async run() {
    const { describeSfxRecipes } = await import('#sfx/sfx-files.ts');
    console.log(describeSfxRecipes());
  },
});

const render = defineCommand({
  meta: {
    name: 'render',
    description: 'Render one sound to a .wav and a .ts beside it for the video to import (its default export goes to <Sfx sound>). Prints both.',
  },
  args: {
    sound: { type: 'positional', required: true, description: 'recipe or recipe.preset, e.g. whoosh.whip' },
    out: { type: 'string', required: true, valueHint: 'work/projects/<p>/sfx/reveal.wav', description: 'The .wav to write, inside the studio' },
    seed: { type: 'string', description: 'The id of the event it marks, so each event gets its own take' },
    set: { type: 'string', valueHint: 'brightness=0.8,decay=1.2', description: 'Parameters over the preset' },
    mutate: { type: 'string', valueHint: '0.2', description: 'How far (0–1) to vary every parameter, from the seed' },
    category: { type: 'string', valueHint: 'accent', description: "Level it as ui or accent instead of its recipe's own category, when its role differs" },
  },
  async run({ args }) {
    const { resolve } = await import('node:path');
    if (args.category !== undefined && args.category !== 'ui' && args.category !== 'accent') throw new Error(`--category is ui or accent, not "${args.category}"`);
    const { writeSfxFile } = await import('#sfx/sfx-files.ts');
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
    description: 'Rerender every sound `studio sfx render` wrote into a folder from the request each module records, after a recipe or the renderer changes. Prints the modules.',
  },
  args: { dir: { type: 'positional', required: true, description: "A folder of rendered sounds, e.g. a project's sfx/" } },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { rerenderSfxFiles } = await import('#sfx/sfx-files.ts');
    const modules = rerenderSfxFiles(resolve(args.dir));
    if (!modules.length) throw new Error(`${args.dir} has no sound modules written by \`studio sfx render\``);
    for (const module of modules) console.log(module);
  },
});

const showcase = defineCommand({
  meta: { name: 'showcase', description: "Render every recipe's presets and a few mutated variants into one folder, with an index.html to listen from. Prints the index." },
  args: { out: { type: 'positional', required: false, default: 'scratch/sfx-showcase', description: 'The folder to write' } },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { writeSfxShowcase } = await import('#sfx/sfx-files.ts');
    console.log(writeSfxShowcase(resolve(args.out)));
  },
});

const draft = defineCommand({
  meta: {
    name: 'draft',
    description: "Measure the video's events (clicks, keys, placed sounds, scene changes, camera moves, reveals) with a full studio check and draft a cue for each into sfx/cues.json, keeping its edits. The video plays it with defineVideo({ sfxCueList: true }); studio mix --sfx-cues auditions it first. Prints the cue list and the file.",
  },
  args: {
    project: studioProjectArg,
    'click-style': { type: 'string', valueHint: 'soft|mechanical|pop|tick', description: "How the video's clicks sound; default the cue list's, or soft" },
  },
  async run({ args }) {
    const { checkProject, writeCheckReports } = await import('#engine/render/render-pipeline.ts');
    const { SFX_CLICK_STYLES } = await import('#sfx/cues.ts');
    const { draftProjectSfxCueList } = await import('#sfx/project-cue-list.ts');
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
  meta: { name: 'sfx', description: 'Sound effects from seeded recipes: whoosh, riser, impact, chime, click and more. See `studio sfx list`.' },
  subCommands: { list, render, rerender, kit, showcase, draft },
});
