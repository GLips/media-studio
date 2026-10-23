// voice-project.ts: voices a project's script line by line, each voiced line cut from the take chosen for it (the
// comp). `studio voice` runs it. The model reads the text verbatim: direct it with inline tags (`<short pause>`…).
//
// Contract: a line left unchanged keeps its own audio, duration and pauseBefore; its place in the video still moves
// when an earlier line changes length. A pickup reads the lines around it too (cut, never chosen) for its lead-in
// and ending intonation; takes join only at clip boundaries, in measured quiet, with a warning where they'd be heard
// apart (voice-drift.ts). Every take is kept (voice-takes.ts); a run publishes one generation (voice-generations.ts).
//
// Negative space: the manifest holds voiced lines only; resolveStoryboard estimates the rest.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { measureAudibleLoudness } from '#lib/platform/ffmpeg/engine/loudness.ts';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { replaceFileWhole } from '#lib/platform/files/engine/replace-file-whole.ts';
import { releaseStudioLockFile, tryStudioLockFile } from '#lib/platform/files/engine/studio-lock-file.ts';
import { postOpenRouter } from '#lib/platform/paid-generation/engine/openrouter.ts';
import type { RenderVoice } from '../models/render-voice.ts';
import type { RecordedVoiceLine } from '../models/voice-manifest.ts';
import { isVoiceContextLine, planVoiceSync, voiceContextPhrase, voiceLineStaleReasons, voicePickupsOf, type VoicePickup, type VoiceSettingsNow, type VoiceStaleReason } from '../models/voice-comp.ts';
import { measureVoiceClip, voiceDrift, type VoiceClipMeasure } from '../models/voice-drift.ts';
import { cutTakeIntoLines, pinWordsToTaggedPauses, type TakeClip, type VoiceCompFile, type VoiceScript, type VoiceTakeFile, type VoiceTakeLine } from '../models/voice-take.ts';
import { alignSpokenWords, captionMarkup, scriptWords, spokenText, ttsText, type SpokenWord } from '../models/voice-words.ts';
import { samplesFromWav, wavFromPcm, wavFromSamples } from '#lib/platform/wav/models/wav.ts';
import { heardWords } from './whisper-words.ts';
import { publishVoiceGeneration, readVoiceComp, sweepVoiceGenerations } from './voice-generations.ts';
import { keepVoiceTake, readVoiceTakes, saveKeptVoiceTake, stampChosenVoiceTakes, type KeptVoiceTake } from './voice-takes.ts';
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
    sweepVoiceGenerations(project);
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
  for (const pickup of plan.pickups) out.push(`read ${[pickup.lines.map((line) => line.id).join(', '), voiceContextPhrase(pickupContext(pickup))].filter(Boolean).join(' ')} (${draft ? 'say, free' : 'paid'})`);
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
    const read = await settleAll(plan.pickups.map((pickup) => readPickup(project, script, pickup, draft)));
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
    const read = await settleAll(pickups.map((pickup) => readPickup(project, script, pickup, false)));
    pickups.forEach((pickup, i) => pickup.lines.forEach((line) => comp.set(line.id, read[i])));
    return publishVoiceComp(project, script, before, comp);
  });
}

/** Keeps a recording of exactly `ids`, in script order with no context around them, as a new take, chosen for them. Never pays. */
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
 * Chooses kept take `number` for `ids` (without, every line it reads as the script is now, never its context), with no
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

const pickupContext = ({ before, after }: VoicePickup) => (before || after ? { ...(before && { before: before.id }), ...(after && { after: after.id }) } : undefined);

async function readPickup(project: string, script: VoiceScript, pickup: VoicePickup, draft: boolean) {
  const read = [pickup.before, ...pickup.lines, pickup.after].filter((line) => line !== undefined);
  const readText = (paragraphBreak: string) => read.map((line, i) => readBreakBefore(line.paragraph, i, paragraphBreak) + ttsText(line.text)).join('');
  const { wav, duration } = draft ? speakDraft(sayText(readText(SAY_PARAGRAPH))) : await speak(readText('\n\n'), script.voice, script.direction);
  const now = settingsNow(script);
  const info: Omit<VoiceTakeFile, 'madeAt' | 'chosenAt'> = {
    source: draft ? 'draft' : 'tts',
    settings: draft ? { sayVoice: now.sayVoice } : now.tts,
    lines: read.map((line) => ({ id: line.id, text: line.text, paragraph: line.paragraph ?? false })),
  };
  const context = pickupContext(pickup);
  if (context) info.context = context;
  const take = keepVoiceTake(project, info, (path) => writeFileSync(path, wav));
  const what = pickup.lines.length === script.lines.length ? 'the script' : [pickup.lines.map((line) => line.id).join(', '), voiceContextPhrase(context)].filter(Boolean).join(', ');
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
  /** "between a and d": the lines it read around its run, never chosen. */
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
      lines: take.info.lines.filter((line) => !isVoiceContextLine(take.info.context, line.id)).map((line) => {
        const current = script.lines.find((l) => l.id === line.id);
        return { id: line.id, now: !!current && !voiceLineStaleReasons(take.info, current, now).length };
      }),
      chosenFor: script.lines.map((line) => line.id).filter((id) => comp[id]?.take === take.number),
    };
    if (take.info.context) listing.context = voiceContextPhrase(take.info.context);
    return listing;
  });
}

