import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutTakeIntoLines } from './voice-take.ts';

const RATE = 24000;
// A take with speech (a loud tone) over each [start, end], and silence elsewhere.
function take(duration: number, speech: [number, number][]) {
  const samples = new Int16Array(Math.round(duration * RATE));
  for (const [a, b] of speech) for (let i = Math.round(a * RATE); i < Math.round(b * RATE); i++) samples[i] = Math.round(8000 * Math.sin(i / 5));
  return samples;
}
const w = (text: string, start: number, end: number) => ({ text, start, end });

test('a take is cut in the quiet between lines despite whisper drifting, and the pauses give back the read', () => {
  const lines = [{ id: 'a', text: 'Pick cobalt.' }, { id: 'b', text: 'Then sage, twelve dollars.' }];
  const samples = take(4, [[0.3, 0.8], [0.85, 1.4], [2.0, 2.4], [2.45, 3.0], [3.05, 3.6]]);
  // Whisper runs 0.4 s late, past the pause, and heard "twelve dollars" as "$12". The comma pause after "sage" is
  // shorter than the one between the lines.
  const heard = [w('Pick', 0.7, 1.2), w('cobalt.', 1.25, 1.8), w('Then', 2.4, 2.8), w('sage,', 2.85, 3.4), w('$12.', 3.45, 4.0)];
  const [a, b] = cutTakeIntoLines(lines, heard, samples, RATE);

  assert.ok(a.to > 1.4 && b.from < 2.0 && a.to <= b.from, `cut between ${a.to} and ${b.from}`);
  assert.ok(Math.abs(b.from - a.to - b.pauseBefore!) < 1e-3);
  assert.equal(a.pauseBefore, null);
  assert.ok(b.cutIsClear);
});

test('a line with nothing heard fails rather than guessing its cuts', () => {
  const lines = [{ id: 'a', text: 'Pick cobalt.' }, { id: 'b', text: 'Then sage.' }];
  assert.throws(() => cutTakeIntoLines(lines, [w('Pick', 0.3, 0.8), w('cobalt.', 0.9, 1.4)], take(2, [[0.3, 1.4]]), RATE), /line "b" wasn't heard/);
});

test('a cut is flagged when a pause inside a word rivals the one between the lines', () => {
  const lines = [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }];
  // "Al…pha" stops for 0.15 s; the lines barely pause.
  const samples = take(2, [[0.2, 0.6], [0.75, 1.0], [1.04, 1.5]]);
  const [, b] = cutTakeIntoLines(lines, [w('Alpha', 0.2, 1.0), w('Beta', 1.04, 1.5)], samples, RATE);
  assert.equal(b.cutIsClear, false);
});

test('short lines whose search windows overlap each keep their own speech', () => {
  const lines = [{ id: 'a', text: 'a list you can filter,' }, { id: 'b', text: 'search,' }, { id: 'c', text: 'and preview images.' }];
  const samples = take(5, [[0.2, 1.6], [2.2, 2.8], [3.5, 4.6]]);
  // Whisper smeared "search," over both pauses, so every window reaches both.
  const heard = [w('a', 0.2, 0.3), w('list', 0.3, 0.7), w('you', 0.7, 0.9), w('can', 0.9, 1.1), w('filter,', 1.2, 2.2), w('search,', 2.2, 3.4), w('and', 3.4, 3.6), w('preview', 3.6, 4.1), w('images.', 4.1, 4.6)];
  const [a, b, c] = cutTakeIntoLines(lines, heard, samples, RATE);
  assert.ok(a.to <= 2.2 && b.from < 2.2 && b.to > 2.8 && c.from < 3.5, `${a.to} ${b.from}–${b.to} ${c.from}`);
});
