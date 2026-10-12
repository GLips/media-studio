import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINKED_MEDIA_PREROLL_FRAMES, linkedMediaFollowerMove, linkedMediaPhaseAt, linkedMediaSeekLanded } from './linked-media-window.ts';

test('a follower over [240, 312) parks just before its span and follows inside it', () => {
  const span = { from: 240, end: 312 };
  const phases = [0, 240 - LINKED_MEDIA_PREROLL_FRAMES - 1, 240 - LINKED_MEDIA_PREROLL_FRAMES, 239, 240, 311, 312].map((f) => linkedMediaPhaseAt(span, f));
  assert.deepEqual(phases, ['away', 'away', 'preroll', 'preroll', 'inside', 'inside', 'away']);
  assert.equal(linkedMediaPhaseAt(null, 0), 'inside');
});

test('a follower hides through every seek and shows only on the leader frame: exactly paused, within one playing', () => {
  // A source just changed: nothing requested, so it seeks and stays hidden.
  assert.deepEqual(linkedMediaFollowerMove({ requested: null, presented: null, ready: false }, 50, false), { seekTo: 50, rate: 1, shown: false });
  // Waiting on that seek: no second seek, still hidden; the leader moving while paused re-aims it.
  assert.deepEqual(linkedMediaFollowerMove({ requested: 50, presented: 12, ready: false }, 50, false), { seekTo: null, rate: 1, shown: false });
  assert.equal(linkedMediaFollowerMove({ requested: 50, presented: 12, ready: false }, 51, false).seekTo, 51);
  // A stale frame from before the seek doesn't land it; only the requested one does.
  assert.equal(linkedMediaSeekLanded(50, 12, false), false);
  assert.equal(linkedMediaSeekLanded(50, 50, false), true);

  // Paused: one frame off is a seek, not a show.
  assert.deepEqual(linkedMediaFollowerMove({ requested: 50, presented: 50, ready: true }, 50, false), { seekTo: null, rate: 1, shown: true });
  assert.deepEqual(linkedMediaFollowerMove({ requested: 50, presented: 50, ready: true }, 51, false), { seekTo: 51, rate: 1, shown: false });
  // Playing: a frame off shows; a few off hides and catches up by rate; far off seeks ahead of the leader.
  assert.equal(linkedMediaFollowerMove({ requested: 50, presented: 99, ready: true }, 100, true).shown, true);
  assert.deepEqual(linkedMediaFollowerMove({ requested: 50, presented: 97, ready: true }, 100, true), { seekTo: null, rate: 1.25, shown: false });
  assert.deepEqual(linkedMediaFollowerMove({ requested: 50, presented: 80, ready: true }, 100, true), { seekTo: 104, rate: 1, shown: false });
});
