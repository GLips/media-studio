// tts.ts: voices a project's script as one take, and cuts it into lines.
//
//   npm run tts -- projects/<name>                       read the whole script with Gemini TTS on OpenRouter
//   node scripts/tts.ts projects/<name> --draft          read it with macOS `say`: free, offline, flat. For hearing
//                                                        the timing, and for test projects. The next paid run re-reads
//   node scripts/tts.ts projects/<name> --take=read.m4a  use a recording of the script (a human read) as the take
//   node scripts/tts.ts projects/<name> --estimate       with no take, time each line from its word count, with no
//                                                        audio, so scenes can be built before the voice exists
//   npm run tts -- --audition "Some line" --voices=Kore,Puck,Achird [--out=auditions]
//
// voiceover.json: { "voice": "Kore", "direction": "optional delivery note",
//                   "lines": [{ "id": "s1", "text": "…", "paragraph": true }] }
// A line with `"paragraph": true` starts a new paragraph of the read; the rest run on from the line before.
//
// The take (audio/take.wav) is one read, so pace and pitch carry across lines. Any change to the script re-reads the
// whole take, since a spliced-in line would stand out. A recording is never replaced: each run re-cuts it, and
// deleting audio/take.wav hands the script back to TTS. whisper.cpp hears the take (free, local; the first run
// installs it), lib/voice-take.ts cuts it, and whisper hears each clip again for word times, since over a whole take
// they drift. audio/manifest.ts is what the video imports.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { measureLoudness } from '../lib/loudness.ts';
import { cutTakeIntoLines } from '../lib/voice-take.ts';
import { alignSpokenWords, estimateSpokenWords, type SpokenWord } from '../lib/voice-words.ts';
import { samplesFromWav, wavFromPcm, wavFromSamples } from '../lib/wav.ts';
import { heardWords } from '../lib/whisper-words.ts';
import { postOpenRouter } from './openrouter.ts';

const MODEL = 'google/gemini-3.8-flash-tts';
const DRAFT_VOICE = 'Samantha';
// Callirrhoe reads about three words a second; estimates only need to be close enough to lay scenes out.
const WORDS_PER_SECOND = 3.0;

type Script = { voice: string; direction?: string; lines: { id: string; text: string; paragraph?: boolean }[] };
/** audio/take.json: where take.wav came from, and what whisper heard in it and its clips, keyed by each WAV's hash. */
type TakeInfo = { source: 'tts' | 'draft' | 'recording'; hash?: string; heard?: Record<string, SpokenWord[]> };
/** A manifest.json entry. `src` is relative to the project, and it, `lufs` and `pauseBefore` are null for an estimate. */
type Voiced = { src: string | null; duration: number; text: string; words: SpokenWord[]; lufs: number | null; pauseBefore: number | null };

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

if (args[0] === '--audition') await audition(args[1], (flag('voices') ?? '').split(','), flag('out') || 'auditions');
else await voiceProject(args[0], args.includes('--estimate') ? 'estimate' : args.includes('--draft') ? 'draft' : 'paid', flag('take'));

async function voiceProject(project: string, mode: 'estimate' | 'draft' | 'paid', recording: string | undefined) {
  const script: Script = JSON.parse(readFileSync(join(project, 'voiceover.json'), 'utf8'));
  const dir = join(project, 'audio');
  mkdirSync(dir, { recursive: true });
  const takePath = join(dir, 'take.wav'), infoPath = join(dir, 'take.json');

  const hashFor = (...key: unknown[]) => createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 16);
  const readText = (paragraphBreak: string) => script.lines.map((line, i) => (i === 0 ? '' : line.paragraph ? paragraphBreak : ' ') + line.text).join('');
  const paidHash = hashFor(MODEL, script.voice, script.direction, readText('\n\n'));
  const draftHash = hashFor('say', DRAFT_VOICE, readText(' [[slnc 600]] '));

  let info: TakeInfo | null = existsSync(infoPath) && existsSync(takePath) ? JSON.parse(readFileSync(infoPath, 'utf8')) : null;
  // take.json is saved as soon as the take is, and after each transcription, so a failure later never costs a re-read
  // or leaves it describing other audio.
  const saveInfo = () => writeFileSync(infoPath, JSON.stringify(info, null, 2));
  if (recording) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', recording, '-ac', '1', '-ar', '24000', '-sample_fmt', 's16', '-map_metadata', '-1', takePath]);
    info = { source: 'recording' };
    saveInfo();
    console.log(`imported ${recording} as the take`);
  }
  // A draft never matches the paid hash, so a paid run re-reads it.
  const current = info && (info.source === 'recording' || info.hash === paidHash || (mode !== 'paid' && info.hash === draftHash));
  if (!current) {
    if (mode === 'estimate') return writeManifest(dir, estimateLines(script));
    const { wav, duration } = mode === 'draft' ? speakDraft(readText(' [[slnc 600]] ')) : await speak(readText('\n\n'), script.voice, script.direction);
    writeFileSync(takePath, wav);
    info = { source: mode === 'draft' ? 'draft' : 'tts', hash: mode === 'draft' ? draftHash : paidHash };
    saveInfo();
    console.log(`${mode === 'draft' ? 'drafted' : 'voiced'} the take  ${duration.toFixed(2)}s`);
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
  const clips = cutTakeIntoLines(script.lines, await hear(takePath), samples, rate);
  for (const file of readdirSync(dir)) if (file.endsWith('.wav') && file !== 'take.wav') rmSync(join(dir, file));
  const manifest: Record<string, Voiced> = {};
  for (const [i, clip] of clips.entries()) {
    const file = join(dir, `${clip.id}.wav`);
    const part = samples.subarray(Math.round(clip.from * rate), Math.round(clip.to * rate));
    writeFileSync(file, wavFromSamples(part, rate));
    const duration = part.length / rate, text = script.lines[i].text;
    const aligned = alignSpokenWords(text, await hear(file), duration);
    const round = (x: number) => Math.round(x * 1000) / 1000;
    const words = aligned.words.map((w) => ({ text: w.text, start: round(w.start), end: round(w.end) }));
    manifest[clip.id] = { src: `audio/${clip.id}.wav`, duration, text, words, lufs: measureLoudness(file).lufs, pauseBefore: clip.pauseBefore };

    const pause = clip.pauseBefore === null ? '' : `  after ${clip.pauseBefore.toFixed(2)}s`;
    const unheard = words.filter((_, k) => !aligned.heard[k]).map((w) => w.text);
    console.log(`cut ${clip.id}  ${duration.toFixed(2)}s${pause}${unheard.length ? `  (heard differently: ${unheard.join(' ')})` : ''}`);
  }
  for (const clip of clips.filter((c) => !c.cutIsClear)) {
    console.log(`listen to ${clip.id}: the read has no one clear pause before it, so its cut may clip a word. Give it "paragraph": true, or move the line break`);
  }
  for (const key of Object.keys(heard)) if (!used.has(key)) delete heard[key];
  saveInfo();
  writeManifest(dir, manifest);
}

