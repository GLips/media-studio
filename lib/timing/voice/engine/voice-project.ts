// voice-project.ts: voices a project's script as one take, and cuts it into lines. `studio voice` runs it.
//
// The script is the storyboard's `voice` and lines, in plan order; `paragraph: true` starts a new paragraph of the
// read. The model reads the text verbatim, so direct it with its inline tags (`<short pause>`, `<breath>`…), which
// captions and word times leave out. `*word*` (emphasis) and `` `key` `` (a keycap) it never sees.
//
// The take is one read, so any change to the script reads a new take whole: a spliced-in line would stand out. Every
// take is kept (voice-takes.ts), so no script is paid for twice.
//
// Negative space: the manifest holds real reads only. Before there's a take, resolveStoryboard estimates each line.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { measureAudibleLoudness } from '#lib/platform/ffmpeg/engine/loudness.ts';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { postOpenRouter } from '#lib/platform/paid-generation/engine/openrouter.ts';
import type { RenderVoice } from '../models/render-voice.ts';
import type { RecordedVoiceLine } from '../models/voice-manifest.ts';
import { cutTakeIntoLines, pinWordsToTaggedPauses, type TakeClip, type VoiceTakeFile } from '../models/voice-take.ts';
import { alignSpokenWords, captionMarkup, spokenText, ttsText, type SpokenWord } from '../models/voice-words.ts';
import { samplesFromWav, wavFromPcm, wavFromSamples } from '#lib/platform/wav/models/wav.ts';
import { heardWords } from './whisper-words.ts';
import { keepVoiceTake, makeVoiceTakeCurrent, readCurrentVoiceTakeSource, readVoiceTakes, saveKeptVoiceTake, type KeptVoiceTake } from './voice-takes.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';

const MODEL = 'google/gemini-3.8-flash-tts';
const DRAFT_VOICE = 'Samantha';
// Cutting rounds before settling for the last one's cuts; the second round usually finds they didn't move.
const MAX_CUT_ROUNDS = 4;
// A quiet stretch shorter than this between two lines means they were read as one phrase, and the cut is audible.
const TIGHT_PAUSE = 0.08;
// say's own pause commands, standing in for Gemini's paragraph breaks and pause tags; its other tags are dropped.
const SAY_PARAGRAPH = ' [[slnc 600]] ';
const sayText = (text: string) => text.replace(/<short pause>/g, ' [[slnc 300]] ').replace(/<long pause>/g, ' [[slnc 800]] ').replace(/<[^>]*>/g, ' ');

/** What one take reads: the voice, how it reads, and every line in plan order (a storyboard's, by readProjectVoiceScript). */
export type VoiceScript = { voice: string; direction?: string; lines: readonly { id: string; text: string; paragraph?: boolean }[] };
type ScriptLine = { id: string; text: string; caption: string; paragraph: boolean };

/**
 * How to get the take: `paid` reads it with Gemini TTS (needs OPENROUTER_API_KEY), `draft` with macOS `say` (free,
 * flat; the next paid run re-reads it).
 */
export type VoiceMode = 'draft' | 'paid';

const hashFor = (...key: unknown[]) => createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 16);

/**
 * What reading `script` would hash to, each way: a kept take with one of these hashes reads it as it is now. A draft
 * never matches the paid hash, so a paid run reads afresh over one.
 */
function voiceScriptHashes(script: VoiceScript) {
  const readText = (paragraphBreak: string) => script.lines.map((line, i) => (i === 0 ? '' : line.paragraph ? paragraphBreak : ' ') + ttsText(line.text)).join('');
  const paidText = readText('\n\n'), draftText = sayText(readText(SAY_PARAGRAPH));
  return { paidText, draftText, paid: hashFor(MODEL, script.voice, paidText, script.direction ?? null), draft: hashFor('say', DRAFT_VOICE, draftText) };
}

/**
 * The kept take that already reads the script as `mode` would: a paid one first, then (for a draft run) a draft.
 * Among takes of one script, the current one, else the one chosen last.
 */
