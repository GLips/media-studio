// voice-project.ts: voices a project's script line by line, each line cut from the take chosen for it (the comp).
// `studio voice` runs it.
//
// The model reads the text verbatim, so direct it with inline tags (`<short pause>`, `<breath>`…), which captions and
// word times leave out; `*word*` and `` `key` `` it never sees.
//
// A changed line is read again alone, so approved lines keep their read and timing. A pickup reads the line before it
// too (cut, never chosen) so the join holds; takes join only at clip boundaries, in measured quiet. Every take is
// kept (voice-takes.ts), so no read is paid for twice.
//
// Negative space: the manifest holds real reads only. Before there's a take, resolveStoryboard estimates each line.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { measureAudibleLoudness } from '#lib/platform/ffmpeg/engine/loudness.ts';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { postOpenRouter } from '#lib/platform/paid-generation/engine/openrouter.ts';
import type { RenderVoice } from '../models/render-voice.ts';
import type { RecordedVoiceLine } from '../models/voice-manifest.ts';
import { cutTakeIntoLines, pinWordsToTaggedPauses, type TakeClip, type VoiceTakeFile, type VoiceTakeLine } from '../models/voice-take.ts';
import { alignSpokenWords, captionMarkup, spokenText, ttsText, type SpokenWord } from '../models/voice-words.ts';
import { samplesFromWav, wavFromPcm, wavFromSamples } from '#lib/platform/wav/models/wav.ts';
import { heardWords } from './whisper-words.ts';
import { keepVoiceTake, readVoiceComp, readVoiceTakes, saveKeptVoiceTake, writeVoiceComp, type KeptVoiceTake } from './voice-takes.ts';
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

/** What the project reads: the voice, how it reads, and every line in plan order (a storyboard's, by readProjectVoiceScript). */
export type VoiceScript = { voice: string; direction?: string; lines: readonly { id: string; text: string; paragraph?: boolean }[] };
type ScriptLine = VoiceScript['lines'][number];

/**
 * How to read missing lines: `paid` with Gemini TTS (needs OPENROUTER_API_KEY), `draft` with macOS `say` (free, flat;
 * the next paid run reads them again).
 */
export type VoiceMode = 'draft' | 'paid';

const hashFor = (...key: unknown[]) => createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 16);

/**
 * What a read of each line would hash to, each way: a take line with one of these hashes reads it as it is now. A
 * draft never matches the paid hash, so a paid run reads afresh over one.
 */
function voiceLineHashes(script: VoiceScript) {
  return new Map(script.lines.map((line) => {
    const text = ttsText(line.text), paragraph = line.paragraph ?? false;
    return [line.id, { paid: hashFor(MODEL, script.voice, text, paragraph, script.direction ?? null), draft: hashFor('say', DRAFT_VOICE, sayText(text), paragraph) }];
  }));
}
type VoiceLineHashes = ReturnType<typeof voiceLineHashes>;

/** The take's read of line `id`, unless it reads it only as its context. */
const choosableLine = (take: KeptVoiceTake, id: string) => (id === take.info.context ? undefined : take.info.lines.find((line) => line.id === id));

/** Whether `take` reads line `id` as the script has it now, paid, or (with `draft`) by say. */
function readsLineNow(take: KeptVoiceTake, id: string, hashes: VoiceLineHashes, draft = true) {
  const hash = choosableLine(take, id)?.hash, now = hashes.get(id);
  return hash !== undefined && now !== undefined && (hash === now.paid || (draft && hash === now.draft));
}

function scriptLinesNamed(script: VoiceScript, ids: readonly string[]) {
  for (const id of ids) if (!script.lines.some((line) => line.id === id)) throw new Error(`there's no line "${id}": the lines are ${script.lines.map((line) => line.id).join(', ')}`);
  return script.lines.filter((line) => ids.includes(line.id));
}

/**
 * Voices `script` and returns the audio/manifest.ts it wrote. Each line keeps a kept take that reads it as it is now;
 * the rest are read, a pickup per run. A recorded line is never replaced by TTS. `recording` imports a human read of
 * `lines` (default all) as a new take; `reread` reads `lines` afresh.
 */
