// voice-generations.ts: what a project plays, published as one generation at a time. Node only.
//
// A generation is audio/generations/<hash>/ holding manifest.json, manifest.ts and comp.json, never changed once
// written; its clips are shared, content-addressed, in audio/clips/. audio/manifest.ts is the one pointer: a re-export
// of the current generation's manifest.ts, which the bundlers follow and Node readers parse. Switching it is the one
// rename that publishes, so no reader ever sees one generation's manifest with another's comp.
//
// Negative space: nothing is collected while a reader may hold it. A generation is kept a day after it stops being
// current, and a clip while any kept generation names it or for a day after it was written.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { RecordedVoice } from '../models/voice-manifest.ts';
import type { VoiceCompFile } from '../models/voice-take.ts';

// How long a render may go on reading a generation after it stops being current.
const READER_GRACE_MS = 24 * 60 * 60 * 1000;
const GENERATION_DIR = /^[0-9a-f]{16}$/;
const POINTER = /from '\.\/generations\/([0-9a-f]{16})\/manifest\.ts'/;

const generationsDir = (project: string) => join(project, 'audio', 'generations');
const pointerPath = (project: string) => join(project, 'audio', 'manifest.ts');

/** The current generation's folder, or null before the first (or for `studio new`'s empty manifest). */
export function currentVoiceGeneration(project: string): string | null {
  const pointer = pointerPath(project);
  const hash = existsSync(pointer) ? POINTER.exec(readFileSync(pointer, 'utf8'))?.[1] : undefined;
  return hash ? join(generationsDir(project), hash) : null;
}

/** The take each voiced line of the current generation is cut from, by line id: empty before the first. */
export function readVoiceComp(project: string): VoiceCompFile['lines'] {
  const generation = currentVoiceGeneration(project);
  // SAFETY: a generation's comp.json is written only by publishVoiceGeneration, from a VoiceCompFile.
  return generation ? (JSON.parse(readFileSync(join(generation, 'comp.json'), 'utf8')) as VoiceCompFile).lines : {};
}

/**
 * Writes a generation of these files (unless one with the same contents is kept) and makes it current with one
 * rename of the pointer. The generation it replaces is stamped, so it's kept a day from now for the readers holding it.
 */
export function publishVoiceGeneration(project: string, files: { 'manifest.json': string; 'manifest.ts': string; 'comp.json': string }): void {
  const dir = generationsDir(project);
  mkdirSync(dir, { recursive: true });
  const hash = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
  const generation = join(dir, hash);
  if (!existsSync(generation)) {
    const temp = join(dir, `${hash}.${randomUUID()}.tmp`);
    mkdirSync(temp);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(temp, name), text);
    renameSync(temp, generation);
  }
  const previous = currentVoiceGeneration(project);
  if (previous && previous !== generation && existsSync(previous)) utimesSync(previous, new Date(), new Date());
  // Prepared in generations/, so the one rename into audio/ is the whole publish.
  const pointer = join(dir, `pointer.${randomUUID()}.tmp`);
  writeFileSync(pointer, voicePointerModule(hash));
  renameSync(pointer, pointerPath(project));
}

/** audio/manifest.ts as the pointer to generation `hash`. */
const voicePointerModule = (hash: string) => `// Written by \`studio voice\`: the voice generation the project plays. Edits here are lost on the next run.
export { voice, voiceRead } from './generations/${hash}/manifest.ts';
`;

/**
 * Under the lock, before a run: removes what a failed write left (`.tmp`), generations a day past being current, and
 * clips no kept generation names that are a day old.
 */
export function sweepVoiceGenerations(project: string, now = Date.now()): void {
  const dir = generationsDir(project), clips = join(project, 'audio', 'clips'), audio = join(project, 'audio');
  const old = (path: string) => now - statSync(path).mtimeMs > READER_GRACE_MS;
  const current = currentVoiceGeneration(project);
  const named = new Set<string>();
  for (const entry of existsSync(dir) ? readdirSync(dir) : []) {
    const path = join(dir, entry);
    if (entry.endsWith('.tmp')) rmSync(path, { recursive: true, force: true });
    if (!GENERATION_DIR.test(entry)) continue;
    if (path !== current && old(path)) {
      rmSync(path, { recursive: true, force: true });
      continue;
    }
    // SAFETY: a generation's manifest.json is written only by publishVoiceGeneration, as a RecordedVoice.
    for (const line of Object.values(JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8')) as RecordedVoice)) named.add(basename(line.src));
  }
  for (const entry of readdirSync(audio)) if (entry.endsWith('.tmp')) rmSync(join(audio, entry), { force: true });
  for (const entry of existsSync(clips) ? readdirSync(clips) : []) {
    const path = join(clips, entry);
    if (entry.endsWith('.tmp') || (!named.has(entry) && old(path))) rmSync(path, { force: true });
  }
}
