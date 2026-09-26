// cue-module.ts: a project's cue list on disk. sfx/cues.json is the list an agent edits (lib/sfx/cues.ts);
// generated/sfx-cues.ts, which the composition imports as `@sfx-cues`, is rendered from it on every bundle, with each
// sounding cue's WAV beside it, so a fresh clone builds from cues.json alone.
//
// Imported by lib/engine/bundle/project-bundle.ts, so it stays free of the renderer and of import.meta (the Remotion CLI bundles
// that file to CommonJS).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { SfxCueSound } from '#studio/sfx/sfx.tsx';
import { wavFromSamples } from '#models/audio/wav.ts';
import { roundSfxSeconds } from './cue-events.ts';
import { SFX_CLICK_STYLES, SFX_CUE_LIST_VERSION, sfxCuePlays, type SfxCueList } from './cues.ts';
import { SFX_RATE } from './dsp.ts';
import { renderSfx, type SfxRequest } from './library.ts';

/** The cue list an agent edits. */
export const sfxCueListFor = (project: string) => join(resolve(project), 'sfx', 'cues.json');
const sfxCueModuleFor = (project: string) => join(resolve(project), 'generated', 'sfx-cues.ts');
const sfxCueSoundsDirFor = (project: string) => join(resolve(project), 'generated', 'sfx-cues');

export function readSfxCueList(project: string): SfxCueList | null {
  const path = sfxCueListFor(project);
  if (!existsSync(path)) return null;
  const list = JSON.parse(readFileSync(path, 'utf8')) as SfxCueList;
  if (list.version !== SFX_CUE_LIST_VERSION) throw new Error(`${path} is version ${list.version}; delete it and redraft with studio sfx draft`);
  if (!Object.hasOwn(SFX_CLICK_STYLES, list.clickStyle)) throw new Error(`${path}: clickStyle is one of ${Object.keys(SFX_CLICK_STYLES).join(', ')}, not ${list.clickStyle}`);
  return list;
}

export function writeSfxCueList(project: string, list: SfxCueList): string {
  const path = sfxCueListFor(project);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`);
  return path;
}

/** A sound's file, named by what renders it. Renders are seeded, so the same request is the same file. */
const sfxCueSoundFile = (sound: SfxRequest) => `${sound.sound}-${createHash('sha256').update(JSON.stringify(sound)).digest('hex').slice(0, 12)}.wav`;

/**
 * Rewrites generated/sfx-cues.ts from sfx/cues.json: the cues the list plays (not placed ones, which play from their
 * scene), or null without a list. Renders missing sounds into generated/sfx-cues/ and deletes unused ones. Returns the
 * module's path.
 */
export function writeSfxCueModule(project: string): string {
  const path = sfxCueModuleFor(project), dir = sfxCueSoundsDirFor(project), list = readSfxCueList(project);
  mkdirSync(dir, { recursive: true });
  const plays = list ? sfxCuePlays(list).filter((p) => !p.inline) : [];
  const files = new Map(plays.map((p) => [sfxCueSoundFile(p.sound), p.sound]));
  const timing = new Map<string, { seconds: number; landsAt: number }>();
  for (const [file, sound] of files) {
    const rendered = renderSfx(sound);
    timing.set(file, { seconds: roundSfxSeconds(rendered.seconds), landsAt: roundSfxSeconds(rendered.landsAt) });
    // Compared, not just checked for: a change to a recipe renders the same request differently.
    const wav = wavFromSamples(rendered.samples, SFX_RATE), wavPath = join(dir, file);
    if (!existsSync(wavPath) || !readFileSync(wavPath).equals(wav)) writeFileSync(wavPath, wav);
  }
  for (const file of readdirSync(dir)) if (!files.has(file)) rmSync(join(dir, file));

  const imports = [...files.keys()];
  const cue = (p: (typeof plays)[number]): string => {
    const file = sfxCueSoundFile(p.sound), sound: Omit<SfxCueSound, 'src'> = { id: p.id, at: roundSfxSeconds(p.at), volume: p.volume, ...timing.get(file)! };
    return `  { ...${JSON.stringify(sound)}, src: s${imports.indexOf(file)} },`;
  };
  const module = list
    ? ['// Written from sfx/cues.json on every bundle. Edit cues.json, not this.', ...imports.map((f, i) => `import s${i} from ${JSON.stringify(`./sfx-cues/${f}`)};`), '', 'export default [', ...plays.map(cue), '];', ''].join('\n')
    : '// Written on every bundle: the project has no sfx/cues.json (studio sfx draft). Edits here are lost.\nexport default null;\n';
  // Unchanged content isn't rewritten, so a Studio watching the file doesn't reload for nothing.
  if (!existsSync(path) || readFileSync(path, 'utf8') !== module) writeFileSync(path, module);
  return path;
}
