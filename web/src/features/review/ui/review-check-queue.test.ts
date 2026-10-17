import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewCheckQueueAfter, reviewCheckQueueSkip, startReviewCheckQueue } from './review-check-queue.ts';

test('the check queue walks addressed notes in moment order, leaving out the rest and the unplaced', () => {
  const queue = startReviewCheckQueue([
    { id: 1, state: 'addressed', frame: 90 },
    { id: 2, state: 'open', frame: 10 },
    { id: 3, state: 'addressed', frame: 30 },
    { id: 4, state: 'addressed', frame: undefined },
    { id: 5, state: 'addressed', frame: 30 },
  ]);
  assert.deepEqual(queue, { ids: [3, 5, 1], at: 0 });
  assert.equal(startReviewCheckQueue([{ id: 2, state: 'open', frame: 10 }]), null);
});

test('a resolve, reopen or skip steps the queue on to the next note still addressed, and the last one ends it', () => {
  const queue = { ids: [3, 5, 1], at: 0 };
  assert.equal(reviewCheckQueueAfter(queue, new Set([3, 5, 1])), queue, 'still addressed: stays put');
  // 3 resolved, and 5 reopened from the thread meanwhile: 1 is next.
  assert.deepEqual(reviewCheckQueueAfter(queue, new Set([1])), { ids: [3, 5, 1], at: 2 });
  // The last resolved while an earlier one waits (an undo brought it back): back to that one.
  assert.deepEqual(reviewCheckQueueAfter({ ids: [3, 5, 1], at: 2 }, new Set([5])), { ids: [3, 5, 1], at: 1 });
  assert.equal(reviewCheckQueueAfter({ ids: [3, 5, 1], at: 2 }, new Set()), null);
  // A skip leaves the note addressed and moves on; past the last it's done, not round again.
  assert.deepEqual(reviewCheckQueueSkip(queue, new Set([3, 5, 1])), { ids: [3, 5, 1], at: 1 });
  assert.equal(reviewCheckQueueSkip({ ids: [3, 5, 1], at: 2 }, new Set([3, 5, 1])), null);
});