export async function voiceStudioProject(project: string, script: VoiceScript, { mode, lines, recording, reread = false }: { mode: VoiceMode; lines?: readonly string[]; recording?: string; reread?: boolean }): Promise<string> {
  if (reread && mode === 'draft') throw new Error('--reread is for paid reads: say reads a script the same way every time');
  if (lines && !reread && !recording) throw new Error('--lines goes with --reread, --take or --choose');
  const named = lines ? scriptLinesNamed(script, lines) : script.lines;
  const hashes = voiceLineHashes(script);
  const kept = readVoiceTakes(project), chosenBefore = readVoiceComp(project);
  const comp = new Map<string, KeptVoiceTake>();

  if (recording) {
    const info = { source: 'recording' as const, lines: named.map((line) => takeLine(line, hashes.get(line.id)!.paid)) };
    const take = keepVoiceTake(project, info, (wav) => runFfmpeg(['-v', 'error', '-y', '-i', recording, '-ac', '1', '-ar', '24000', '-sample_fmt', 's16', '-map_metadata', '-1', wav]));
    process.stderr.write(`imported ${recording} as take ${take.number}, reading ${named.map((line) => line.id).join(', ')}\n`);
    for (const line of named) comp.set(line.id, take);
  }
  const fresh = new Set(reread ? named.map((line) => line.id) : []);
  const reused = new Map<KeptVoiceTake, string[]>();
  for (const { id } of script.lines) {
    if (comp.has(id) || fresh.has(id)) continue;
    const chosen = kept.find((take) => take.number === chosenBefore[id]?.take);
    if (chosen?.info.source === 'recording' && choosableLine(chosen, id)) {
      if (!readsLineNow(chosen, id, hashes)) process.stderr.write(`line ${id}: its recording (take ${chosen.number}) reads older text; --reread --lines ${id} or --take replaces it\n`);
      comp.set(id, chosen);
      continue;
    }
    const latest = (draft: boolean) => kept.filter((take) => readsLineNow(take, id, hashes, draft))
      .toSorted((a, b) => Number(b === chosen) - Number(a === chosen) || b.info.chosenAt.localeCompare(a.info.chosenAt))[0];
    const reading = latest(false) ?? (mode === 'draft' ? latest(true) : undefined);
    if (!reading) continue;
    if (reading !== chosen) reused.set(reading, [...(reused.get(reading) ?? []), id]);
    comp.set(id, reading);
  }
  for (const [take, ids] of reused) process.stderr.write(`take ${take.number} reads ${ids.join(', ')} already: using it, nothing paid\n`);
  const runs = missingRuns(script, comp);
  const read = await Promise.all(runs.map((run) => readPickup(project, script, run, hashes, mode)));
  runs.forEach((run, i) => run.lines.forEach((line) => comp.set(line.id, read[i])));
  return cutVoiceComp(project, script, comp);
}

/** Each run of consecutive lines with no take in `comp`, with the line before it, its context, if there is one. */
function missingRuns(script: VoiceScript, comp: ReadonlyMap<string, KeptVoiceTake>) {
  const runs: { context?: ScriptLine; lines: ScriptLine[] }[] = [];
  script.lines.forEach((line, i) => {
    if (comp.has(line.id)) return;
    const last = runs.at(-1);
    if (last && last.lines.at(-1) === script.lines[i - 1]) last.lines.push(line);
    else runs.push({ context: script.lines[i - 1], lines: [line] });
  });
  return runs;
}

function readBreakBefore(line: ScriptLine, i: number, paragraphBreak: string) {
  if (i === 0) return '';
  return line.paragraph ? paragraphBreak : ' ';
}

const takeLine = (line: ScriptLine, hash: string): VoiceTakeLine => ({ id: line.id, text: line.text, paragraph: line.paragraph ?? false, hash });