function keptTakeReading(kept: readonly KeptVoiceTake[], current: KeptVoiceTake | null, hashes: { paid: string; draft: string }, mode: VoiceMode) {
  const latest = (hash: string) => kept.filter((take) => take.info.hash === hash)
    .toSorted((a, b) => Number(b === current) - Number(a === current) || b.info.chosenAt.localeCompare(a.info.chosenAt))[0];
  return latest(hashes.paid) ?? (mode === 'draft' ? latest(hashes.draft) : undefined);
}

/**
 * Voices `script` for the project and returns the path of the audio/manifest.ts it wrote. A kept take that reads the
 * script is reused rather than paid for again, and a recording stays current. `recording` imports a human read as a
 * new take; `reread` reads a new take whatever is kept. Either way, every earlier take stays kept.
 */
export async function voiceStudioProject(project: string, script: VoiceScript, { mode, recording, reread = false }: { mode: VoiceMode; recording?: string; reread?: boolean }): Promise<string> {
  if (reread && mode === 'draft') throw new Error('--reread is for paid reads: say reads a script the same way every time');
  const hashes = voiceScriptHashes(script);
  const { kept, current } = readVoiceTakes(project);
  let take: KeptVoiceTake;
  if (recording) {
    take = keepVoiceTake(project, { source: 'recording' }, (wav) => runFfmpeg(['-v', 'error', '-y', '-i', recording, '-ac', '1', '-ar', '24000', '-sample_fmt', 's16', '-map_metadata', '-1', wav]));
    process.stderr.write(`imported ${recording} as take ${take.number}\n`);
  } else if (current?.info.source === 'recording' && !reread) {
    take = current;
  } else {
    const reading = reread ? undefined : keptTakeReading(kept, current, hashes, mode);
    if (reading && reading !== current) process.stderr.write(`take ${reading.number} reads this script already: using it, nothing paid\n`);
    take = reading ?? await readNewTake(project, script, hashes, mode);
  }
  makeVoiceTakeCurrent(project, take);
  return cutVoiceTake(project, script, take);
}

/**
 * Makes kept take `number` current and cuts it into lines, with no paid call. It must read the script as it is now
 * (a recording always may), so the next `studio voice` keeps it rather than reading afresh.
 */
export async function chooseVoiceTake(project: string, script: VoiceScript, number: number): Promise<string> {
  const { kept } = readVoiceTakes(project);
  const take = kept.find((t) => t.number === number);
  if (!take) throw new Error(`there's no take ${number}: the kept takes are ${kept.map((t) => t.number).join(', ') || 'none'}`);
  const hashes = voiceScriptHashes(script);
  if (take.info.source !== 'recording' && take.info.hash !== hashes.paid && take.info.hash !== hashes.draft) {
    throw new Error(`take ${number} reads another script, voice or direction: put storyboard.ts back as it was, and studio voice uses it unasked`);
  }
  makeVoiceTakeCurrent(project, take);
  process.stderr.write(`take ${number} is current\n`);
  return cutVoiceTake(project, script, take);
}

/** One kept take, for `studio voice --takes`. `readsScript` is false for a take of another script, voice or direction. */
export type VoiceTakeListing = { number: number; source: VoiceTakeFile['source']; madeAt: string; seconds: number; current: boolean; readsScript: boolean };

/** Every kept take of the project, oldest first. Reads nothing aloud and cuts nothing. */
export function listVoiceTakes(project: string, script: VoiceScript): VoiceTakeListing[] {
  const { kept, current } = readVoiceTakes(project);
  const hashes = voiceScriptHashes(script);
  return kept.map((take) => {
    const { samples, rate } = samplesFromWav(readFileSync(take.wav));
    return {
      number: take.number, source: take.info.source, madeAt: take.info.madeAt, seconds: samples.length / rate, current: take === current,
      readsScript: take.info.source === 'recording' || take.info.hash === hashes.paid || take.info.hash === hashes.draft,
    };
  });
}

