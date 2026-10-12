import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewRowAwaitsYou, summarizeReviewProject, type ReviewProjectFacts } from './review-dashboard.ts';
import { applyReviewOpsToFile, type ReviewOp } from './review-ops.ts';
import { emptyReviewFile, type ReviewAuthor, type ReviewFile } from './review-threads.ts';

const render = { path: 'out/video.mp4', hash: 'a1b2c3d4e5' };
const files: ReviewProjectFacts['files'] = [
  { artifact: { path: render.path, kind: 'video', modified: '2026-10-11T12:00:00Z' }, thumbnail: { kind: 'video', ...render, frame: 30, fps: 30 } },
];
const apply = (file: ReviewFile, author: ReviewAuthor, ...ops: ReviewOp[]): ReviewFile => {
  const applied = applyReviewOpsToFile(file, ops, { author, now: '2026-10-11T12:00:00Z', writtenOnOf: (r) => r });
  assert.ok('file' in applied);
  return applied.file;
};
const note: ReviewOp = { op: 'thread.add', kind: 'fix', anchor: { on: 'video', writtenOn: render, frame: 120 }, text: 'the price lands soft' };
const project = (name: string, review: ReviewFile) => summarizeReviewProject({ project: name, files, review, script: null, reviewedAt: null });

test('awaiting you lists a project with an addressed note or an open decision, and not one whose notes are all resolved', () => {
  const addressed = apply(apply(emptyReviewFile(), 'reviewer', note), 'agent', { op: 'thread.reply', id: 1, text: 'eased', transition: 'addressed' });
  const resolved = apply(addressed, 'reviewer', { op: 'thread.resolveAddressed', ids: [1] });
  const decision = apply(emptyReviewFile(), 'agent', {
    op: 'decision.put',
    decision: { topic: 'music-bed', question: 'Which bed?', choose: 'one', candidates: [{ key: 'a', label: 'a', meta: {} }, { key: 'b', label: 'b', meta: {} }] },
  });

  const awaiting = [project('fixed', addressed), project('done', resolved), project('choosing', decision)]
    .flatMap((summary) => summary.rows.filter(reviewRowAwaitsYou).map((row) => ({ summary, row })));

  assert.deepEqual(awaiting.map(({ summary, row }) => [summary.project, row.on]), [['fixed', 'file'], ['choosing', 'decision']]);
  assert.deepEqual(awaiting[0].row.threads, { open: 0, addressed: 1, asks: 0 });
});
