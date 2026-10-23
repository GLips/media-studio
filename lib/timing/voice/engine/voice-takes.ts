// voice-takes.ts: every take of a project's script, kept in audio/takes/, and which one is current. Node only.
//
// A paid read can never be had again (Gemini reads differently every time) and audio/ is outside git, so a take is
// never overwritten or deleted: take n is audio/takes/<n>.wav with its audio/takes/<n>.json. audio/current-take.json
// names the one the lines and the manifest are cut from.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VoiceCurrentTakeFile, VoiceTakeFile } from '../models/voice-take.ts';

/** A kept take: its number, its WAV's path, and its audio/takes/<n>.json. */
export type KeptVoiceTake = { number: number; wav: string; info: VoiceTakeFile };

const takesDir = (project: string) => join(project, 'audio', 'takes');
const currentTakePath = (project: string) => join(project, 'audio', 'current-take.json');
const takeJsonPath = (project: string, number: number) => join(takesDir(project), `${number}.json`);

/** The project's kept takes, by number, and the current one (null before the first take). */
export function readVoiceTakes(project: string): { kept: KeptVoiceTake[]; current: KeptVoiceTake | null } {
  keepSingleVoiceTake(project);
  const dir = takesDir(project);
  const kept = (existsSync(dir) ? readdirSync(dir) : []).flatMap((file) => {
    const number = /^(\d+)\.json$/.exec(file)?.[1];
    // SAFETY: audio/takes/<n>.json is written only by this module, from a VoiceTakeFile.
    return number ? [{ number: Number(number), wav: join(dir, `${number}.wav`), info: JSON.parse(readFileSync(join(dir, file), 'utf8')) as VoiceTakeFile }] : [];
  }).toSorted((a, b) => a.number - b.number);
  // SAFETY: current-take.json is written only by makeVoiceTakeCurrent, from a VoiceCurrentTakeFile.
  const pointer = existsSync(currentTakePath(project)) ? JSON.parse(readFileSync(currentTakePath(project), 'utf8')) as VoiceCurrentTakeFile : null;
  return { kept, current: kept.find((take) => take.number === pointer?.take) ?? null };
}

/** Where the current take came from, or null before the first take: a cheap read for renders and the plan page. */
export function readCurrentVoiceTakeSource(project: string): VoiceCurrentTakeFile['source'] | null {
  keepSingleVoiceTake(project);
  // SAFETY: as in readVoiceTakes.
  return existsSync(currentTakePath(project)) ? (JSON.parse(readFileSync(currentTakePath(project), 'utf8')) as VoiceCurrentTakeFile).source : null;
}

/**
 * Keeps a new take under the next number: `write` puts its audio at the path it's given. Its info is saved at once, so
 * a failure later never costs the read.
 */
export function keepVoiceTake(project: string, info: Omit<VoiceTakeFile, 'madeAt' | 'chosenAt'>, write: (wavPath: string) => void): KeptVoiceTake {
  const dir = takesDir(project);
  mkdirSync(dir, { recursive: true });
  // Numbered past every file, so a WAV whose info was never saved is never written over.
  const number = Math.max(0, ...readdirSync(dir).map((file) => Number(/^(\d+)\./.exec(file)?.[1] ?? 0))) + 1;
  const now = new Date().toISOString();
  const take = { number, wav: join(dir, `${number}.wav`), info: { ...info, madeAt: now, chosenAt: now } };
  write(take.wav);
  saveKeptVoiceTake(project, take);
  return take;
}

export function saveKeptVoiceTake(project: string, take: KeptVoiceTake): void {
  writeFileSync(takeJsonPath(project, take.number), JSON.stringify(take.info, null, 2));
}

/** Points audio/current-take.json at `take`, and stamps when it was chosen, which picks among takes of one script. */
export function makeVoiceTakeCurrent(project: string, take: KeptVoiceTake): void {
  take.info.chosenAt = new Date().toISOString();
  saveKeptVoiceTake(project, take);
  writeFileSync(currentTakePath(project), JSON.stringify({ take: take.number, source: take.info.source } satisfies VoiceCurrentTakeFile, null, 2));
}

// audio/take.wav with its take.json is a project's one take in the single-take layout. It may be a paid read the owner
// chose, so it becomes a kept take, and current, rather than being read over.
function keepSingleVoiceTake(project: string) {
  const wav = join(project, 'audio', 'take.wav'), json = join(project, 'audio', 'take.json');
  if (!existsSync(wav)) return;
  // SAFETY: take.json was written by studio voice from what is now VoiceTakeFile, less its dates.
  const old = existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) as Omit<VoiceTakeFile, 'madeAt' | 'chosenAt'> : { source: 'tts' as const };
  const madeAt = statSync(wav).mtime.toISOString();
  const take = keepVoiceTake(project, old, (path) => renameSync(wav, path));
  take.info.madeAt = madeAt;
  makeVoiceTakeCurrent(project, take);
  rmSync(json, { force: true });
  process.stderr.write(`kept audio/take.wav as take ${take.number}\n`);
}