/**
 * One take's read of a line, for `studio voice takes <p> <line>`: whether it can be used for it now (if not, why), and
 * for one that can, how it would be heard against the takes the line's neighbours are cut from (voiceJoinDrift).
 */
export type VoiceLineTakeListing = { number: number; source: VoiceTakeFile['source']; madeAt: string; seconds: number; excerpt: string; reasons: VoiceStaleReason[]; drift: string[] };

/**
 * The take line `id` is cut from (null while unvoiced), and every kept take that reads it. The takes joined are cut to
 * measure them: whisper's hearing is kept on each take, so that's free after its first cut.
 */
export async function listVoiceLineTakes(project: string, script: VoiceScript, id: string): Promise<{ current: number | null; takes: VoiceLineTakeListing[] }> {
  const [lineId] = scriptLineIds(script, [id]);
  const line = script.lines.find((l) => l.id === lineId)!, now = settingsNow(script);
  const { kept, comp } = readComp(project, script);
  const listed = kept.filter((take) => take.info.lines.some((l) => l.id === lineId)).map((take) => {
    const text = spokenText(take.info.lines.find((l) => l.id === lineId)!.text), reasons = voiceLineStaleReasons(take.info, line, now);
    const joins = reasons.length ? [] : voiceJoinsOf(script, (other) => (other === lineId ? take : comp.get(other)), (l) => l === lineId);
    return { take, text, reasons, joins };
  });
  const drift = await voiceJoinDrift(project, listed.flatMap((t) => t.joins));
  let next = 0;
  const takes = listed.map(({ take, text, reasons, joins }) => ({
    number: take.number, source: take.info.source, madeAt: take.info.madeAt, seconds: takeSeconds(take),
    excerpt: text.length > 48 ? `${text.slice(0, 47)}…` : text, reasons,
    drift: drift.slice(next, (next += joins.length)).filter((said) => said !== null),
  }));
  return { current: comp.get(lineId)?.number ?? null, takes };
}

/**
 * Cuts each take in `comp` into its lines, keeps each voiced line's clip from its own take in audio/clips/ under its
 * bytes' hash, then publishes the manifest and comp as one generation. A failure leaves the voice as it was. Returns
 * audio/manifest.ts.
 */
async function publishVoiceComp(project: string, script: VoiceScript, before: VoiceCompFile['lines'], comp: ReadonlyMap<string, KeptVoiceTake>): Promise<string> {
  const dir = join(project, 'audio');
  mkdirSync(join(dir, 'clips'), { recursive: true });
  const voiced = script.lines.filter((line) => comp.has(line.id));
  const manifest: Record<string, RecordedVoiceLine> = {};
  await settleAll([...new Set(comp.values())].map((take) => withStudioTemp('voice-cut', async (tmp) => {
    const cut = await cutVoiceTake(project, take, tmp);
    if (take.info.context && runOfTake(take).some((line) => comp.get(line.id) === take)) checkPickupJoins(project, take, cut);
    for (const [i, clip] of cut.clips.entries()) {
      if (comp.get(clip.id) !== take) continue;
      manifest[clip.id] = manifestLine(take, i, clip, keepVoiceClip(dir, clip.id, cut.files[i]), cut.words[i], cut.rate, clip.id === script.lines[0].id);
    }
  })));
  const ordered = Object.fromEntries(voiced.map((line) => [line.id, manifest[line.id]]));
  const compFile: VoiceCompFile = { lines: Object.fromEntries(voiced.map((line) => [line.id, { take: comp.get(line.id)!.number, source: comp.get(line.id)!.info.source }])) };
  publishVoiceGeneration(project, {
    'manifest.json': JSON.stringify(ordered, null, 2),
    'manifest.ts': voiceManifestModule(ordered, voiceReadOf(compFile.lines)),
    'comp.json': JSON.stringify(compFile, null, 2),
  });
  stampChosenVoiceTakes(project, before, comp);
  // Each join between takes once, from the newer take's line: the read just made, heard against what it joins.
  const joins = voiceJoinsOf(script, (id) => comp.get(id), (id, neighbour) => comp.get(id)!.number > comp.get(neighbour)!.number);
  (await voiceJoinDrift(project, joins)).forEach((said, i) => said && process.stderr.write(`listen to ${joins[i].id}: ${said}\n`));
  const total = Object.values(ordered).reduce((sum, line) => sum + line.duration, 0);
  process.stderr.write(`${voiced.length} lines voiced, ${total.toFixed(1)}s of voice\n`);
  return join(dir, 'manifest.ts');
}

