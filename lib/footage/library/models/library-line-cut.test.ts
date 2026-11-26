import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutLibraryLine, type LibraryLineEdits } from './library-line-cut.ts';

// Touching word timestamps on a mic starting at item second 2. Each byte is half a dB below full scale.
const sounds = [{ text: 'the', start: 2.1, end: 2.4 }, { text: 'uh,', start: 2.4, end: 2.7 }, { text: 'voice', start: 2.7, end: 3 }];
function speak(levels: Uint8Array, edits: LibraryLineEdits = {}) {
  return cutLibraryLine({ sounds, quiet: [], soft: [], clicks: [], envelope: { levels, start: 2, step: 0.01 } }, 2, 3, edits, 'take');
}

test('a fluent filler is cut at the deepest dip beside each boundary and review can restore it', () => {
  const levels = new Uint8Array(100).fill(30);
  levels[39] = 44;
  levels[44] = 50;
  levels[65] = 42;
  const line = speak(levels);
  assert.deepEqual(line.pieces, [{ from: 1.98, to: 2.445 }, { from: 2.655, to: 3.1 }]);
  // At 10 dB down the outgoing edge uses the ordinary overlap, even though the incoming edge is shallow.
  assert.deepEqual(line.joins, [{ fadeOut: 0, crossfade: 0.02 }]);
  levels[44] = 49;
  const voiced = speak(levels);
  assert.deepEqual(voiced.pieces, line.pieces);
  assert.deepEqual(voiced.joins, [{ fadeOut: 0.06, crossfade: 0.01 }]);
  const [mark] = line.removals;
  assert.equal(mark.at, 0.465);
  assert.equal(speak(levels, { keep: [mark.keepAt] }).removals[0].left, 'kept');
  assert.deepEqual(speak(levels, { cut: [mark.keepAt] }).pieces, line.pieces);
});

test('a filler stays in when either join lacks a distinct trough', () => {
  const levels = new Uint8Array(100).fill(30);
  levels[39] = 50;
  levels[72] = 36;
  const line = speak(levels);
  assert.equal(line.pieces.length, 1);
  assert.equal(line.removals[0].left, 'no quiet');
  const forced = speak(levels, { cut: [line.removals[0].keepAt] });
  assert.deepEqual(forced.pieces, [{ from: 1.98, to: 2.395 }, { from: 2.725, to: 3.1 }]);
});
