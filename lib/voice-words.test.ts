import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignSpokenWords, findSpokenPhrase } from './voice-words.ts';

const w = (text: string, start: number, end: number) => ({ text, start, end });

test('script words take whisper timings through case, punctuation, mishearings and dropped words', () => {
  const heard = [w('typing', 0.1, 0.4), w('blue', 0.5, 0.7), w('narrows', 0.8, 1.1), w('it', 1.2, 1.3), w('to', 1.3, 1.4), w('17', 1.5, 2.0)];
  const { words } = alignSpokenWords('Typing blue narrows these inks to seventeen.', heard, 2.4);
  assert.deepEqual(words.map((x) => x.text), ['Typing', 'blue', 'narrows', 'these', 'inks', 'to', 'seventeen.']);
  assert.deepEqual(words[1], w('blue', 0.5, 0.7));
  assert.deepEqual(words[6], w('seventeen.', 1.5, 2.0));
  // "these inks" was heard as "it": the two share what whisper gave them, in order, without overlapping "to".
  assert.ok(words[3].start >= 1.1 && words[3].end <= words[4].start && words[4].end <= 1.3 + 1e-9);
});

test('a phrase spans its words, a later occurrence is picked by nth, and a miss names the line', () => {
  const words = [w('show', 0, 0.2), w('all', 0.2, 0.4), w('then', 0.5, 0.6), w('Show', 0.7, 0.9), w('all,', 0.9, 1.1)];
  assert.deepEqual(findSpokenPhrase(words, 'show all', 2), { start: 0.7, end: 1.1 });
  assert.throws(() => findSpokenPhrase(words, 'hide all'), /isn't in "show all then Show all,"/);
});