/**
 * Where a line on `take` meets a neighbour on `other`, a different take, and the line both read to compare them on:
 * the neighbour, when `take` read it (a pickup always reads its neighbours), else the line itself, when `other` did.
 */
type VoiceJoin = { id: string; side: 'before' | 'after'; neighbour: string; take: KeptVoiceTake; other: KeptVoiceTake; on: string };

const readsLine = (take: KeptVoiceTake, id: string) => take.info.lines.some((line) => line.id === id);

/** Each join between takes in the comp `takeOf` gives (undefined for an unvoiced line), from the lines `from` picks. */
function voiceJoinsOf(script: VoiceScript, takeOf: (id: string) => KeptVoiceTake | undefined, from: (id: string, neighbour: string) => boolean): VoiceJoin[] {
  return script.lines.flatMap(({ id }, at) => ([[script.lines[at - 1], 'before'], [script.lines[at + 1], 'after']] as const).flatMap(([line, side]) => {
    const take = takeOf(id), other = line && takeOf(line.id);
    if (!take || !other || take === other || !from(id, line.id)) return [];
    const on = [line.id, id].find((both) => readsLine(take, both) && readsLine(other, both));
    return on ? [{ id, side, neighbour: line.id, take, other, on }] : [];
  }));
}

/**
 * What a listener would hear at each join, by voiceDrift on the line both takes read; null where nothing. Cuts each
 * take involved once, to measure the lines it's compared on.
 */
async function voiceJoinDrift(project: string, joins: readonly VoiceJoin[]): Promise<(string | null)[]> {
  const wanted = new Map<KeptVoiceTake, Set<string>>();
  for (const { take, other, on } of joins) for (const read of [take, other]) wanted.set(read, (wanted.get(read) ?? new Set()).add(on));
  const measured = new Map<string, VoiceClipMeasure>();
  await settleAll([...wanted].map(([take, ids]) => withStudioTemp('voice-drift', async (tmp) => {
    const cut = await cutVoiceTake(project, take, tmp);
    cut.clips.forEach((clip, i) => {
      if (!ids.has(clip.id)) return;
      const { samples, rate } = samplesFromWav(readFileSync(cut.files[i]));
      measured.set(`${take.number}:${clip.id}`, measureVoiceClip(spokenText(take.info.lines[i].text), samples, rate));
    });
  })));
  return joins.map(({ side, neighbour, take, other, on }) => {
    const drift = voiceDrift(measured.get(`${take.number}:${on}`)!, measured.get(`${other.number}:${on}`)!);
    return drift.length ? `${neighbour}, ${side} it, is from take ${other.number}, and take ${take.number} reads ${on} ${drift.join(' and ')} than take ${other.number} does` : null;
  });
}

/**
 * Keeps a clip as audio/clips/<line>-<hash>.wav, named by its bytes and never written over, so a generation a reader
 * holds finds its clips while it's kept (sweepVoiceGenerations). Returns its path.
 */
function keepVoiceClip(dir: string, id: string, file: string) {
  const bytes = readFileSync(file);
  const path = join(dir, 'clips', `${id}-${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.wav`);
  if (!existsSync(path)) replaceFileWhole(path, bytes);
  return path;
}

/** The lines a take reads for itself, without its context. */
const runOfTake = (take: KeptVoiceTake) => take.info.lines.filter((line) => !isVoiceContextLine(take.info.context, line.id));

/** A pickup's joins must be clean to publish any of its lines: both sides held as contextJoinProblems holds them. */
function checkPickupJoins(project: string, take: KeptVoiceTake, cut: { clips: TakeClip[]; words: SpokenWord[][] }) {
  const { before, after } = take.info.context ?? {}, lines = take.info.lines, run = runOfTake(take);
  const firstAt = before ? 1 : 0, lastAt = lines.length - (after ? 2 : 1);
  const problems = [
    ...(before ? contextJoinProblems(lines[0], lines[firstAt], cut.words[0], cut.words[firstAt], cut.clips[firstAt], 'before') : []),
    ...(after ? contextJoinProblems(lines.at(-1)!, lines[lastAt], cut.words.at(-1)!, cut.words[lastAt], cut.clips.at(-1)!, 'after') : []),
  ];
  if (!problems.length) return;
  const ids = run.map((line) => line.id);
  throw new Error(`take ${take.number} reads ${ids.join(', ')} ${voiceContextPhrase(take.info.context)}, but ${problems.join('; ')}, so nothing was published. The take is kept; read it again with studio voice reread ${basename(project)} ${ids.join(' ')}`);
}

