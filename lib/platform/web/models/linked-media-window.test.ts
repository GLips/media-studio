import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINKED_MEDIA_PREROLL_FRAMES, linkedMediaLanded, linkedMediaPhaseAt } from './linked-media-window.ts';

test('a follower over [240, 312) parks just before its span, shows inside it, and only once its picture lands', () => {
  const span = { from: 240, end: 312 };
  const phases = [0, 240 - LINKED_MEDIA_PREROLL_FRAMES - 1, 240 - LINKED_MEDIA_PREROLL_FRAMES, 239, 240, 311, 312].map((f) => linkedMediaPhaseAt(span, f));
  assert.deepEqual(phases, ['away', 'away', 'preroll', 'preroll', 'inside', 'inside', 'away']);
  assert.equal(linkedMediaPhaseAt(null, 0), 'inside');

  assert.equal(linkedMediaLanded(null, 0, false), false);
  assert.equal(linkedMediaLanded(5, 6, false), false);
  assert.equal(linkedMediaLanded(5, 6, true), true);
});
