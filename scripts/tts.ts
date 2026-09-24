// tts.ts: voices a project's lines with Gemini TTS on OpenRouter.
//
//   npm run tts -- projects/<name>                       voice every line in voiceover.json → audio/
//   node scripts/tts.ts projects/<name> --estimate       time unvoiced lines from their word count, with no audio,
//                                                        so scenes can be built and rendered before the voice exists
//   npm run tts -- --audition "Some line" --voices=Kore,Puck,Achird [--out=auditions]
//
// voiceover.json: { "voice": "Kore", "direction": "optional delivery note", "lines": [{ "id": "s1", "text": "…" }] }
//
// Each line is its own WAV, so the timeline can time scenes to the voice and captions to each line. A line is only
// re-voiced when its text, voice or direction changes; the rest come from audio/manifest.json, since every call bills.
// Every voiced line is also run through whisper.cpp for when each word is spoken (free, local; the first run installs
// it). audio/manifest.ts is what the video imports.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { measureLoudness } from '../lib/loudness.ts';
import { alignSpokenWords, estimateSpokenWords, type SpokenWord } from '../lib/voice-words.ts';
import { heardWords } from '../lib/whisper-words.ts';
import { postOpenRouter } from './openrouter.ts';

const MODEL = 'google/gemini-3.8-flash-tts';
// Callirrhoe reads about three words a second; estimates only need to be close enough to lay scenes out.
const WORDS_PER_SECOND = 3.0;

type Script = { voice: string; direction?: string; lines: { id: string; text: string; voice?: string; direction?: string }[] };
/** A manifest.json entry. `src` is relative to the project; null for an estimated line. */
/** `lufs` is null for an estimated line, which has no audio to measure. */
type Voiced = { src: string | null; duration: number; hash: string | null; text: string; words: SpokenWord[]; lufs: number | null };

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

if (args[0] === '--audition') await audition(args[1], (flag('voices') ?? '').split(','), flag('out') || 'auditions');
else await voiceProject(args[0], args.includes('--estimate'));

async function voiceProject(project: string, estimate: boolean) {
  const script: Script = JSON.parse(readFileSync(join(project, 'voiceover.json'), 'utf8'));
  const dir = join(project, 'audio');
  mkdirSync(dir, { recursive: true });

  const manifestPath = join(dir, 'manifest.json');
  const previous: Record<string, Voiced> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const manifest: Record<string, Voiced> = {};

  for (const line of script.lines) {
    const voice = line.voice || script.voice;
    const direction = line.direction ?? script.direction;
    const hash = createHash('sha256').update(JSON.stringify([MODEL, voice, direction, line.text])).digest('hex').slice(0, 16);
    const file = `${line.id}.wav`;

    const cached = previous[line.id];
    if (cached?.hash === hash && existsSync(join(dir, file))) {
      const wav = join(project, cached.src!);
      manifest[line.id] = { ...cached, words: cached.words ?? await wordsFor(wav, line.text, cached.duration), lufs: cached.lufs ?? measureLoudness(wav).lufs };
      continue;
    }
    if (estimate) {
      // No hash, so the next real run voices it.
      const duration = Number((line.text.split(/\s+/).length / WORDS_PER_SECOND + 0.3).toFixed(2));
      manifest[line.id] = { src: null, duration, hash: null, text: line.text, words: estimateSpokenWords(line.text, duration), lufs: null };
      console.log(`estimated ${line.id}  ${duration.toFixed(2)}s`);
      continue;
    }

    const { wav, duration } = await speak(line.text, voice, direction);
    writeFileSync(join(dir, file), wav);
    manifest[line.id] = { src: `audio/${file}`, duration, hash, text: line.text, words: await wordsFor(join(dir, file), line.text, duration), lufs: measureLoudness(join(dir, file)).lufs };
    console.log(`voiced ${line.id}  ${duration.toFixed(2)}s  "${line.text.slice(0, 60)}"`);
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'manifest.ts'), voiceModule(manifest));
  const total = Object.values(manifest).reduce((sum, line) => sum + line.duration, 0);
  console.log(`${script.lines.length} lines, ${total.toFixed(1)}s of voice → ${dir}`);
}

async function wordsFor(wav: string, text: string, duration: number) {
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return alignSpokenWords(text, await heardWords(wav), duration).map((w) => ({ text: w.text, start: round(w.start), end: round(w.end) }));
}

// A module rather than JSON so the video imports each WAV and the bundler serves it.
function voiceModule(manifest: Record<string, Voiced>) {
  const ids = Object.keys(manifest);
  const imports = ids.flatMap((id, i) => {
    const { src } = manifest[id];
    return src ? [`import wav${i} from './${basename(src)}';`] : [];
  }).join('\n');
  const entries = ids.map((id, i) => {
    const { src, duration, text, words, lufs } = manifest[id];
    return `  ${JSON.stringify(id)}: { src: ${src ? `wav${i}` : 'null'}, duration: ${duration}, lufs: ${lufs}, text: ${JSON.stringify(text)},\n    words: ${JSON.stringify(words)} },`;
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

// Gemini returns headerless 16-bit mono PCM; ffmpeg and browsers both want a WAV header on it.
function wavFromPcm(pcm: Buffer, rate: number) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