// Words and their hyphen pieces back to front: an alignment pairs from the end, so aligning mirrored words pairs from the start.
const mirrorWord = (word: string) => word.split('-').toReversed().join('-');
const mirroredText = (text: string) => scriptWords(text).toReversed().map(mirrorWord).join(' ');
const mirroredHeard = (heard: readonly SpokenWord[]) => heard.toReversed().map((w) => ({ text: mirrorWord(w.text), start: w.start, end: w.end }));

/**
 * A context line's join with the run is clean with a clear cut at least TIGHT_PAUSE long, every word of the context in
 * its own clip, and none in the line's. The line's clip is aligned to both lines from the context's side, so a word
 * repeated at the join goes to the line.
 */
function contextJoinProblems(context: VoiceTakeLine, line: VoiceTakeLine, contextHeard: SpokenWord[], lineHeard: SpokenWord[], cutClip: TakeClip, side: 'before' | 'after'): string[] {
  const cutAt = side === 'before' ? `the cut after ${context.id}` : `the cut before ${context.id}`;
  const text = spokenText(context.text), words = scriptWords(text), own = spokenText(line.text);
  const inContext = alignSpokenWords(text, contextHeard, 0).paired;
  const inLine = side === 'before'
    ? alignSpokenWords(`${text} ${own}`, lineHeard, 0).heard.slice(0, words.length)
    : alignSpokenWords(mirroredText(`${own} ${text}`), mirroredHeard(lineHeard), 0).heard.slice(0, words.length).toReversed();
  const missing = words.filter((_, k) => !inContext[k]), leaked = words.filter((_, k) => inLine[k]);
  return [
    !cutClip.cutIsClear && `${cutAt} is in no one clear pause`,
    cutClip.cutPause < TIGHT_PAUSE && `${cutAt} is in only ${Math.round(cutClip.cutPause * 1000)} ms of quiet`,
    missing.length && `${context.id} was heard without ${missing.join(' ')}`,
    leaked.length && `${line.id}'s clip holds ${leaked.join(' ')} of ${context.id}`,
  ].filter((problem) => typeof problem === 'string');
}

/** Awaits every one of `work`, so none outlives the caller, then throws if any failed. */
async function settleAll<T>(work: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(work);
  const failures = settled.flatMap((result) => (result.status === 'rejected' ? [result.reason instanceof Error ? result.reason : new Error(String(result.reason))] : []));
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new Error(failures.map((failure) => failure.message).join('\n'));
  return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
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
  return { src: `audio/clips/${basename(file)}`, duration, text, caption: captionMarkup(line.text), paragraph: line.paragraph, words, lufs: measureAudibleLoudness(file).lufs, pauseBefore };
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

/** `draft` when any line of `comp` is cut from a draft take (macOS say, fine for timing, never for delivery), null for none. */
const voiceReadOf = (comp: VoiceCompFile['lines']): RenderVoice => {
  const lines = Object.values(comp);
  if (!lines.length) return null;
  return lines.some((line) => line.source === 'draft') ? 'draft' : 'final';
};

/** Whose voice the project's current generation is in (voiceReadOf), for a render's snapshot and warnings. */
export const renderVoiceOf = (project: string): RenderVoice => voiceReadOf(readVoiceComp(project));

/**
 * A generation's manifest.ts, for `manifest` cut from a comp read as `voiceRead`: a module rather than JSON, so the
 * video imports each WAV and the bundler serves it. Its imports reach audio/clips/ from audio/generations/<hash>/.
 * `studio new` writes one with no lines, and so no imports, as audio/manifest.ts itself.
 */
export function voiceManifestModule(manifest: Record<string, RecordedVoiceLine>, voiceRead: RenderVoice) {
  const ids = Object.keys(manifest);
  const imports = ids.map((id, i) => `import wav${i} from '../../${manifest[id].src.replace(/^audio\//, '')}';`).join('\n');
  const entries = ids.map((id, i) => {
    const { duration, text, caption, paragraph, words, lufs, pauseBefore } = manifest[id];
    return `  ${JSON.stringify(id)}: { src: wav${i}, duration: ${duration}, lufs: ${lufs}, pauseBefore: ${pauseBefore}, paragraph: ${paragraph},\n    text: ${JSON.stringify(text)},\n    caption: ${JSON.stringify(caption)},\n    words: ${JSON.stringify(words)} },`;
  }).join('\n');
  return `// Written by \`studio voice\`. Edits here are lost on the next run.
import type { RenderVoice } from '#lib/timing/voice/models/render-voice.ts';
import type { RecordedVoice } from '#lib/timing/voice/models/voice-manifest.ts';
${imports && `${imports}\n`}
export const voice = {${entries && `\n${entries}\n`}} as const satisfies RecordedVoice;
export const voiceRead: RenderVoice = ${JSON.stringify(voiceRead)};
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