async function readNewTake(project: string, script: VoiceScript, hashes: ReturnType<typeof voiceScriptHashes>, mode: VoiceMode) {
  const { wav, duration } = mode === 'draft' ? speakDraft(hashes.draftText) : await speak(hashes.paidText, script.voice, script.direction);
  const take = keepVoiceTake(project, { source: mode === 'draft' ? 'draft' : 'tts', hash: mode === 'draft' ? hashes.draft : hashes.paid }, (path) => writeFileSync(path, wav));
  process.stderr.write(`${mode === 'draft' ? 'drafted' : 'voiced'} take ${take.number}  ${duration.toFixed(2)}s\n`);
  return take;
}

/** Cuts `take` into audio/<line>.wav and writes audio/manifest.ts. Returns the manifest's path. */
async function cutVoiceTake(project: string, script: VoiceScript, take: KeptVoiceTake): Promise<string> {
  const dir = join(project, 'audio');
  const lines: ScriptLine[] = script.lines.map((line) => ({ id: line.id, text: spokenText(line.text), caption: captionMarkup(line.text), paragraph: line.paragraph ?? false }));
  // The take's info is saved after each transcription, so a failure later never costs one again.
  const heard = (take.info.heard ??= {});
  const used = new Set<string>();
  const hear = async (file: string) => {
    const key = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
    used.add(key);
    if (!heard[key]) {
      heard[key] = await heardWords(file);
      saveKeptVoiceTake(project, take);
    }
    return heard[key];
  };

  const { samples, rate } = samplesFromWav(readFileSync(take.wav));
  const clipFile = (id: string) => join(dir, `${id}.wav`);
  for (const file of readdirSync(dir)) if (file.endsWith('.wav')) rmSync(join(dir, file));
  // Whisper drifts over a whole take (by a second, at worst), but not over one clip. So each round cuts with the best
  // word times so far and hears every clip, and the clips' words, placed back in the take, time the next round's cuts.
  // It stops once the cuts stop moving.
  let takeWords = await hear(take.wav);
  let clips: TakeClip[] = [];
  const clipWords: SpokenWord[][] = [];
  for (let round = 0; round < MAX_CUT_ROUNDS; round++) {
    const previous = clips;
    clips = cutTakeIntoLines(lines, takeWords, samples, rate);
    if (clips.every((clip, i) => clip.from === previous[i]?.from && clip.to === previous[i]?.to)) break;
    for (const [i, clip] of clips.entries()) {
      writeFileSync(clipFile(clip.id), wavFromSamples(samples.subarray(Math.round(clip.from * rate), Math.round(clip.to * rate)), rate));
      clipWords[i] = await hear(clipFile(clip.id));
    }
    takeWords = clips.flatMap((clip, i) => clipWords[i].map((w) => ({ text: w.text, start: w.start + clip.from, end: w.end + clip.from })));
  }

  const manifest: Record<string, RecordedVoiceLine> = {};
  for (const [i, clip] of clips.entries()) {
    const file = clipFile(clip.id), { text, caption, paragraph } = lines[i];
    const clipSamples = samplesFromWav(readFileSync(file)).samples;
    const duration = clipSamples.length / rate;
    const aligned = alignSpokenWords(text, clipWords[i], duration);
    const round = (x: number) => Math.round(x * 1000) / 1000;
    const words = pinWordsToTaggedPauses(script.lines[i].text, aligned.words, clipSamples, rate).map((w) => ({ text: w.text, start: round(w.start), end: round(w.end) }));
    manifest[clip.id] = { src: `audio/${clip.id}.wav`, duration, text, caption, paragraph, words, lufs: measureAudibleLoudness(file).lufs, pauseBefore: clip.pauseBefore };

    const pause = clip.pauseBefore === null ? '' : `  after ${clip.pauseBefore.toFixed(2)}s`;
    const unheard = words.filter((_, k) => !aligned.heard[k]).map((w) => w.text);
    console.error(`cut ${clip.id}  ${duration.toFixed(2)}s${pause}${unheard.length ? `  (misheard, timed from their neighbours: ${unheard.join(' ')})` : ''}`);
  }
  for (const clip of clips.slice(1)) {
    const problem = !clip.cutIsClear ? 'has no one clear pause' : clip.cutPause < TIGHT_PAUSE ? `pauses only ${Math.round(clip.cutPause * 1000)} ms` : null;
    if (problem) console.error(`listen to ${clip.id}: the read ${problem} before it, so the cut may be heard. Add <short pause> before it, or move the line break`);
  }
  for (const key of Object.keys(heard)) if (!used.has(key)) delete heard[key];
  saveKeptVoiceTake(project, take);
  return writeManifest(dir, manifest);
}

