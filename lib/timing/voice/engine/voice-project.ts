// voice-project.ts: voices a project's script line by line, each voiced line cut from the take chosen for it (the
// comp). `studio voice` runs it.
//
// The model reads the text verbatim, so direct it with inline tags (`<short pause>`, `<breath>`…), which captions and
// word times leave out; `*word*` and `` `key` `` it never sees.
//
// Contract: a line left unchanged keeps its own audio, duration and pauseBefore; its place in the video still moves
// when an earlier line changes length. A pickup reads the line before it too (cut, never chosen) so the join holds;
// takes join only at clip boundaries, in measured quiet. Every take is kept (voice-takes.ts).
//
// Negative space: the manifest holds voiced lines only; resolveStoryboard estimates the rest.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { measureAudibleLoudness } from '#lib/platform/ffmpeg/engine/loudness.ts';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { releaseStudioLockFile, tryStudioLockFile } from '#lib/platform/files/engine/studio-lock-file.ts';
import { postOpenRouter } from '#lib/platform/paid-generation/engine/openrouter.ts';
import type { RenderVoice } from '../models/render-voice.ts';
import type { RecordedVoiceLine } from '../models/voice-manifest.ts';
import { planVoiceSync, voiceLineStaleReasons, voicePickupsOf, type VoicePickup, type VoiceSettingsNow, type VoiceStaleReason } from '../models/voice-comp.ts';
import { cutTakeIntoLines, pinWordsToTaggedPauses, type TakeClip, type VoiceCompFile, type VoiceScript, type VoiceTakeFile } from '../models/voice-take.ts';
import { alignSpokenWords, captionMarkup, spokenText, ttsText, type SpokenWord } from '../models/voice-words.ts';
import { samplesFromWav, wavFromPcm, wavFromSamples } from '#lib/platform/wav/models/wav.ts';
import { heardWords } from './whisper-words.ts';
import { keepVoiceTake, readVoiceComp, readVoiceTakes, saveKeptVoiceTake, stampChosenVoiceTakes, voiceCompPath, type KeptVoiceTake } from './voice-takes.ts';
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

const settingsNow = (script: VoiceScript): VoiceSettingsNow => ({ tts: { model: MODEL, voice: script.voice, direction: script.direction ?? null }, sayVoice: DRAFT_VOICE });

function scriptLineIds(script: VoiceScript, ids: readonly string[]) {
  const unknown = ids.filter((id) => !script.lines.some((line) => line.id === id));
  if (unknown.length) throw new Error(`there's no line ${unknown.join(', ')}: the lines are ${script.lines.map((line) => line.id).join(', ')}`);
  return script.lines.map((line) => line.id).filter((id) => ids.includes(id));
}

/** The kept takes, and the comp as it stands, each line on its kept take (a line whose take is gone drops out). */
function readComp(project: string, script: VoiceScript) {
  const kept = readVoiceTakes(project), before = readVoiceComp(project);
  const comp = new Map<string, KeptVoiceTake>();
  for (const { id } of script.lines) {
    const take = kept.find((t) => t.number === before[id]?.take);
    if (take) comp.set(id, take);
  }
  return { kept, before, comp };
}

/** Runs `step` holding the project's voice lock, so two voice runs never publish over each other. */
async function withVoiceLock<T>(project: string, step: () => Promise<T>): Promise<T> {
  mkdirSync(join(project, 'audio'), { recursive: true });
  const tried = tryStudioLockFile(join(project, 'audio', 'voice.lock'));
  if ('holder' in tried) throw new Error(`another studio voice (process ${tried.holder.pid}) is working on this project: wait for it`);
  try {
    return await step();
  } finally {
    releaseStudioLockFile(tried.held);
  }
}

/** The script's lines with no take in the comp, in order. */
export function unvoicedVoiceLines(project: string, script: VoiceScript): string[] {
  const comp = readVoiceComp(project);
  return script.lines.map((line) => line.id).filter((id) => !comp[id]);
}

/** What `studio voice sync --dry` prints: the lines it would reuse, the pickups it would read, and why. Changes nothing. */
export function voiceSyncDryRun(project: string, script: VoiceScript, { draft }: { draft: boolean }): string[] {
  const { kept, before } = readComp(project, script);
  const plan = planVoiceSync(script, kept, before, settingsNow(script), draft);
  const out = plan.stale.map(({ id, reasons }) => `${id}: stale (${reasons.join(', ')})`);
  for (const [take, ids] of plan.reused) out.push(`reuse take ${take.number} for ${ids.join(', ')}`);
  for (const { id, take } of plan.oldRecordings) out.push(`${id}: keeps recording take ${take}, which reads an older text`);
  for (const pickup of plan.pickups) out.push(`read ${pickup.lines.map((line) => line.id).join(', ')}${pickup.context ? ` after ${pickup.context.id}` : ''} (${draft ? 'say, free' : 'paid'})`);
  return out.length ? out : ['every line is voiced as it is now: nothing to do'];
}

