// cue-files.ts: a project's cue list on disk. sfx/cues.json is the list an agent edits (lib/sfx/cues.ts); sfx/cues/
// holds each sounding cue's rendered WAV, and sfx/cues.ts imports them for `defineVideo({ sfx })`. Node only.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { STUDIO_ROOT } from '../studio-project.ts';
import { wavFromSamples } from '../wav.ts';
import { sfxCueListFor, sfxCueModuleFor, sfxCueSoundsDirFor } from './cue-draft-module.ts';
import { SFX_CUE_LIST_VERSION, sfxCuePlays, sfxCueSound, type SfxCueList } from './cues.ts';
import { SFX_RATE } from './dsp.ts';
import { renderSfx } from './library.ts';

export function readSfxCueList(project: string): SfxCueList | null {
  const path = sfxCueListFor(project);
  if (!existsSync(path)) return null;
  const list = JSON.parse(readFileSync(path, 'utf8')) as SfxCueList;
  if (list.version !== SFX_CUE_LIST_VERSION) throw new Error(`${path} is version ${list.version}; redraft it with studio sfx draft`);
  return list;
}

export function writeSfxCueList(project: string, list: SfxCueList): string {
  const path = sfxCueListFor(project);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`);
  return path;
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * Renders every sounding cue into sfx/cues/ (seeded, so a rerun writes the same files) and rewrites sfx/cues.ts to
 * import them. Returns the module.
 */
export function renderSfxCueList(project: string, list: SfxCueList): string {
  const dir = sfxCueSoundsDirFor(project), module = sfxCueModuleFor(project);
  mkdirSync(dir, { recursive: true });
  for (const file of readdirSync(dir)) if (file.endsWith('.wav')) rmSync(join(dir, file));
  const used = new Set<string>(), imports: string[] = [], entries: string[] = [];
  sfxCuePlays(list).forEach((play, i) => {
    let file = `${play.id.replace(/[^a-zA-Z0-9-]+/g, '-')}.wav`;
    if (used.has(file)) file = file.replace(/\.wav$/, `-${i}.wav`);
    used.add(file);
    const rendered = renderSfx(play.sound);
    writeFileSync(join(dir, file), wavFromSamples(rendered.samples, SFX_RATE));
    imports.push(`import c${i} from './cues/${file}';`);
    entries.push(`  { ...${JSON.stringify({ ...play, at: round(play.at) })}, src: c${i}, seconds: ${round(rendered.seconds)}, landsAt: ${round(rendered.landsAt)} },`);
  });
  const sfxModule = relative(dirname(module), join(STUDIO_ROOT, 'lib/studio/sfx.tsx'));
  writeFileSync(module, [
    '// Written by `studio sfx draft` and `studio sfx cues` from cues.json. Edit cues.json and run studio sfx cues, rather than editing this.',
    `import type { SfxCueSound } from '${sfxModule}';`,
    ...imports,
    '',
    'const cues: readonly SfxCueSound[] = [',
    ...entries,
    '];',
    'export default cues;',
    '',
  ].join('\n'));
  return module;
}

/** One line per cue: when, what, and the sound or why it's silent. */
export function formatSfxCueList(list: SfxCueList): string[] {
  return list.cues.map((cue) => {
    const sound = sfxCueSound(cue), edited = cue.sound !== undefined || cue.nudge !== undefined || cue.volume !== undefined;
    const what = sound ? `${sound.sound}${sound.set && Object.keys(sound.set).length ? ` ${Object.entries(sound.set).map(([k, v]) => `${k}=${round(v)}`).join(',')}` : ''}` : `– ${cue.draft.why}`;
    return `${cue.event.at.toFixed(2).padStart(7)}  ${cue.id.padEnd(38)} ${what}${edited ? '  (edited)' : ''}`;
  });
}
