import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineSpeechCues } from './speech-cues.ts';

const words = (text: string) => text.split(' ').map((w, i) => ({ text: w, start: i * 0.5, end: i * 0.5 + 0.4 }));
const voice = { pick: { words: words('Pick the price, then the price again.') } };

test('a speech cue resolves to its phrase on its line, and a phrase the line doesn\'t say throws at load, naming the cue', () => {
  const cues = defineSpeechCues(voice, { land: { line: 'pick', phrase: 'the price', nth: 2 } });
  assert.deepEqual(cues.land, { line: 'pick', start: 2, end: 2.9 });
  assert.throws(() => defineSpeechCues(voice, { land: { line: 'pick', phrase: 'full price' } }), /speech cue land on line pick: "full price" isn't in/);
});
