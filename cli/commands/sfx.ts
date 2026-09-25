// studio sfx: sound effects from the seeded recipes in lib/sfx/.
import { defineCommand } from 'citty';
import { openStudioRenderSession, studioProjectArg } from '../project-arg.ts';

const kit = defineCommand({
  meta: { name: 'kit', description: "Rewrite the kit's sounds (SFX.click, SFX.whoosh, …) into lib/studio/sfx/, seeded so a rerun writes the same files. Prints the files." },
  async run() {
    const { writeSfxKit } = await import('../../lib/sfx/sfx-files.ts');
    for (const file of writeSfxKit()) console.log(file);
  },
});

const list = defineCommand({
  meta: { name: 'list', description: 'Print every recipe with its presets and parameters.' },
  async run() {
    const { describeSfxRecipes } = await import('../../lib/sfx/sfx-files.ts');
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
    out: { type: 'string', required: true, valueHint: 'projects/<p>/sfx/reveal.wav', description: 'The .wav to write' },
    seed: { type: 'string', description: 'The id of the event it marks, so each event gets its own take' },
    set: { type: 'string', valueHint: 'brightness=0.8,decay=1.2', description: 'Parameters over the preset' },
    mutate: { type: 'string', valueHint: '0.2', description: 'How far (0–1) to vary every parameter, from the seed' },
  },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { writeSfxFile } = await import('../../lib/sfx/sfx-files.ts');
    const set = Object.fromEntries((args.set ?? '').split(',').filter(Boolean).map((pair) => {
      const at = pair.indexOf('='), k = pair.slice(0, at).trim(), v = pair.slice(at + 1).trim();
      if (at < 0 || !k || !v || !Number.isFinite(Number(v))) throw new Error(`--set takes name=number pairs, not "${pair}"`);
      return [k, Number(v)];
    }));
    const { wav, module, rendered } = writeSfxFile({ sound: args.sound, seed: args.seed, set, mutate: args.mutate ? Number(args.mutate) : undefined }, resolve(args.out));
    console.log(`${wav}\n${module}\n${rendered.seconds.toFixed(2)} s, lands at ${rendered.landsAt.toFixed(2)} s, ${rendered.lufs.toFixed(1)} LUFS`);
  },
});

const showcase = defineCommand({
  meta: { name: 'showcase', description: "Render every recipe's presets and a few mutated variants into one folder, with an index.html to listen from. Prints the index." },
  args: { out: { type: 'positional', required: false, default: 'scratch/sfx-showcase', description: 'The folder to write' } },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { writeSfxShowcase } = await import('../../lib/sfx/sfx-files.ts');
    console.log(writeSfxShowcase(resolve(args.out)));
  },
});

const draft = defineCommand({
  meta: {
    name: 'draft',
    description: "Measure the video's events (clicks, keys, placed sounds, scene changes, camera moves, reveals) with a full studio check, draft a cue for each into sfx/cues.json, and render the sounding ones into sfx/cues.ts, which the video plays with defineVideo({ sfx }). Edits in an existing cues.json are kept for events that still exist. Prints the cue list and the files.",
  },
  args: {
    project: studioProjectArg,
    'click-style': { type: 'string', valueHint: 'soft|mechanical|pop|tick', description: "How the video's clicks sound; default the cue list's, or soft" },
  },
  async run({ args }) {
    const { checkProject, writeCheckReports } = await import('../../lib/render-pipeline.ts');
    const { draftSfxCues, sfxCueOverrides, sfxCuePlays, SFX_CLICK_STYLES } = await import('../../lib/sfx/cues.ts');
    const { formatSfxCueList, readSfxCueList, renderSfxCueList, writeSfxCueList } = await import('../../lib/sfx/cue-files.ts');
    const style = args['click-style'];
    if (style !== undefined && !Object.hasOwn(SFX_CLICK_STYLES, style)) throw new Error(`--click-style is one of ${Object.keys(SFX_CLICK_STYLES).join(', ')}, not ${style}`);
    const session = await openStudioRenderSession(args.project);
    const check = await checkProject(session);
    writeCheckReports(session, check);
    const previous = readSfxCueList(session.project);
    const words = check.timeline.cues.flatMap((c) => c.words);
    const { list, dropped } = draftSfxCues(check.sfxEvents, words, { clickStyle: (style ?? previous?.clickStyle ?? 'soft') as keyof typeof SFX_CLICK_STYLES, previous });
    for (const line of formatSfxCueList(list)) console.log(line);
    for (const id of dropped) console.log(`dropped the edits to ${id}: the video no longer has its event`);
    for (const o of sfxCueOverrides(sfxCuePlays(list), words)) console.log(`! ${o.at.toFixed(2)}s  ${o.id}: ${o.problem}`);
    console.log(writeSfxCueList(session.project, list));
    console.log(renderSfxCueList(session.project, list));
  },
});

const cues = defineCommand({
  meta: {
    name: 'cues',
    description: 'Render sfx/cues.json, after editing it, into sfx/cues.ts, and say which edits override a rule (against the words in out/check/timeline.json). Prints the module.',
  },
  args: { project: studioProjectArg },
  async run({ args }) {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { resolveStudioProjectWith } = await import('../../lib/studio-project.ts');
    const { sfxCueOverrides, sfxCuePlays } = await import('../../lib/sfx/cues.ts');
    const { readSfxCueList, renderSfxCueList } = await import('../../lib/sfx/cue-files.ts');
    const project = resolveStudioProjectWith(args.project, 'video.tsx');
    const list = readSfxCueList(project);
    if (!list) throw new Error(`${project} has no sfx/cues.json: run studio sfx draft first`);
    const timeline = JSON.parse(readFileSync(join(project, 'out/check/timeline.json'), 'utf8')) as import('../../lib/studio/Video.tsx').TimelineReport;
    for (const o of sfxCueOverrides(sfxCuePlays(list), timeline.cues.flatMap((c) => c.words))) console.log(`! ${o.at.toFixed(2)}s  ${o.id}: ${o.problem}`);
    console.log(renderSfxCueList(project, list));
  },
});

export default defineCommand({
  meta: { name: 'sfx', description: 'Sound effects from seeded recipes: whoosh, riser, impact, chime, click and more. See `studio sfx list`.' },
  subCommands: { list, render, kit, showcase, draft, cues },
});
