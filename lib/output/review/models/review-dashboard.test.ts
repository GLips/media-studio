import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStoryboard } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';
import { storyboardSceneHash } from '#lib/timing/storyboard/models/storyboard-sign-off.ts';
import { reviewRowAwaitsYou, summarizeReviewProject, type ReviewProjectFacts } from './review-dashboard.ts';
import { applyReviewOpsToFile, type ReviewOp } from './review-ops.ts';
import { reviewPlanSignoffs } from './review-plan.ts';
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
const project = (name: string, review: ReviewFile) => summarizeReviewProject({ project: name, files, review, plan: null, reviewedAt: null });

test('awaiting you lists a project with an addressed note or an open decision, and not one whose notes are all resolved', () => {
  const addressed = apply(apply(emptyReviewFile(), 'reviewer', note), 'agent', { op: 'thread.reply', id: 1, text: 'eased', transition: 'addressed' });
  const resolved = apply(addressed, 'reviewer', { op: 'thread.resolveAddressed', ids: [1] });
  const decision = apply(emptyReviewFile(), 'agent', {
    op: 'decision.put',
    decision: { topic: 'music-bed', question: 'Which bed?', choose: 'one', candidates: [{ key: 'a', label: 'a', meta: {} }, { key: 'b', label: 'b', meta: {} }] },
  });

  const awaiting = [project('fixed', addressed), project('done', resolved), project('choosing', decision)]
    .flatMap((summary) => summary.rows.filter((row) => reviewRowAwaitsYou(row, null)).map((row) => ({ summary, row })));

  assert.deepEqual(awaiting.map(({ summary, row }) => [summary.project, row.on]), [['fixed', 'file'], ['choosing', 'decision']]);
  assert.deepEqual(awaiting[0].row.threads, { open: 0, addressed: 1, asks: 0 });
});

test('a plan with one of its two scenes signed off still awaits you, and stops once both are', () => {
  const storyboard = defineStoryboard({
    title: 'A test plan', target: { seconds: 5 },
    scenes: { open: { onScreen: 'The title', motion: 'Fades in', seconds: 2 }, close: { onScreen: 'The end card', motion: 'Holds', seconds: 2 } },
  });
  const resolved = resolveStoryboard(storyboard);
  const signOff = (file: ReviewFile, scene: 'open' | 'close') =>
    apply(file, 'reviewer', { op: 'signoff', signoff: { on: 'plan', scene, hash: storyboardSceneHash(storyboard, resolved, scene)!, at: '2026-10-11T10:00:00Z' } });
  const awaits = (review: ReviewFile) => {
    const summary = summarizeReviewProject({ project: 'p', files, review, plan: { modified: '2026-10-11T09:00:00Z' }, reviewedAt: null });
    const row = summary.rows.find((r) => r.on === 'plan')!;
    return reviewRowAwaitsYou(row, reviewPlanSignoffs(storyboard, resolved, review.signoffs));
  };
  const one = signOff(emptyReviewFile(), 'open');
  assert.equal(awaits(one), true);
  assert.equal(awaits(signOff(one, 'close')), false);
});
