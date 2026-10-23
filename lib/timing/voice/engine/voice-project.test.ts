import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';
import { samplesFromWav } from '#lib/platform/wav/models/wav.ts';
import type { SpokenWord } from '../models/voice-words.ts';

// whisper.cpp is a local model of ~1.5 GB, so it stands in here: each run of tone is one word, told apart by its
// length, as the fake TTS below reads them.
const WORD_SECONDS: Record<string, number> = { 'Hello.': 0.4, 'Goodbye.': 0.7 };
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

// Gemini TTS at the network boundary: each read pauses longer between its words than the last, as no two reads match.
let reads = 0;
globalThis.fetch = (async () => {
  reads++;
  const tone = (seconds: number) => Array.from({ length: Math.round(seconds * RATE) }, (_, i) => Math.round(8000 * Math.sin(i / 3)));
  const quiet = (seconds: number) => Array.from({ length: Math.round(seconds * RATE) }, () => 0);
  const samples = Int16Array.from([...quiet(0.2), ...tone(0.4), ...quiet(0.4 + 0.3 * reads), ...tone(0.7), ...quiet(0.3)]);
  return new Response(Buffer.from(samples.buffer), { headers: { 'content-type': `audio/pcm;rate=${RATE}` } });
});

const script = { voice: 'Kore', lines: [{ id: 'hello', text: 'Hello.' }, { id: 'bye', text: 'Goodbye.' }] };
let project = '', projects = 0;
const newProject = () => {
  const dir = join(studioTempRoot(), `voice-project-${++projects}`);
  mkdirSync(dir);
  return dir;
};
const manifest = () => readFileSync(join(project, 'audio', 'manifest.json'), 'utf8');
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  project = newProject();
  reads = 0;
});

test('a re-read keeps the earlier take, and choosing it again restores its lines without paying', async () => {
  await voiceStudioProject(project, script, { mode: 'paid' });
  const first = manifest();
  await voiceStudioProject(project, script, { mode: 'paid', reread: true });
  assert.equal(reads, 2);
  assert.notEqual(manifest(), first);
  assert.ok(existsSync(join(project, 'audio', 'takes', '1.wav')) && existsSync(join(project, 'audio', 'takes', '2.wav')));

  await chooseVoiceTake(project, script, 1);
  assert.equal(reads, 2);
  assert.equal(manifest(), first);
  // Chosen, it stays current: an unchanged script reads nothing new.
  await voiceStudioProject(project, script, { mode: 'paid' });
  assert.equal(reads, 2);
  assert.equal(manifest(), first);
});

test('a script a kept take already reads reuses that take instead of paying', async () => {
  await voiceStudioProject(project, script, { mode: 'paid' });
  const first = manifest();
  await voiceStudioProject(project, { ...script, voice: 'Puck' }, { mode: 'paid' });
  assert.equal(reads, 2);
  await voiceStudioProject(project, script, { mode: 'paid' });
  assert.equal(reads, 2);
  assert.equal(manifest(), first);
});

test("a project's single audio/take.wav becomes kept take 1, and is used without paying", async () => {
  await voiceStudioProject(project, script, { mode: 'paid' });
  const paid = join(project, 'audio', 'takes', '1');
  const single = newProject();
  mkdirSync(join(single, 'audio'));
  copyFileSync(`${paid}.wav`, join(single, 'audio', 'take.wav'));
  copyFileSync(`${paid}.json`, join(single, 'audio', 'take.json'));

  await voiceStudioProject(single, script, { mode: 'paid' });
  assert.equal(reads, 1);
  assert.ok(!existsSync(join(single, 'audio', 'take.wav')));
  assert.deepEqual(readFileSync(join(single, 'audio', 'takes', '1.wav')), readFileSync(`${paid}.wav`));
});
