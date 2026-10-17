// voice-project.ts: voices a project's script as one take, and cuts it into lines. `studio voice` runs it.
//
// The script is the storyboard's `voice` and lines, in plan order; `paragraph: true` starts a new paragraph of the
// read. The model reads the text verbatim, so direct it with its inline tags (`<short pause>`, `<breath>`…), which
// captions and word times leave out. `*word*` (emphasis) and `` `key` `` (a keycap) it never sees.
//
// The take is one read, so any change to the script re-reads it whole: a spliced-in line would stand out. A
// recording is never replaced: deleting audio/take.wav hands the script back to TTS.
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
import { cutTakeIntoLines, type TakeClip, type VoiceTakeFile } from '../models/voice-take.ts';
import { alignSpokenWords, captionMarkup, spokenText, ttsText, type SpokenWord } from '../models/voice-words.ts';
import { samplesFromWav, wavFromPcm, wavFromSamples } from '#lib/platform/wav/models/wav.ts';
import { heardWords } from './whisper-words.ts';
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

/** What one take reads: the voice, and every line in plan order (a storyboard's, by readProjectVoiceScript). */
export type VoiceScript = { voice: string; lines: readonly { id: string; text: string; paragraph?: boolean }[] };
type ScriptLine = { id: string; text: string; caption: string; paragraph: boolean };

/**
 * How to get the take: `paid` reads it with Gemini TTS (needs OPENROUTER_API_KEY), `draft` with macOS `say` (free,
 * flat; the next paid run re-reads it).
 */
export type VoiceMode = 'draft' | 'paid';

const hashFor = (...key: unknown[]) => createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 16);

/** Voices `script` for the project and returns the path of the audio/manifest.ts it wrote. `recording` imports a human read as the take. */
export async function voiceStudioProject(project: string, script: VoiceScript, { mode, recording }: { mode: VoiceMode; recording?: string }): Promise<string> {
  const dir = join(project, 'audio');
  mkdirSync(dir, { recursive: true });
  const takePath = join(dir, 'take.wav'), infoPath = join(dir, 'take.json');

  const readText = (paragraphBreak: string) => script.lines.map((line, i) => (i === 0 ? '' : line.paragraph ? paragraphBreak : ' ') + ttsText(line.text)).join('');
  const paidHash = hashFor(MODEL, script.voice, readText('\n\n'));
  const draftHash = hashFor('say', DRAFT_VOICE, sayText(readText(SAY_PARAGRAPH)));
  const lines: ScriptLine[] = script.lines.map((line) => ({ id: line.id, text: spokenText(line.text), caption: captionMarkup(line.text), paragraph: line.paragraph ?? false }));

  // SAFETY: take.json is written only by this function, from a VoiceTakeFile.
  let info: VoiceTakeFile | null = existsSync(infoPath) && existsSync(takePath) ? JSON.parse(readFileSync(infoPath, 'utf8')) as VoiceTakeFile : null;
  // take.json is saved as soon as the take is, and after each transcription, so a failure later never costs a re-read
  // or leaves it describing other audio.
  const saveInfo = () => writeFileSync(infoPath, JSON.stringify(info, null, 2));
  if (recording) {
    runFfmpeg(['-v', 'error', '-y', '-i', recording, '-ac', '1', '-ar', '24000', '-sample_fmt', 's16', '-map_metadata', '-1', takePath]);
    info = { source: 'recording' };
    saveInfo();
    console.error(`imported ${recording} as the take`);
  }
  // A draft never matches the paid hash, so a paid run re-reads it.
  const current = info && (info.source === 'recording' || info.hash === paidHash || (mode !== 'paid' && info.hash === draftHash));
  if (!current) {
    const { wav, duration } = mode === 'draft' ? speakDraft(sayText(readText(SAY_PARAGRAPH))) : await speak(readText('\n\n'), script.voice);
    writeFileSync(takePath, wav);
    info = { source: mode === 'draft' ? 'draft' : 'tts', hash: mode === 'draft' ? draftHash : paidHash };
    saveInfo();
    console.error(`${mode === 'draft' ? 'drafted' : 'voiced'} the take  ${duration.toFixed(2)}s`);
  }

  const heard = (info!.heard ??= {});
  const used = new Set<string>();
  const hear = async (file: string) => {
    const key = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
    used.add(key);
    if (!heard[key]) {
      heard[key] = await heardWords(file);
      saveInfo();
    }
    return heard[key];
  };

  const { samples, rate } = samplesFromWav(readFileSync(takePath));
  const clipFile = (id: string) => join(dir, `${id}.wav`);
  for (const file of readdirSync(dir)) if (file.endsWith('.wav') && file !== 'take.wav') rmSync(join(dir, file));
  // Whisper drifts over a whole take (by a second, at worst), but not over one clip. So each round cuts with the best
  // word times so far and hears every clip, and the clips' words, placed back in the take, time the next round's cuts.
  // It stops once the cuts stop moving.
  let takeWords = await hear(takePath);
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
    const duration = samplesFromWav(readFileSync(file)).samples.length / rate;
    const aligned = alignSpokenWords(text, clipWords[i], duration);
    const round = (x: number) => Math.round(x * 1000) / 1000;
    const words = aligned.words.map((w) => ({ text: w.text, start: round(w.start), end: round(w.end) }));
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
  saveInfo();
  return writeManifest(dir, manifest);
}

/**
 * Whose voice the project's lines are in: `draft` when they were cut from a `--read=draft` take (macOS say, fine for
 * timing, never for delivery), `final` for a real take, null before the first take.
 */
export function renderVoiceOf(project: string): RenderVoice {
  const manifestPath = join(project, 'audio', 'manifest.json'), infoPath = join(project, 'audio', 'take.json');
  if (!existsSync(manifestPath) || !existsSync(infoPath)) return null;
  // SAFETY: take.json is written only by voiceStudioProject, from a VoiceTakeFile.
  const info = JSON.parse(readFileSync(infoPath, 'utf8')) as VoiceTakeFile;
  return info.source === 'draft' ? 'draft' : 'final';
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

async function speak(text: string, voice: string) {
  const response = await postOpenRouter('/audio/speech', { model: MODEL, input: text, voice, response_format: 'pcm' });
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