/**
 * Whose voice the project's lines are in: `draft` when they were cut from a `--read=draft` take (macOS say, fine for
 * timing, never for delivery), `final` for a real take, null before the first take.
 */
export function renderVoiceOf(project: string): RenderVoice {
  const source = readCurrentVoiceTakeSource(project);
  if (!existsSync(join(project, 'audio', 'manifest.json')) || !source) return null;
  return source === 'draft' ? 'draft' : 'final';
}

function writeManifest(dir: string, manifest: Record<string, RecordedVoiceLine>) {
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'manifest.ts'), voiceManifestModule(manifest));
  const total = Object.values(manifest).reduce((sum, line) => sum + line.duration, 0);
  console.error(`${Object.keys(manifest).length} lines, ${total.toFixed(1)}s of voice`);
  return join(dir, 'manifest.ts');
}

/**
 * audio/manifest.ts's source for `manifest`: a module rather than JSON, so the video imports each WAV and the bundler
 * serves it. `studio new` writes it with no lines, before the first take.
 */
export function voiceManifestModule(manifest: Record<string, RecordedVoiceLine>) {
  const ids = Object.keys(manifest);
  const imports = ids.map((id, i) => `import wav${i} from './${basename(manifest[id].src)}';`).join('\n');
  const entries = ids.map((id, i) => {
    const { duration, text, caption, paragraph, words, lufs, pauseBefore } = manifest[id];
    return `  ${JSON.stringify(id)}: { src: wav${i}, duration: ${duration}, lufs: ${lufs}, pauseBefore: ${pauseBefore}, paragraph: ${paragraph},\n    text: ${JSON.stringify(text)},\n    caption: ${JSON.stringify(caption)},\n    words: ${JSON.stringify(words)} },`;
  }).join('\n');
  return `// Written by \`studio voice\`. Edits here are lost on the next run.
import type { RecordedVoice } from '#lib/timing/voice/models/voice-manifest.ts';
${imports && `${imports}\n`}
export const voice = {${entries && `\n${entries}\n`}} as const satisfies RecordedVoice;
`;
}

/** Reads one line in each voice, into `out`/<voice>.wav, to compare them. Returns the files. */
export async function auditionVoices(text: string, voices: string[], out: string): Promise<string[]> {
  mkdirSync(out, { recursive: true });
  const files: string[] = [];
  for (const voice of voices) {
    const { wav, duration } = await speak(text, voice);
    const file = join(out, `${voice}.wav`);
    writeFileSync(file, wav);
    console.error(`${voice}  ${duration.toFixed(2)}s`);
    files.push(file);
  }
  return files;
}

// Gemini TTS reads `input` verbatim, so the direction goes in `instructions`, which it takes as the read's style.
async function speak(text: string, voice: string, direction?: string) {
  const response = await postOpenRouter('/audio/speech', { model: MODEL, input: text, voice, response_format: 'pcm', ...(direction && { instructions: direction }) });
  const pcm = Buffer.from(await response.arrayBuffer());
  const rate = Number(/rate=(\d+)/.exec(response.headers.get('content-type') || '')?.[1] || 24000);
  return { wav: wavFromPcm(pcm, rate), duration: pcm.length / (rate * 2) };
}

function speakDraft(text: string) {
  const wav = withStudioTemp('say', (tmp) => {
    const out = join(tmp, 'take.wav');
    execFileSync('say', ['-v', DRAFT_VOICE, '-o', out, '--data-format=LEI16@24000', text]);
    return readFileSync(out);
  });
  const { samples, rate } = samplesFromWav(wav);
  return { wav, duration: samples.length / rate };
}