/**
 * Brings the comp up to the script: a line keeps a kept take that reads it as it is now (a recorded line is kept
 * whatever its text), and the rest are read, a pickup per run. `draft` reads with say. Returns audio/manifest.ts.
 */
export async function syncVoice(project: string, script: VoiceScript, { draft }: { draft: boolean }): Promise<string> {
  return withVoiceLock(project, async () => {
    const { kept, before } = readComp(project, script);
    const plan = planVoiceSync(script, kept, before, settingsNow(script), draft);
    for (const [take, ids] of plan.reused) process.stderr.write(`take ${take.number} reads ${ids.join(', ')} already: using it, nothing paid\n`);
    for (const { id, take } of plan.oldRecordings) process.stderr.write(`line ${id}: its recording (take ${take}) reads an older text; studio voice reread or import replaces it\n`);
    const read = await Promise.all(plan.pickups.map((pickup) => readPickup(project, script, pickup, draft)));
    plan.pickups.forEach((pickup, i) => pickup.lines.forEach((line) => plan.comp.set(line.id, read[i])));
    const unvoiced = script.lines.filter((line) => !plan.comp.has(line.id));
    if (unvoiced.length) throw new Error(`sync left ${unvoiced.map((line) => line.id).join(', ')} unvoiced`);
    return publishVoiceComp(project, script, before, plan.comp);
  });
}

/** Pays for a new read of exactly `ids`, a pickup per run, and chooses it for them. Nothing else changes. */
export async function rereadVoiceLines(project: string, script: VoiceScript, ids: readonly string[]): Promise<string> {
  const wanted = scriptLineIds(script, ids);
  return withVoiceLock(project, async () => {
    const { before, comp } = readComp(project, script);
    const pickups = voicePickupsOf(script, (id) => wanted.includes(id));
    const read = await Promise.all(pickups.map((pickup) => readPickup(project, script, pickup, false)));
    pickups.forEach((pickup, i) => pickup.lines.forEach((line) => comp.set(line.id, read[i])));
    return publishVoiceComp(project, script, before, comp);
  });
}

/** Keeps a recording of exactly `ids`, in script order with no lead-in, as a new take, chosen for them. Never pays. */
export async function importVoiceRecording(project: string, script: VoiceScript, recording: string, ids: readonly string[]): Promise<string> {
  const wanted = scriptLineIds(script, ids);
  return withVoiceLock(project, async () => {
    const { before, comp } = readComp(project, script);
    const lines = script.lines.filter((line) => wanted.includes(line.id)).map((line) => ({ id: line.id, text: line.text, paragraph: line.paragraph ?? false }));
    const take = keepVoiceTake(project, { source: 'recording', lines }, (wav) => runFfmpeg(['-v', 'error', '-y', '-i', recording, '-ac', '1', '-ar', '24000', '-sample_fmt', 's16', '-map_metadata', '-1', wav]));
    process.stderr.write(`imported ${recording} as take ${take.number}, reading ${wanted.join(', ')}\n`);
    for (const id of wanted) comp.set(id, take);
    return publishVoiceComp(project, script, before, comp);
  });
}

/** What `use` chose and left: the lines take n is now chosen for, and those it reads but wasn't, with why. */
export type VoiceTakeUse = { manifest: string; chosen: string[]; skipped: { id: string; reasons: VoiceStaleReason[] }[] };

/**
 * Chooses kept take `number` for `ids` (without, every line it reads as the script is now, never its lead-in), with no
 * paid call. A named line it doesn't read as it is now (a recording: its text) fails before anything changes.
 */
export async function useVoiceTake(project: string, script: VoiceScript, number: number, ids?: readonly string[]): Promise<VoiceTakeUse> {
  const named = ids && scriptLineIds(script, ids);
  return withVoiceLock(project, async () => {
    const { kept, before, comp } = readComp(project, script);
    const take = kept.find((t) => t.number === number);
    if (!take) throw new Error(`there's no take ${number}: the kept takes are ${kept.map((t) => t.number).join(', ') || 'none'}`);
    const now = settingsNow(script);
    const judged = script.lines.filter((line) => (named ? named.includes(line.id) : take.info.lines.some((l) => l.id === line.id)))
      .map((line) => ({ id: line.id, reasons: voiceLineStaleReasons(take.info, line, now) }));
    const refused = judged.filter((line) => line.reasons.length);
    if (named && refused.length) throw new Error(`take ${number} can't be used for ${refused.map((line) => `${line.id} (${line.reasons.join(', ')})`).join(', ')}: studio voice takes <p> <line> lists what can`);
    const chosen = judged.filter((line) => !line.reasons.length).map((line) => line.id);
    if (!chosen.length) throw new Error(`take ${number} reads none of the lines as they are now`);
    for (const id of chosen) comp.set(id, take);
    return { manifest: await publishVoiceComp(project, script, before, comp), chosen, skipped: refused };
  });
}

