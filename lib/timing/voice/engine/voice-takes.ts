// voice-takes.ts: every take of a project's lines, kept in audio/takes/, and the comp: which take each voiced line is
// cut from. Node only.
//
// A paid read can never be had again (Gemini reads differently every time) and audio/ is outside git, so a take is
// never overwritten or deleted: take n is audio/takes/<n>.wav with its audio/takes/<n>.json. audio/comp.json names,
// per voiced line, the take its clip and its manifest entry are cut from; voice-project.ts publishes it.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VoiceCompFile, VoiceTakeFile } from '../models/voice-take.ts';

/** A kept take: its number, its WAV's path, and its audio/takes/<n>.json. */
export type KeptVoiceTake = { number: number; wav: string; info: VoiceTakeFile };

const takesDir = (project: string) => join(project, 'audio', 'takes');
export const voiceCompPath = (project: string) => join(project, 'audio', 'comp.json');
const takeJsonPath = (project: string, number: number) => join(takesDir(project), `${number}.json`);

/** The project's kept takes, by number. */
export function readVoiceTakes(project: string): KeptVoiceTake[] {
  const dir = takesDir(project);
  return (existsSync(dir) ? readdirSync(dir) : []).flatMap((file) => {
    const number = /^(\d+)\.json$/.exec(file)?.[1];
    // SAFETY: audio/takes/<n>.json is written only by this module, from a VoiceTakeFile.
    return number ? [{ number: Number(number), wav: join(dir, `${number}.wav`), info: JSON.parse(readFileSync(join(dir, file), 'utf8')) as VoiceTakeFile }] : [];
  }).toSorted((a, b) => a.number - b.number);
}

/** The take each line is cut from, by line id: empty before the first take. */
export function readVoiceComp(project: string): VoiceCompFile['lines'] {
  // SAFETY: comp.json is written only by voice-project.ts, from a VoiceCompFile.
  return existsSync(voiceCompPath(project)) ? (JSON.parse(readFileSync(voiceCompPath(project), 'utf8')) as VoiceCompFile).lines : {};
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

/** Stamps each take newly chosen for a line in `comp`, which picks among takes that read a line alike. */
export function stampChosenVoiceTakes(project: string, before: VoiceCompFile['lines'], comp: ReadonlyMap<string, KeptVoiceTake>): void {
  const now = new Date().toISOString();
  for (const [id, take] of comp) {
    if (before[id]?.take === take.number || take.info.chosenAt === now) continue;
    take.info.chosenAt = now;
    saveKeptVoiceTake(project, take);
  }
}
