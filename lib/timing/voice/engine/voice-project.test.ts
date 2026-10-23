import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';
import { samplesFromWav, wavFromSamples } from '#lib/platform/wav/models/wav.ts';
import type { RecordedVoice } from '../models/voice-manifest.ts';
import type { VoiceScript } from '../models/voice-take.ts';
import type { SpokenWord } from '../models/voice-words.ts';

// whisper.cpp is a local model of ~1.5 GB, so it stands in here: each run of tone is one word, told apart by its
// length, as the fake TTS below reads them. `hearingFails` stands in for a cut that fails, and `collapsesRepeats` for
// a whisper that hears a word said twice in a row as one. A hyphened word is read as a tone per piece, and so heard as
// several words.
const WORD_SECONDS: Record<string, number> = { 'to': 0.15, 'End': 0.25, 'end.': 0.3, 'Hello.': 0.4, 'Order.': 0.55, 'Wherever.': 0.7, 'Again.': 0.85, 'Farewell.': 1.0 };
const RATE = 24000;
function wordsInSamples(samples: Int16Array, rate: number): SpokenWord[] {
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
const fakeWhisper = { hearingFails: false, collapsesRepeats: false };
function heardWordsForTest(wavPath: string): SpokenWord[] {
  if (fakeWhisper.hearingFails) throw new Error('whisper failed');
  const { samples, rate } = samplesFromWav(readFileSync(wavPath));
  const words = wordsInSamples(samples, rate);
  if (!fakeWhisper.collapsesRepeats) return words;
  return words.reduce<SpokenWord[]>((heard, word) => {
    const last = heard.at(-1);
    if (last?.text === word.text) last.end = word.end;
    else heard.push({ ...word });
    return heard;
  }, []);
}
Object.assign(globalThis, { heardWordsForTest });
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== './whisper-words.ts') return nextResolve(specifier, context);
    return { url: 'data:text/javascript,export const heardWords = async (path) => globalThis.heardWordsForTest(path);', shortCircuit: true };
  },
});
const { importVoiceRecording, rereadVoiceLines, syncVoice, unvoicedVoiceLines, useVoiceTake } = await import('./voice-project.ts');
const { currentVoiceGeneration } = await import('./voice-generations.ts');

const tone = (seconds: number) => Array.from({ length: Math.round(seconds * RATE) }, (_, i) => Math.round(8000 * Math.sin(i / 3)));
const quiet = (seconds: number) => Array.from({ length: Math.round(seconds * RATE) }, () => 0);
/** Each word of `text` as a tone of its length, `pause` apart. */
function spoken(text: string, pause: number) {
  const samples: number[] = quiet(0.2);
  text.split(/\s+/).filter(Boolean).forEach((word, i) => {
    if (i > 0) samples.push(...quiet(pause));
    word.split('-').forEach((piece, k) => samples.push(...quiet(k ? 0.05 : 0), ...tone(WORD_SECONDS[piece])));
  });
  samples.push(...quiet(0.3));
  return Int16Array.from(samples);
}

// Gemini TTS at the network boundary: each read pauses longer between its words than the last, as no two reads match.
let inputs: string[] = [];
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  // SAFETY: postOpenRouter always sends a JSON body.
  const { input } = JSON.parse(init.body as string) as { input: string };
  inputs.push(input);
  return new Response(Buffer.from(spoken(input, 0.4 + 0.3 * inputs.length).buffer), { headers: { 'content-type': `audio/pcm;rate=${RATE}` } });
}) as typeof fetch;

let project = '', projects = 0;
const newProject = () => {
  const dir = join(studioTempRoot(), `voice-project-${++projects}`);
  mkdirSync(dir);
  return dir;
};
const script = (...texts: string[]): VoiceScript => ({ voice: 'Kore', lines: texts.map((text, i) => ({ id: 'abcd'[i], text })) });
const generation = () => currentVoiceGeneration(project)!;
const manifestText = () => readFileSync(join(generation(), 'manifest.json'), 'utf8');
const compText = () => readFileSync(join(generation(), 'comp.json'), 'utf8');
// SAFETY: studio voice writes manifest.json as a RecordedVoice.
const manifest = () => JSON.parse(manifestText()) as RecordedVoice;
const clip = (id: string) => readFileSync(join(project, manifest()[id].src));
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  project = newProject();
  inputs = [];
  fakeWhisper.hearingFails = false;
  fakeWhisper.collapsesRepeats = false;
});

