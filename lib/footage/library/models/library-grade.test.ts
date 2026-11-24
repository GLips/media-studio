import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIBRARY_GRADE_LOOKS, LIBRARY_GRADE_METHOD, libraryGradeGainsOf, type LibraryGradeMeasurement, planLibraryGradeChunks } from './library-grade.ts';

const round = (v: readonly number[]) => v.map((x) => Math.round(x * 1000) / 1000);

// The desk at night, as the lab measured it when desk-night was tuned: an amber room, a green-lit left cheek.
const desk: LibraryGradeMeasurement = {
  method: LIBRARY_GRADE_METHOD, sampled: 24,
  background: [0.152, 0.0793, 0.0223],
  skin: [0.4495, 0.2076, 0.1156],
  face: { skin: [0.5428, 0.2518, 0.1366], left: [0.6268666, 0.3052326, 0.153093], right: [0.3576895, 0.1479223, 0.0777414] },
};

test("desk-night pulls the room to grey, the parsed face toward healthy skin, and the face's halves together", () => {
  const gains = libraryGradeGainsOf(desk, LIBRARY_GRADE_LOOKS['desk-night']);
  assert.deepEqual(round(gains.background), [0.522, 1, 3.556]);
  assert.deepEqual(round(gains.skin), [0.835, 1, 1.198]);
  // The lab's balance for this face, from the same halves.
  assert.deepEqual(round(gains.balance), [0.849, 1, 0.954]);
});

test('a look without face parsing grades the skin from the person matte and leaves the halves alone', () => {
  const gains = libraryGradeGainsOf(desk, LIBRARY_GRADE_LOOKS['desk-night-person']);
  assert.deepEqual(round(gains.skin), [0.831, 1, 1.167]);
  assert.deepEqual(gains.balance, [1, 1, 1]);
});

test('chunks cover the range in whole frames with no gap, each warmed but never from before the track starts', () => {
  const fps = 30000 / 1001;
  const chunks = planLibraryGradeChunks({ from: 0.5, to: 10.5, fps, count: 4, warmSeconds: 1, earliest: 0 });
  assert.equal(chunks.reduce((n, c) => n + c.frames, 0), Math.round(10 * fps));
  chunks.slice(1).forEach((c, i) => assert.ok(Math.abs(c.from - (chunks[i].from + chunks[i].frames / fps)) < 1e-9));
  assert.deepEqual(chunks.map((c) => c.warm), [14, 30, 30, 30]);
});
