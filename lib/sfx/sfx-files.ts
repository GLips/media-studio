// sfx-files.ts: sound recipes out to WAV files: the kit in lib/studio/sfx/, one sound for a project, and a showcase
// folder to listen through. `studio sfx` runs these. Node only.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { STUDIO_ROOT } from '../studio-project.ts';
import { wavFromSamples } from '../wav.ts';
import { SFX_RATE } from './dsp.ts';
import { renderSfx, SFX_LOUDNESS_UNDER_VOICE, type RenderedSfx, type SfxRequest } from './library.ts';
import { SFX_RECIPES } from './recipes.ts';

/**
 * The kit's sounds, as `SFX.<name>` in lib/studio/sfx/kit.ts. Sounds that repeat within a scene get several seeded
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

/** Rewrites lib/studio/sfx/: every kit sound's takes, and kit.ts to import them. Returns the files written. */
export function writeSfxKit(): string[] {
  const dir = join(STUDIO_ROOT, 'lib/studio/sfx');
  mkdirSync(dir, { recursive: true });
  for (const file of readdirSync(dir)) if (file.endsWith('.wav')) rmSync(join(dir, file));
  const written: string[] = [], imports: string[] = [], entries: string[] = [];
  for (const [name, { sound, takes = 1 }] of Object.entries(SFX_KIT)) {
    const sounds = Array.from({ length: takes }, (_, i) => {
      const file = `${name}-${i + 1}.wav`, id = `${name}${i + 1}`;
      const rendered = renderSfx({ sound, seed: `kit:${name}:${i + 1}` });
      writeFileSync(join(dir, file), wavFromSamples(rendered.samples, SFX_RATE));
      written.push(join(dir, file));
      imports.push(`import ${id} from './${file}';`);
      return `{ src: ${id}, seconds: ${round(rendered.seconds)}, landsAt: ${round(rendered.landsAt)} }`;
    });
    entries.push(`  /** ${sound} */\n  ${name}: [${sounds.join(', ')}],`);
  }
  const kit = join(dir, 'kit.ts');
  writeFileSync(kit, [
    '// kit.ts: written by `studio sfx kit` from lib/sfx/sfx-files.ts. Change the kit there and rerun, rather than editing this.',
    "import type { SfxSound } from '../sfx.tsx';",
    ...imports,
    '',
    'export const SFX = {',
    ...entries,
    '} as const satisfies Record<string, readonly SfxSound[]>;',
    '',
  ].join('\n'));
  return [...written, kit];
}

const describeRequest = ({ sound, seed, mutate, set }: SfxRequest, out: string) =>
  [`studio sfx render ${sound}`, `--out ${relative(STUDIO_ROOT, out)}`, seed !== undefined && `--seed ${JSON.stringify(String(seed))}`, mutate && `--mutate ${mutate}`,
    set && Object.keys(set).length && `--set ${Object.entries(set).map(([k, v]) => `${k}=${v}`).join(',')}`].filter(Boolean).join(' ');

/**
 * Writes `out` (a .wav) and a module beside it with the same name (.ts) that a video imports: its default export is
 * the `SfxSound` `<Sfx>` takes, so the timing it lands on stays in step when the sound is rerendered.
 */
export function writeSfxFile(request: SfxRequest, out: string): { wav: string; module: string; rendered: RenderedSfx } {
  if (!out.endsWith('.wav')) throw new Error(`--out must be a .wav file, not ${out}`);
  const rendered = renderSfx(request);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, wavFromSamples(rendered.samples, SFX_RATE));
  const module = out.replace(/\.wav$/, '.ts');
  writeFileSync(module, [
    `// Written by \`${describeRequest(request, out)}\`. Rerun that to change it.`,
    `import src from './${basename(out)}';`,
    '',
    `export default { src, seconds: ${round(rendered.seconds)}, landsAt: ${round(rendered.landsAt)} };`,
    '',
  ].join('\n'));
  return { wav: out, module, rendered };
}

/** Every recipe's parameters and presets, for `studio sfx list`. */
export function describeSfxRecipes(): string {
  return Object.entries(SFX_RECIPES).map(([name, recipe]) => [
    `${name} (${recipe.category}, ${SFX_LOUDNESS_UNDER_VOICE[recipe.category]} LU under the voice): ${recipe.doc}`,
    `  presets: ${[name, ...Object.keys(recipe.presets).map((p) => `${name}.${p}`)].join(', ')}`,
    ...Object.entries(recipe.params).map(([param, { min, max, doc }]) =>
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
Levels are as they'd sit in a video: ui sounds 17 LU under the voice, accents 8, the bed 18, so turn up to listen.</p>
${sections.join('\n')}\n`);
  return index;
}
