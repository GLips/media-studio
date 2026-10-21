import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import type { ReviewAuthor } from '../models/review-threads.ts';
import { formatReviewWatchEvent, reviewWatchEventsOf } from '../models/review-watch-events.ts';
import { applyReviewOps } from './review-file.ts';
import { waitForReviewChange } from './review-watch.ts';

const note = (projectDir: string, author: ReviewAuthor, text: string) =>
  applyReviewOps(projectDir, [{ op: 'thread.add', kind: 'fix', anchor: { on: 'project' }, text }], author);

// Scaled down from the CLI's 3 s settle so the test runs in a couple of seconds; the shape is the same.
const SETTLE_MS = 900;

test("a watch sleeps through the agent's own writes and wakes once for a burst of reviewer notes, then not again for them", async () => {
  await withStudioTemp('review-watch', async (projectDir) => {
    const watching = waitForReviewChange({ projectDir, settleMs: SETTLE_MS });
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

    assert.deepEqual(await waitForReviewChange({ projectDir, settleMs: SETTLE_MS, timeoutMs: 500 }), { timeout: 3 });
  });
});

test('followed watches report each reviewer act once, in order, across rounds: notes, reopens, resolves and sign-offs', async () => {
  await withStudioTemp('review-watch-follow', async (projectDir) => {
    const round = async () => {
      const woke = await waitForReviewChange({ projectDir, settleMs: 50 });
      assert.ok(!('timeout' in woke));
      return reviewWatchEventsOf({ threads: woke.changed, decisions: woke.decisions, signoffs: woke.signoffs }, woke.cursor)
        .map((e) => formatReviewWatchEvent('demo', e));
    };
    note(projectDir, 'reviewer', 'the second strike lands soft');
    note(projectDir, 'reviewer', 'hold the end card');
    assert.deepEqual(await round(), [
      'r1 #1 note · open · project · "the second strike lands soft" → studio review notes demo --id 1',
      'r2 #2 note · open · project · "hold the end card" → studio review notes demo --id 2',
    ]);

    applyReviewOps(projectDir, [{ op: 'thread.reply', id: 1, text: 'harder now', transition: 'addressed' }], 'agent');
    applyReviewOps(projectDir, [{ op: 'thread.reply', id: 1, text: 'still soft' }], 'reviewer');
    applyReviewOps(projectDir, [{ op: 'thread.reply', id: 2, text: '', transition: 'resolved' }], 'reviewer');
    applyReviewOps(projectDir, [{ op: 'signoff', signoff: { on: 'plan', scene: 'intro', hash: 'h', texts: {}, at: '2026-10-21T10:00:00Z' } }], 'reviewer');
    assert.deepEqual(await round(), [
      'r4 #1 reopen · reopened · project · "still soft" → studio review notes demo --id 1',
      'r5 #2 resolve · resolved · project → studio review notes demo --id 2',
      'r6 signoff · plan · intro → studio review notes demo',
    ]);
  });
});
