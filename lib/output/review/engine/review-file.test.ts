import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { readReviewFile } from './review-file.ts';

// Each writer is a thread of its own, as the page's server and the CLI are processes of their own: the lock, not the
// event loop, is what keeps them apart.
const WRITER = `
const { workerData, parentPort } = require('node:worker_threads');
import(workerData.module).then(({ applyReviewOps }) => {
  const { revision } = applyReviewOps(workerData.projectDir, [{ op: 'thread.add', kind: 'fix', anchor: { on: 'project' }, text: workerData.text }], workerData.author).file;
  parentPort.postMessage(revision);
});
`;

function writeInWorker(projectDir: string, author: 'reviewer' | 'agent', text: string): Promise<number> {
  const worker = new Worker(WRITER, { eval: true, workerData: { module: import.meta.resolve('./review-file.ts'), projectDir, author, text } });
  return new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  });
}

test('twenty writers at once, reviewer and agent, each land their note on its own revision', async () => {
  await withStudioTemp('review-file', async (projectDir) => {
    const revisions = await Promise.all(Array.from({ length: 20 }, (_, i) => writeInWorker(projectDir, i % 2 ? 'agent' : 'reviewer', `note ${i}`)));

    const file = readReviewFile(projectDir);
    assert.equal(file.revision, 20);
    assert.deepEqual(revisions.toSorted((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.deepEqual(file.threads.map((t) => t.entries[0].text).toSorted(), Array.from({ length: 20 }, (_, i) => `note ${i}`).toSorted());
    assert.equal(new Set(file.threads.map((t) => t.id)).size, 20);
  });
});
