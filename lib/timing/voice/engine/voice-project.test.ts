import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';
import { samplesFromWav } from '#lib/platform/wav/models/wav.ts';
import type { RecordedVoice } from '../models/voice-manifest.ts';
import type { SpokenWord } from '../models/voice-words.ts';

// whisper.cpp is a local model of ~1.5 GB, so it stands in here: each run of tone is one word, told apart by its
// length, as the fake TTS below reads them.
const WORD_SECONDS: Record<string, number> = { 'Hello.': 0.4, 'Goodbye.': 0.7, 'Farewell.': 1.0, 'Again.': 1.3 };
const RATE = 24000;
function heardWordsForTest(wavPath: string): SpokenWord[] {
  const { samples, rate } = samplesFromWav(readFileSync(wavPath));
  const step = rate / 100, words: SpokenWord[] = [];
  let from = -1;
  for (let at = 0; at <= samples.length; at += step) {
    const loud = samples.subarray(at, at + step).some((sample) => Math.abs(sample) > 4000);
    if (loud && from < 0) from = at;
    if (!loud && from >= 0) {
      const seconds = (at - from) / rate;
      const text = Object.keys(WORD_SECONDS).reduce((a, b) => (Math.abs(WORD_SECONDS[a] - seconds) < Math.abs(WORD_SECONDS[b] - seconds) ? a : b));
      words.push({ text, start: from / rate, end: at / rate });
      from = -1;
    }
  }
  return words;
}
Object.assign(globalThis, { heardWordsForTest });
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== './whisper-words.ts') return nextResolve(specifier, context);
    return { url: 'data:text/javascript,export const heardWords = async (path) => globalThis.heardWordsForTest(path);', shortCircuit: true };
  },
});
const { chooseVoiceTake, voiceStudioProject } = await import('./voice-project.ts');

// Gemini TTS at the network boundary: it reads each word of its input as a tone of that word's length, and each read
// pauses longer between its words than the last, as no two reads match.
let inputs: string[] = [];
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  // SAFETY: postOpenRouter always sends a JSON body.
  const { input } = JSON.parse(init.body as string) as { input: string };
  inputs.push(input);
  const tone = (seconds: number) => Array.from({ length: Math.round(seconds * RATE) }, (_, i) => Math.round(8000 * Math.sin(i / 3)));
  const quiet = (seconds: number) => Array.from({ length: Math.round(seconds * RATE) }, () => 0);
  const samples: number[] = quiet(0.2);
  input.split(/\s+/).filter(Boolean).forEach((word, i) => {
    if (i > 0) samples.push(...quiet(0.4 + 0.3 * inputs.length));
    samples.push(...tone(WORD_SECONDS[word]));
  });
  samples.push(...quiet(0.3));
  return new Response(Buffer.from(Int16Array.from(samples).buffer), { headers: { 'content-type': `audio/pcm;rate=${RATE}` } });
}) as typeof fetch;

const script = { voice: 'Kore', lines: [{ id: 'hello', text: 'Hello.' }, { id: 'bye', text: 'Goodbye.' }, { id: 'again', text: 'Again.' }] };
let project = '', projects = 0;
const newProject = () => {
  const dir = join(studioTempRoot(), `voice-project-${++projects}`);
  mkdirSync(dir);
  return dir;
};
const manifest = () => readFileSync(join(project, 'audio', 'manifest.json'), 'utf8');
const clip = (id: string) => readFileSync(join(project, 'audio', `${id}.wav`));
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  project = newProject();
  inputs = [];
});

test('a changed line is read again alone, after the line before it, and the other lines keep their clips', async () => {
  await voiceStudioProject(project, script, { mode: 'paid' });
  const [hello, again] = [clip('hello'), clip('again')];
  const changed = { ...script, lines: [script.lines[0], { id: 'bye', text: 'Farewell.' }, script.lines[2]] };
  await voiceStudioProject(project, changed, { mode: 'paid' });
  assert.deepEqual(inputs, ['Hello. Goodbye. Again.', 'Hello. Farewell.']);
  assert.deepEqual(clip('hello'), hello);
  assert.deepEqual(clip('again'), again);
  // SAFETY: studio voice writes manifest.json as a RecordedVoice.
  assert.equal((JSON.parse(manifest()) as RecordedVoice).bye.text, 'Farewell.');
  // Put back, the line goes back to the take that reads it, without paying.
  await voiceStudioProject(project, script, { mode: 'paid' });
  assert.equal(inputs.length, 2);
});

test('a re-read of some lines keeps the earlier take, and choosing it again restores their clips without paying', async () => {
  await voiceStudioProject(project, script, { mode: 'paid' });
  const first = manifest();
  await voiceStudioProject(project, script, { mode: 'paid', reread: true, lines: ['again'] });
  assert.deepEqual(inputs.slice(1), ['Goodbye. Again.']);
  assert.notEqual(manifest(), first);

  await chooseVoiceTake(project, script, 1, ['again']);
  assert.equal(inputs.length, 2);
  assert.equal(manifest(), first);
  // Chosen, it stays: an unchanged script reads nothing new.
  await voiceStudioProject(project, script, { mode: 'paid' });
  assert.equal(inputs.length, 2);
  assert.equal(manifest(), first);
});

test('a new voice reads the whole script, and going back reuses the kept take', async () => {
  await voiceStudioProject(project, script, { mode: 'paid' });
  const first = manifest();
  await voiceStudioProject(project, { ...script, voice: 'Puck' }, { mode: 'paid' });
  assert.deepEqual(inputs.slice(1), ['Hello. Goodbye. Again.']);
  await voiceStudioProject(project, script, { mode: 'paid' });
  assert.equal(inputs.length, 2);
  assert.equal(manifest(), first);
});
