// tts.mjs: voices a project's lines with Gemini TTS on OpenRouter.
//
//   npm run tts -- projects/<name>                       voice every line in voiceover.json → audio/
//   node scripts/tts.mjs projects/<name> --dry           only refresh audio/script.js (no API calls, no key needed)
//   node scripts/tts.mjs projects/<name> --estimate      time unvoiced lines from their word count, with no audio,
//                                                        so scenes can be built and rendered before the voice exists
//   npm run tts -- --audition "Some line" --voices=Kore,Puck,Achird [--out=auditions]
//
// voiceover.json: { "voice": "Kore", "direction": "optional delivery note", "lines": [{ "id": "s1", "text": "…" }] }
//
// Each line is its own WAV, so a studio can time scenes to the voice and captions to each line. A line is only
// re-voiced when its text, voice or direction changes; the rest come from audio/manifest.json, since every call bills.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { postOpenRouter } from './openrouter.mjs';

const MODEL = 'google/gemini-3.8-flash-tts';
// Callirrhoe reads about three words a second; estimates only need to be close enough to lay scenes out.
const WORDS_PER_SECOND = 3.0;

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

if (args[0] === '--audition') await audition(args[1], flag('voices').split(','), flag('out') || 'auditions');
else await voiceProject(args[0], args.includes('--dry'), args.includes('--estimate'));

async function voiceProject(project, dry, estimate) {
  const script = JSON.parse(readFileSync(join(project, 'voiceover.json'), 'utf8'));
  const dir = join(project, 'audio');
  mkdirSync(dir, { recursive: true });
  // Pages in the project are opened from file://, where fetch() can't read JSON, so they load data as scripts.
  writeFileSync(join(dir, 'script.js'), `window.VOICEOVER_SCRIPT = ${JSON.stringify(script, null, 2)};\n`);
  if (dry) return;

  const manifestPath = join(dir, 'manifest.json');
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const manifest = {};

  for (const line of script.lines) {
    const voice = line.voice || script.voice;
    const direction = line.direction ?? script.direction;
    const hash = createHash('sha256').update(JSON.stringify([MODEL, voice, direction, line.text])).digest('hex').slice(0, 16);
    const file = `${line.id}.wav`;

    if (previous[line.id]?.hash === hash && existsSync(join(dir, file))) {
      manifest[line.id] = previous[line.id];
      continue;
    }
    if (estimate) {
      // No hash, so the next real run voices it.
      const duration = Number((line.text.split(/\s+/).length / WORDS_PER_SECOND + 0.3).toFixed(2));
      manifest[line.id] = { src: null, duration, hash: null, text: line.text, estimated: true };
      console.log(`estimated ${line.id}  ${duration.toFixed(2)}s`);
      continue;
    }

    const { wav, duration } = await speak(line.text, voice, direction);
    writeFileSync(join(dir, file), wav);
    manifest[line.id] = { src: `audio/${file}`, duration, hash, text: line.text };
    console.log(`voiced ${line.id}  ${duration.toFixed(2)}s  "${line.text.slice(0, 60)}"`);
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'manifest.js'), `window.VOICEOVER = ${JSON.stringify(manifest, null, 2)};\n`);
  const total = Object.values(manifest).reduce((sum, line) => sum + line.duration, 0);
  console.log(`${script.lines.length} lines, ${total.toFixed(1)}s of voice → ${dir}`);
}

async function audition(text, voices, out) {
  mkdirSync(out, { recursive: true });
  const takes = [];
  for (const voice of voices) {
    const { wav, duration } = await speak(text, voice);
    const file = join(out, `${voice}.wav`);
    writeFileSync(file, wav);
    takes.push({ voice, duration, text, src: pathToFileURL(resolve(file)).href });
    console.log(`${voice}  ${duration.toFixed(2)}s → ${file}`);
  }
  writeFileSync(join(out, 'index.js'), `window.AUDITIONS = ${JSON.stringify(takes, null, 2)};\n`);
}

/**
 * @returns {Promise<{wav: Buffer, duration: number}>}
 */
async function speak(text, voice, direction) {
  // Gemini TTS takes delivery notes in the prompt itself, as a leading instruction it doesn't read aloud.
  const input = direction ? `${direction}: ${text}` : text;
  const response = await postOpenRouter('/audio/speech', { model: MODEL, input, voice, response_format: 'pcm' });
  const pcm = Buffer.from(await response.arrayBuffer());
  const rate = Number(/rate=(\d+)/.exec(response.headers.get('content-type') || '')?.[1] || 24000);
  return { wav: wavFromPcm(pcm, rate), duration: pcm.length / (rate * 2) };
}

// Gemini returns headerless 16-bit mono PCM; ffmpeg and browsers both want a WAV header on it.
function wavFromPcm(pcm, rate) {
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
