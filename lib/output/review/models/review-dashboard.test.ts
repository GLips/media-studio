import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStoryboard } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';
import { storyboardSceneHash } from '#lib/timing/storyboard/models/storyboard-sign-off.ts';
import { projectPageRungOf, reviewRowAwaitsYou, summarizeReviewProject, type ReviewProjectFacts } from './review-dashboard.ts';
import { applyReviewOpsToFile, type ReviewOp } from './review-ops.ts';
import { reviewPlanSceneTexts, reviewPlanSignoffs } from './review-plan.ts';
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

test('a plan awaits you once handed over with a scene unsigned, or whenever a signed scene has changed', () => {
  const opening = { onScreen: 'The title', motion: 'Fades in', seconds: 2 };
  const storyboardOf = (motion: string) => defineStoryboard({
    title: 'A test plan', target: { seconds: 5 },
    scenes: { open: opening, close: { onScreen: 'The end card', motion, seconds: 2 } },
  });
  const storyboard = storyboardOf('Holds'), resolved = resolveStoryboard(storyboard);
  const signOff = (file: ReviewFile, scene: 'open' | 'close') =>
    apply(file, 'reviewer', { op: 'signoff', signoff: { on: 'plan', scene, hash: storyboardSceneHash(storyboard, resolved, scene)!, texts: reviewPlanSceneTexts(storyboard, scene), at: '2026-10-11T10:00:00Z' } });
  const awaits = (review: ReviewFile, now = storyboard) => {
    const summary = summarizeReviewProject({ project: 'p', files, review, plan: { modified: '2026-10-11T09:00:00Z' }, reviewedAt: null });
    const row = summary.rows.find((r) => r.on === 'plan')!;
    return reviewRowAwaitsYou(row, reviewPlanSignoffs(now, resolveStoryboard(now), review.signoffs));
  };
  const one = signOff(emptyReviewFile(), 'open');
  assert.equal(awaits(one), false, 'a plan never handed over waits on no one');
  const handedOver = apply(one, 'agent', { op: 'plan.handover' });
  assert.equal(awaits(handedOver), true);
  assert.equal(awaits(signOff(handedOver, 'close')), false);
  assert.equal(awaits(signOff(one, 'close'), storyboardOf('Slides off')), true, 'a stale scene waits, handed over or not');
});

test('the project page sorts a file onto its rung by path', () => {
  const rungs = ['out/wip/animatic.mp4', 'out/wip/vid91-animatic.mp4', 'out/video.mp4', 'out/video-hevc.mov', 'out/stills/og.png',
    'out/still-sheets/og.png', 'out/wip/r1-open.jpg', 'out/wip/frames-0-100.mp4', 'out/joined.mp4'].map(projectPageRungOf);
  assert.deepEqual(rungs, ['animatic', 'animatic', 'cut', 'cut', 'stills', 'stills', 'older', 'older', 'older']);
});