async function readPickup(project: string, script: VoiceScript, run: { context?: ScriptLine; lines: ScriptLine[] }, hashes: VoiceLineHashes, mode: VoiceMode) {
  const read = run.context ? [run.context, ...run.lines] : run.lines;
  const readText = (paragraphBreak: string) => read.map((line, i) => readBreakBefore(line, i, paragraphBreak) + ttsText(line.text)).join('');
  const { wav, duration } = mode === 'draft' ? speakDraft(sayText(readText(SAY_PARAGRAPH))) : await speak(readText('\n\n'), script.voice, script.direction);
  const info: Omit<VoiceTakeFile, 'madeAt' | 'chosenAt'> = {
    source: mode === 'draft' ? 'draft' : 'tts',
    lines: read.map((line) => takeLine(line, hashes.get(line.id)![mode])),
    ...(run.context && { context: run.context.id }),
  };
  const take = keepVoiceTake(project, info, (path) => writeFileSync(path, wav));
  const what = run.lines.length === script.lines.length ? 'the script' : `${run.lines.map((line) => line.id).join(', ')}${run.context ? `, after ${run.context.id}` : ''}`;
  process.stderr.write(`${mode === 'draft' ? 'drafted' : 'voiced'} take ${take.number} (${what})  ${duration.toFixed(2)}s\n`);
  return take;
}

/**
 * Chooses kept take `number` for `lines` (without, every line it reads as the script has it now) and cuts the comp,
 * with no paid call. Each must be a line the take reads as it is now (a recording always may), so the next `studio
 * voice` keeps it rather than reading afresh.
 */
export async function chooseVoiceTake(project: string, script: VoiceScript, number: number, lines?: readonly string[]): Promise<string> {
  const kept = readVoiceTakes(project);
  const take = kept.find((t) => t.number === number);
  if (!take) throw new Error(`there's no take ${number}: the kept takes are ${kept.map((t) => t.number).join(', ') || 'none'}`);
  const hashes = voiceLineHashes(script);
  const usable = (id: string) => (take.info.source === 'recording' ? !!choosableLine(take, id) : readsLineNow(take, id, hashes));
  const ids = lines ? scriptLinesNamed(script, lines).map((line) => line.id) : script.lines.map((line) => line.id).filter(usable);
  for (const id of ids) {
    if (!choosableLine(take, id)) throw new Error(`take ${number} doesn't read ${id}${take.info.context === id ? ' (only as its context)' : ''}: studio voice --takes lists what each reads`);
    if (!usable(id)) throw new Error(`take ${number} reads another text, voice or direction of ${id}: put storyboard.ts back as it was, and studio voice uses it unasked`);
  }
  if (!ids.length) throw new Error(`take ${number} reads none of the lines as they are now`);
  const chosenBefore = readVoiceComp(project);
  const comp = new Map<string, KeptVoiceTake>();
  for (const { id } of script.lines) {
    const chosen = ids.includes(id) ? take : kept.find((t) => t.number === chosenBefore[id]?.take);
    if (!chosen) throw new Error(`line ${id} has no take yet: run studio voice first`);
    comp.set(id, chosen);
  }
  process.stderr.write(`take ${number} is chosen for ${ids.join(', ')}\n`);
  return cutVoiceComp(project, script, comp);
}

/** One kept take, for `studio voice --takes`: the lines it reads (`now` false for an old text) and those it's chosen for. */
export type VoiceTakeListing = {
  number: number; source: VoiceTakeFile['source']; madeAt: string; seconds: number;
  context?: string; lines: { id: string; now: boolean }[]; chosenFor: string[];
};

/** Every kept take of the project, oldest first. Reads nothing aloud and cuts nothing. */
export function listVoiceTakes(project: string, script: VoiceScript): VoiceTakeListing[] {
  const comp = readVoiceComp(project), hashes = voiceLineHashes(script);
  return readVoiceTakes(project).map((take) => {
    const { samples, rate } = samplesFromWav(readFileSync(take.wav));
    const listing: VoiceTakeListing = {
      number: take.number, source: take.info.source, madeAt: take.info.madeAt, seconds: samples.length / rate,
      lines: take.info.lines.filter((line) => line.id !== take.info.context).map((line) => ({ id: line.id, now: readsLineNow(take, line.id, hashes) })),
      chosenFor: script.lines.map((line) => line.id).filter((id) => comp[id]?.take === take.number),
    };
    if (take.info.context) listing.context = take.info.context;
    return listing;
  });
}

