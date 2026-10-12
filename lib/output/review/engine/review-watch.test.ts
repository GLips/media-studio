import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import type { ReviewAuthor } from '../models/review-threads.ts';
import { applyReviewOps } from './review-file.ts';
import { waitForReviewChange } from './review-watch.ts';

const note = (projectDir: string, author: ReviewAuthor, text: string) =>
  applyReviewOps(projectDir, [{ op: 'thread.add', kind: 'fix', anchor: { on: 'project' }, text }], author);

// Scaled down from the CLI's 3 s settle so the test runs in a couple of seconds; the shape is the same.
const SETTLE_MS = 900;

test("a watch sleeps through the agent's own writes and wakes once for a burst of reviewer notes, then not again for them", async () => {
  await withStudioTemp('review-watch', async (projectDir) => {
    const watching = waitForReviewChange({ projectDir, as: 'agent', settleMs: SETTLE_MS });
    note(projectDir, 'agent', 'which logo, the outline or the fill?');
    await sleep(300);
    note(projectDir, 'reviewer', 'the second strike lands soft');
    await sleep(300);
    const second = Date.now();
    note(projectDir, 'reviewer', 'hold the end card a beat longer');

    const woke = await watching;
    assert.ok(!('timeout' in woke));
    assert.deepEqual(woke.changed.map((t) => t.entries[0].text), ['the second strike lands soft', 'hold the end card a beat longer']);
    assert.equal(woke.revision, 3);
    assert.ok(Date.now() - second >= SETTLE_MS);

    assert.deepEqual(await waitForReviewChange({ projectDir, as: 'agent', settleMs: SETTLE_MS, timeoutMs: 500 }), { timeout: 3 });
  });
});