async function readPickup(project: string, script: VoiceScript, pickup: VoicePickup, draft: boolean) {
  const read = pickup.context ? [pickup.context, ...pickup.lines] : pickup.lines;
  const readText = (paragraphBreak: string) => read.map((line, i) => readBreakBefore(line.paragraph, i, paragraphBreak) + ttsText(line.text)).join('');
  const { wav, duration } = draft ? speakDraft(sayText(readText(SAY_PARAGRAPH))) : await speak(readText('\n\n'), script.voice, script.direction);
  const now = settingsNow(script);
  const info: Omit<VoiceTakeFile, 'madeAt' | 'chosenAt'> = {
    source: draft ? 'draft' : 'tts',
    settings: draft ? { sayVoice: now.sayVoice } : now.tts,
    lines: read.map((line) => ({ id: line.id, text: line.text, paragraph: line.paragraph ?? false })),
  };
  if (pickup.context) info.context = pickup.context.id;
  const take = keepVoiceTake(project, info, (path) => writeFileSync(path, wav));
  const what = pickup.lines.length === script.lines.length ? 'the script' : `${pickup.lines.map((line) => line.id).join(', ')}${pickup.context ? `, after ${pickup.context.id}` : ''}`;
  process.stderr.write(`${draft ? 'drafted' : 'voiced'} take ${take.number} (${what})  ${duration.toFixed(2)}s\n`);
  return take;
}

function readBreakBefore(paragraph: boolean | undefined, i: number, paragraphBreak: string) {
  if (i === 0) return '';
  return paragraph ? paragraphBreak : ' ';
}

/** One kept take, for `studio voice takes`: the lines it reads (`now` false for a stale one) and those it's chosen for. */
export type VoiceTakeListing = {
  number: number; source: VoiceTakeFile['source']; madeAt: string; seconds: number;
  context?: string; lines: { id: string; now: boolean }[]; chosenFor: string[];
};

const takeSeconds = (take: KeptVoiceTake) => {
  const { samples, rate } = samplesFromWav(readFileSync(take.wav));
  return samples.length / rate;
};

/** Every kept take of the project, oldest first. Reads nothing aloud and cuts nothing. */
export function listVoiceTakes(project: string, script: VoiceScript): VoiceTakeListing[] {
  const comp = readVoiceComp(project), now = settingsNow(script);
  return readVoiceTakes(project).map((take) => {
    const listing: VoiceTakeListing = {
      number: take.number, source: take.info.source, madeAt: take.info.madeAt, seconds: takeSeconds(take),
      lines: take.info.lines.filter((line) => line.id !== take.info.context).map((line) => {
        const current = script.lines.find((l) => l.id === line.id);
        return { id: line.id, now: !!current && !voiceLineStaleReasons(take.info, current, now).length };
      }),
      chosenFor: script.lines.map((line) => line.id).filter((id) => comp[id]?.take === take.number),
    };
    if (take.info.context) listing.context = take.info.context;
    return listing;
  });
}

/** One take's read of a line, for `studio voice takes <p> <line>`: whether it can be used for it now, and if not why. */
export type VoiceLineTakeListing = { number: number; source: VoiceTakeFile['source']; madeAt: string; seconds: number; excerpt: string; reasons: VoiceStaleReason[] };

/** The take line `id` is cut from (null while unvoiced), and every kept take that reads it. */
export function listVoiceLineTakes(project: string, script: VoiceScript, id: string): { current: number | null; takes: VoiceLineTakeListing[] } {
  const [lineId] = scriptLineIds(script, [id]);
  const line = script.lines.find((l) => l.id === lineId)!, now = settingsNow(script);
  const takes = readVoiceTakes(project).flatMap((take) => {
    const read = take.info.lines.find((l) => l.id === lineId);
    if (!read) return [];
    const text = spokenText(read.text);
    return [{ number: take.number, source: take.info.source, madeAt: take.info.madeAt, seconds: takeSeconds(take), excerpt: text.length > 48 ? `${text.slice(0, 47)}…` : text, reasons: voiceLineStaleReasons(take.info, line, now) }];
  });
  return { current: readVoiceComp(project)[lineId]?.take ?? null, takes };
}

/**
 * Cuts each take in `comp` into its lines, and publishes each voiced line's clip from its own take, then the manifest,
 * then comp.json. Everything is staged first, so a failure leaves the previous comp, manifest and clips as they were.
 * Returns audio/manifest.ts.
 */
