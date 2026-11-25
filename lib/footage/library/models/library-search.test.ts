import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Result } from 'effect';
import { LIBRARY_ITEM_FORMAT, type LibraryItem } from './library-item.ts';
import { searchLibrary } from './library-search.ts';

const word = (text: string, start: number) => ({ text, start, end: start + 0.3 });

// The mic starts 0.8 s into the recording and drifts 1 ms over its 10 s: a hit is placed on item time, not mic time.
const item: LibraryItem = {
  format: LIBRARY_ITEM_FORMAT, id: 'rec', title: 'Recording', source: { kind: 'files', paths: [] }, addedAt: '', durationSeconds: 11, speech: 'mic',
  tracks: {
    mic: { file: 'mic.m4a', mediaSeconds: 10, startSeconds: 0.8, hostDriftSeconds: 0.001, audio: { sampleRate: 48000, channels: 1, codec: 'aac' } },
    system: { file: 'system.m4a', mediaSeconds: 10, startSeconds: 0, audio: { sampleRate: 48000, channels: 2, codec: 'aac' } },
  },
};
// The far side of the call, on system, says it once too.
const transcript = { tracks: {
  mic: { duration: 10, pauses: [], words: [word('So,', 1.5), word('each', 2), word('Agent', 2.4), word('has', 2.8), word('each', 6), word('agent', 6.4)] },
  system: { duration: 10, pauses: [], words: [word('Each', 4), word('agent?', 4.4)] },
} };

test('a phrase is found wherever it is said, on either side of a call, ignoring case and punctuation, at its range in item time', () => {
  const hits = Result.getOrThrow(searchLibrary([{ item, transcript, flags: [] }], 'each agent'));
  assert.deepEqual(hits.map((h) => [h.start, h.end].map((t) => Math.round(t * 10000) / 10000)), [[2.8002, 3.5003], [4, 4.7], [6.8006, 7.5007]]);
  assert.deepEqual(hits.map((h) => h.on === 'transcript' && h.track), ['mic', 'system', 'mic']);
  assert.equal(hits[0].text, 'So, each Agent has');
});

test("a flag's note is searched as the transcript is, with the media nowhere", () => {
  const hits = Result.getOrThrow(searchLibrary([{ item, flags: [{ id: 3, start: 4, end: 5, note: 'Good take of the agent intro', by: 'agent', at: '', rev: 1 }] }], 'agent intro'));
  assert.deepEqual(hits, [{ item: 'rec', on: 'flag', flag: 3, start: 4, end: 5, text: 'Good take of the agent intro' }]);
});
