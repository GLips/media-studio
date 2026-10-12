import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInReviewCutQueue } from './review-cut-queue.ts';

test('a board asking for forty cuts at once never has more than two running, and every one finishes', async () => {
  let running = 0, most = 0;
  const cut = (n: number) => runInReviewCutQueue(async () => {
    most = Math.max(most, ++running);
    await new Promise((resolve) => setTimeout(resolve, 2));
    running--;
    if (n === 7) throw new Error('past the end');
    return n;
  });
  const settled = await Promise.allSettled(Array.from({ length: 40 }, (_, n) => cut(n)));
  assert.equal(most, 2);
  assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 39);
  // A failed cut gives its turn back: the queue doesn't stall behind it.
  assert.equal(await cut(40), 40);
});