async function publishVoiceComp(project: string, script: VoiceScript, before: VoiceCompFile['lines'], comp: ReadonlyMap<string, KeptVoiceTake>): Promise<string> {
  const dir = join(project, 'audio'), stage = join(dir, `.staging-${randomUUID()}`);
  mkdirSync(stage);
  try {
    const voiced = script.lines.filter((line) => comp.has(line.id));
    const manifest: Record<string, RecordedVoiceLine> = {};
    await Promise.all([...new Set(comp.values())].map((take) => withStudioTemp('voice-cut', async (tmp) => {
      const cut = await cutVoiceTake(project, take, tmp);
      for (const [i, clip] of cut.clips.entries()) {
        if (comp.get(clip.id) !== take) continue;
        const staged = join(stage, `${clip.id}.wav`);
        copyFileSync(cut.files[i], staged);
        manifest[clip.id] = manifestLine(take, i, clip, staged, cut.words[i], cut.rate, clip.id === script.lines[0].id);
      }
    })));
    const ordered = Object.fromEntries(voiced.map((line) => [line.id, manifest[line.id]]));
    const compFile: VoiceCompFile = { lines: Object.fromEntries(voiced.map((line) => [line.id, { take: comp.get(line.id)!.number, source: comp.get(line.id)!.info.source }])) };
    writeFileSync(join(stage, 'manifest.json'), JSON.stringify(ordered, null, 2));
    writeFileSync(join(stage, 'manifest.ts'), voiceManifestModule(ordered));
    writeFileSync(join(stage, 'comp.json'), JSON.stringify(compFile, null, 2));

    // Readers find the least wrong state between renames: new clips under the old manifest, then the new manifest,
    // and comp.json, which names the takes, last.
    for (const line of voiced) {
      const staged = join(stage, `${line.id}.wav`), live = join(dir, `${line.id}.wav`);
      if (!existsSync(live) || !readFileSync(live).equals(readFileSync(staged))) renameSync(staged, live);
    }
    renameSync(join(stage, 'manifest.json'), join(dir, 'manifest.json'));
    renameSync(join(stage, 'manifest.ts'), join(dir, 'manifest.ts'));
    renameSync(join(stage, 'comp.json'), voiceCompPath(project));
    for (const file of readdirSync(dir)) if (file.endsWith('.wav') && !comp.has(basename(file, '.wav'))) rmSync(join(dir, file));
    stampChosenVoiceTakes(project, before, comp);
    const total = Object.values(ordered).reduce((sum, line) => sum + line.duration, 0);
    process.stderr.write(`${voiced.length} lines voiced, ${total.toFixed(1)}s of voice\n`);
    return join(dir, 'manifest.ts');
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

const roundToMs = (x: number) => Math.round(x * 1000) / 1000;

function manifestLine(take: KeptVoiceTake, i: number, clip: TakeClip, file: string, heard: SpokenWord[], rate: number, first: boolean): RecordedVoiceLine {
  const line = take.info.lines[i];
  const text = spokenText(line.text), clipSamples = samplesFromWav(readFileSync(file)).samples;
  const duration = clipSamples.length / rate;
  const aligned = alignSpokenWords(text, heard, duration);
  const words = pinWordsToTaggedPauses(line.text, aligned.words, clipSamples, rate).map((w) => ({ text: w.text, start: roundToMs(w.start), end: roundToMs(w.end) }));
  const pauseBefore = first ? null : clip.pauseBefore;

  const pause = pauseBefore === null ? '' : `  after ${pauseBefore.toFixed(2)}s`;
  const unheard = words.filter((_, k) => !aligned.heard[k]).map((w) => w.text);
  process.stderr.write(`cut ${clip.id} from take ${take.number}  ${duration.toFixed(2)}s${pause}${unheard.length ? `  (misheard, timed from their neighbours: ${unheard.join(' ')})` : ''}\n`);
  const problem = i === 0 ? null : cutProblem(clip);
  if (problem) process.stderr.write(`listen to ${clip.id}: take ${take.number} ${problem} before it, so the cut may be heard. Add <short pause> before it, or move the line break\n`);
  return { src: `audio/${clip.id}.wav`, duration, text, caption: captionMarkup(line.text), paragraph: line.paragraph, words, lufs: measureAudibleLoudness(file).lufs, pauseBefore };
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
 * Whose voice the project's lines are in: `draft` when any was cut from a draft take (macOS say, fine for timing,
 * never for delivery), `final` when all are real reads, null before the first.
 */
export function renderVoiceOf(project: string): RenderVoice {
  const comp = Object.values(readVoiceComp(project));
  if (!existsSync(join(project, 'audio', 'manifest.json')) || !comp.length) return null;
  return comp.some((line) => line.source === 'draft') ? 'draft' : 'final';
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