/**
 * Writes audio/comp.json, cuts each take in `comp` into the lines it reads, keeps each line's clip from its own take
 * as audio/<line>.wav, and writes audio/manifest.ts. Returns the manifest's path.
 */
async function cutVoiceComp(project: string, script: VoiceScript, comp: ReadonlyMap<string, KeptVoiceTake>): Promise<string> {
  const dir = join(project, 'audio');
  const ordered = new Map(script.lines.map((line) => [line.id, comp.get(line.id)!]));
  writeVoiceComp(project, ordered);
  for (const file of readdirSync(dir)) if (file.endsWith('.wav')) rmSync(join(dir, file));
  const manifest: Record<string, RecordedVoiceLine> = {};
  await Promise.all([...new Set(ordered.values())].map((take) => withStudioTemp('voice-cut', async (tmp) => {
      const cut = await cutVoiceTake(project, take, tmp);
      for (const [i, clip] of cut.clips.entries()) {
        if (ordered.get(clip.id) !== take) continue;
        const file = join(dir, `${clip.id}.wav`), line = take.info.lines[i];
        copyFileSync(cut.files[i], file);
        const text = spokenText(line.text), clipSamples = samplesFromWav(readFileSync(file)).samples;
        const duration = clipSamples.length / cut.rate;
        const aligned = alignSpokenWords(text, cut.words[i], duration);
        const round = (x: number) => Math.round(x * 1000) / 1000;
        const words = pinWordsToTaggedPauses(line.text, aligned.words, clipSamples, cut.rate).map((w) => ({ text: w.text, start: round(w.start), end: round(w.end) }));
        const pauseBefore = clip.id === script.lines[0].id ? null : clip.pauseBefore;
        manifest[clip.id] = { src: `audio/${clip.id}.wav`, duration, text, caption: captionMarkup(line.text), paragraph: line.paragraph, words, lufs: measureAudibleLoudness(file).lufs, pauseBefore };

        const pause = pauseBefore === null ? '' : `  after ${pauseBefore.toFixed(2)}s`;
        const unheard = words.filter((_, k) => !aligned.heard[k]).map((w) => w.text);
        process.stderr.write(`cut ${clip.id} from take ${take.number}  ${duration.toFixed(2)}s${pause}${unheard.length ? `  (misheard, timed from their neighbours: ${unheard.join(' ')})` : ''}\n`);
        const problem = i === 0 ? null : cutProblem(clip);
        if (problem) process.stderr.write(`listen to ${clip.id}: take ${take.number} ${problem} before it, so the cut may be heard. Add <short pause> before it, or move the line break\n`);
      }
    })));
  return writeManifest(dir, Object.fromEntries(script.lines.map((line) => [line.id, manifest[line.id]])));
}

function cutProblem(clip: TakeClip) {
  if (!clip.cutIsClear) return 'has no one clear pause';
  return clip.cutPause < TIGHT_PAUSE ? `pauses only ${Math.round(clip.cutPause * 1000)} ms` : null;
}

/**
 * Cuts `take` into a clip per line it reads, written into `tmp`, with what whisper hears in each. Whisper's hearing is
 * saved in the take's info after each transcription, so a failure later never costs one again.
 */
async function cutVoiceTake(project: string, take: KeptVoiceTake, tmp: string) {
  const lines = take.info.lines.map((line) => ({ id: line.id, text: spokenText(line.text) }));
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
  const files = lines.map((line) => join(tmp, `${line.id}.wav`));
  const clipFile = (id: string) => files[lines.findIndex((line) => line.id === id)];
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
  for (const key of Object.keys(heard)) if (!used.has(key)) delete heard[key];
  saveKeptVoiceTake(project, take);
  return { clips, files, words: clipWords, rate };
}

/**
 * Whose voice the project's lines are in: `draft` when any was cut from a `--read=draft` take (macOS say, fine for
 * timing, never for delivery), `final` when all are real reads, null before the first take.
 */
export function renderVoiceOf(project: string): RenderVoice {
  const comp = Object.values(readVoiceComp(project));
  if (!existsSync(join(project, 'audio', 'manifest.json')) || !comp.length) return null;
  return comp.some((line) => line.source === 'draft') ? 'draft' : 'final';
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