test("a pickup reads after the line before it, and its clip holds its own words whole and none of the lead-in's", async () => {
  await syncVoice(project, script('Hello.', 'Order. Wherever.', 'Wherever. Hello.', 'Again.'), { draft: false });
  // The lead-in ends on the word the pickup starts with, so a cut placed by drifting word times would double it.
  await syncVoice(project, script('Hello.', 'Order. Wherever.', 'Wherever. Farewell.', 'Again.'), { draft: false });
  assert.deepEqual(inputs.slice(1), ['Order. Wherever. Wherever. Farewell.']);

  const words = wordsInSamples(samplesFromWav(clip('c')).samples, RATE);
  assert.deepEqual(words.map((w) => w.text), ['Wherever.', 'Farewell.']);
  for (const w of words) assert.ok(Math.abs(w.end - w.start - WORD_SECONDS[w.text]) < 0.015, `${w.text} is cut short`);

  // Played as the timeline places them, each line is heard once, in order.
  const played: number[] = [];
  for (const [id, line] of Object.entries(manifest())) {
    played.push(...quiet(line.pauseBefore ?? 0), ...samplesFromWav(clip(id)).samples);
  }
  assert.deepEqual(wordsInSamples(Int16Array.from(played), RATE).map((w) => w.text), ['Hello.', 'Order.', 'Wherever.', 'Wherever.', 'Farewell.', 'Again.']);
});

test("a pickup whose join a whisper misplaces is refused, and the paid take kept, but one heard in more words is not", async () => {
  await syncVoice(project, script('Hello.', 'Order. Wherever.', 'Wherever. Hello.', 'Again.'), { draft: false });
  const published = manifestText();
  fakeWhisper.collapsesRepeats = true;
  await assert.rejects(syncVoice(project, script('Hello.', 'Order. Wherever.', 'Wherever. Farewell.', 'Again.'), { draft: false }), /take 2 reads c after b.*studio voice reread \S+ c/s);
  assert.ok(existsSync(join(project, 'audio', 'takes', '2.wav')));
  assert.equal(manifestText(), published);

  // "End-to-end." heard as "End to end." is its own three words, none of the lead-in's.
  fakeWhisper.collapsesRepeats = false;
  await syncVoice(project, script('Hello.', 'Order. Wherever.', 'End-to-end. Farewell.', 'Again.'), { draft: false });
  assert.deepEqual(manifest().c.words.map((w) => w.text), ['End-to-end.', 'Farewell.']);
});

test("a reread changes only its lines, and a failed one leaves the voice as it was with the paid take kept", async () => {
  const lines = script('Hello.', 'Order.', 'Again.');
  await syncVoice(project, lines, { draft: false });
  const before = manifest(), [a, c] = [clip('a'), clip('c')];
  await rereadVoiceLines(project, lines, ['b']);
  assert.deepEqual(inputs.slice(1), ['Hello. Order.']);
  assert.deepEqual([clip('a'), clip('c')], [a, c]);
  const after = manifest();
  assert.notEqual(after.b.pauseBefore, before.b.pauseBefore);
  for (const id of ['a', 'c']) assert.deepEqual(after[id], before[id]);

  const published = manifestText(), comp = compText(), b = clip('b');
  fakeWhisper.hearingFails = true;
  await assert.rejects(rereadVoiceLines(project, lines, ['b']), /whisper failed/);
  assert.equal(inputs.length, 3);
  assert.ok(existsSync(join(project, 'audio', 'takes', '3.wav')));
  assert.equal(manifestText(), published);
  assert.equal(compText(), comp);
  assert.deepEqual([clip('a'), clip('b'), clip('c')], [a, b, c]);
});

test('use goes back to a kept take without paying, and a partial comp leaves the other lines unvoiced', async () => {
  const lines = script('Hello.', 'Order.', 'Again.');
  await syncVoice(project, lines, { draft: false });
  const first = manifestText();
  await rereadVoiceLines(project, lines, ['b']);
  const used = await useVoiceTake(project, lines, 1, ['b']);
  assert.deepEqual(used.chosen, ['b']);
  assert.equal(inputs.length, 2);
  assert.equal(manifestText(), first);

  project = newProject();
  const recording = join(project, 'order.wav');
  writeFileSync(recording, wavFromSamples(spoken('Order.', 0.4), RATE));
  await importVoiceRecording(project, lines, recording, ['b']);
  assert.deepEqual(Object.keys(manifest()), ['b']);
  assert.deepEqual(unvoicedVoiceLines(project, lines), ['a', 'c']);
  assert.equal(inputs.length, 2);
});

test('a voice a render may still hold is kept a day after it stops being current, and then swept', async () => {
  await syncVoice(project, script('Hello.', 'Order.', 'Again.'), { draft: false });
  const old = generation(), oldB = join(project, manifest().b.src), lines = script('Hello.', 'Farewell.', 'Again.');
  await syncVoice(project, lines, { draft: false });
  await syncVoice(project, lines, { draft: false });
  assert.ok(existsSync(old) && existsSync(oldB), 'the voice before is gone while a render may hold it');

  const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000), clips = join(project, 'audio', 'clips');
  utimesSync(old, dayAgo, dayAgo);
  for (const file of readdirSync(clips)) utimesSync(join(clips, file), dayAgo, dayAgo);
  await syncVoice(project, lines, { draft: false });
  assert.ok(!existsSync(old) && !existsSync(oldB));
  for (const line of Object.values(manifest())) assert.ok(existsSync(join(project, line.src)), `${line.src} is gone`);
  assert.equal(inputs.length, 2);
});
