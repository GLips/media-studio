import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brushReadingCandidates } from './brush-reading-search.ts';

test('candidates stay within the range, collapse where clamping meets, and keep the current value', () => {
  // glazeBuildLight at its max: nothing above 1, where multiples of it tried 1.5 to 3.
  assert.deepEqual(brushReadingCandidates({ kind: 'additive', min: 0, max: 1, step: 0.5, finest: 0.06 }, 1), { values: [0.25, 0.5, 0.75, 1], baseline: 3 });
  // A zero-valued amount gets distinct candidates either side, not seven zeros.
  assert.deepEqual(brushReadingCandidates({ kind: 'additive', min: -1, max: 1, step: 0.4, finest: 0.05 }, 0).values, [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6]);
  // A scale in half and whole strides of its factor: every stride down clamps to one min, and the current value is
  // kept exactly though the rest are rounded.
  assert.deepEqual(brushReadingCandidates({ kind: 'multiplicative', min: 0.25, max: 4, factor: 2, finest: 1.1 }, 1 / 3), {
    values: [0.25, 1 / 3, 0.4714, 0.6667, 0.9428], baseline: 1,
  });
});
