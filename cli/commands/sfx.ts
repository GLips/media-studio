// studio sfx: sound effects from the seeded recipes in lib/sfx/.
import { defineCommand } from 'citty';

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

export default defineCommand({
  meta: { name: 'sfx', description: 'Sound effects from seeded recipes: whoosh, riser, impact, chime, click and more. See `studio sfx list`.' },
  subCommands: { list, render, kit, showcase },
});