function estimateLines(script: Script) {
  const manifest: Record<string, Voiced> = {};
  for (const line of script.lines) {
    const duration = Number((line.text.split(/[\s-]+/).length / WORDS_PER_SECOND + 0.3).toFixed(2));
    manifest[line.id] = { src: null, duration, text: line.text, words: estimateSpokenWords(line.text, duration), lufs: null, pauseBefore: null };
  }
  console.log(`estimated ${script.lines.length} lines from their word counts`);
  return manifest;
}

function writeManifest(dir: string, manifest: Record<string, Voiced>) {
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'manifest.ts'), voiceModule(manifest));
  const total = Object.values(manifest).reduce((sum, line) => sum + line.duration, 0);
  console.log(`${Object.keys(manifest).length} lines, ${total.toFixed(1)}s of voice → ${dir}`);
}

// A module rather than JSON so the video imports each WAV and the bundler serves it.
function voiceModule(manifest: Record<string, Voiced>) {
  const ids = Object.keys(manifest);
  const imports = ids.flatMap((id, i) => {
    const { src } = manifest[id];
    return src ? [`import wav${i} from './${basename(src)}';`] : [];
  }).join('\n');
  const entries = ids.map((id, i) => {
    const { src, duration, text, words, lufs, pauseBefore } = manifest[id];
    return `  ${JSON.stringify(id)}: { src: ${src ? `wav${i}` : 'null'}, duration: ${duration}, lufs: ${lufs}, pauseBefore: ${pauseBefore}, text: ${JSON.stringify(text)},\n    words: ${JSON.stringify(words)} },`;
  }).join('\n');
  return `// Written by scripts/tts.ts. Edits here are lost on the next run.
import type { Voice } from '../../../lib/studio/timeline.ts';
${imports}

export const voice = {
${entries}
} as const satisfies Voice;
`;
}

async function audition(text: string, voices: string[], out: string) {
  mkdirSync(out, { recursive: true });
  for (const voice of voices) {
    const { wav, duration } = await speak(text, voice);
    const file = join(out, `${voice}.wav`);
    writeFileSync(file, wav);
    console.log(`${voice}  ${duration.toFixed(2)}s → ${file}`);
  }
}

async function speak(text: string, voice: string, direction?: string) {
  // Gemini TTS takes delivery notes in the prompt itself, as a leading instruction it doesn't read aloud.
  const input = direction ? `${direction}: ${text}` : text;
  const response = await postOpenRouter('/audio/speech', { model: MODEL, input, voice, response_format: 'pcm' });
  const pcm = Buffer.from(await response.arrayBuffer());
  const rate = Number(/rate=(\d+)/.exec(response.headers.get('content-type') || '')?.[1] || 24000);
  return { wav: wavFromPcm(pcm, rate), duration: pcm.length / (rate * 2) };
}

// `[[slnc 600]]` in the text is say's own pause command, standing in for a paragraph break.
function speakDraft(text: string) {
  const tmp = mkdtempSync(join(tmpdir(), 'say-'));
  const out = join(tmp, 'take.wav');
  execFileSync('say', ['-v', DRAFT_VOICE, '-o', out, '--data-format=LEI16@24000', text]);
  const wav = readFileSync(out);
  rmSync(tmp, { recursive: true, force: true });
  const { samples, rate } = samplesFromWav(wav);
  return { wav, duration: samples.length / rate };
}
