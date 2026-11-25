import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyReviewOpsToFile, ReviewOpRefused, type NewDecision, type ReviewOp, type ReviewOpsApplied } from './review-ops.ts';
import { emptyReviewFile, REVIEW_WORKING_STALE_MS, reviewThreadWorkingUntil, type ReviewAuthor, type ReviewFile } from './review-threads.ts';

const render = { path: 'out/video.mp4', hash: 'a1b2c3d4e5' };
const apply = (file: ReviewFile, author: ReviewAuthor, ...ops: ReviewOp[]) =>
  applyReviewOpsToFile(file, ops, { author, now: '2026-10-11T12:00:00Z', writtenOnOf: (r) => r });
const applied = (result: ReturnType<typeof apply>): ReviewOpsApplied => {
  assert.ok('file' in result, 'expected the ops to apply');
  return result;
};
const note = (text: string): ReviewOp => ({ op: 'thread.add', kind: 'fix', anchor: { on: 'video', writtenOn: render, frame: 120 }, text });
const planSignoff = (scene: string): ReviewOp => ({ op: 'signoff', signoff: { on: 'plan', scene, hash: 'h', texts: {}, at: '2026-10-11T12:00:00Z' } });
const withNote = applied(apply(emptyReviewFile(), 'reviewer', note('the price lands soft'))).file;

test('the agent marks a note addressed and only the reviewer resolves or reopens it; a reviewer reply reopens an addressed note', () => {
  const addressed = applied(apply(withNote, 'agent', { op: 'thread.reply', id: 1, text: 'harder ease', transition: 'addressed', commit: { engine: 'c2f33d9' } })).file;
  assert.equal(addressed.threads[0].state, 'addressed');
  assert.throws(() => apply(addressed, 'agent', { op: 'thread.reply', id: 1, text: '', transition: 'resolved' }), ReviewOpRefused);
  assert.throws(() => apply(addressed, 'agent', { op: 'thread.reply', id: 1, text: '', transition: 'reopened' }), ReviewOpRefused);
  const refixed = applied(apply(addressed, 'agent', { op: 'thread.reply', id: 1, text: 'harder still', transition: 'addressed', render })).file.threads[0];
  assert.deepEqual([refixed.state, refixed.entries.length, refixed.entries.at(-1)?.render], ['addressed', 3, render]);
  const resolved = applied(apply(addressed, 'reviewer', { op: 'thread.resolveAddressed', ids: [1] })).file;
  assert.equal(resolved.threads[0].state, 'resolved');
  assert.throws(() => apply(resolved, 'agent', { op: 'thread.reply', id: 1, text: 'again', transition: 'addressed' }), ReviewOpRefused);
  const answered = applied(apply(addressed, 'reviewer', { op: 'thread.reply', id: 1, text: 'still soft' })).file.threads[0];
  assert.deepEqual([answered.state, answered.entries.at(-1)?.transition], ['reopened', 'reopened']);
});

test('a take-back undoes the reviewer\'s resolve to the state before it, but not once an agent has replied since', () => {
  const addressed = applied(apply(withNote, 'agent', { op: 'thread.reply', id: 1, text: 'harder ease', transition: 'addressed' })).file;
  const resolved = applied(apply(addressed, 'reviewer', { op: 'thread.resolveAddressed', ids: [1] })).file;
  const takenBack = applied(apply(resolved, 'reviewer', { op: 'thread.takeBack', id: 1 })).file.threads[0];
  assert.deepEqual([takenBack.state, takenBack.entries.length], ['addressed', 2]);
  const repliedSince = applied(apply(resolved, 'agent', { op: 'thread.reply', id: 1, text: 'thanks' })).file;
  assert.equal(applied(apply(repliedSince, 'reviewer', { op: 'thread.takeBack', id: 1 })).file.threads[0].state, 'resolved');
});

test('ops built on the same stale revision both apply, and only an edit to a note changed since conflicts', () => {
  const agentReply = applied(apply(withNote, 'agent', { op: 'thread.reply', id: 1, text: 'on it', asks: true })).file;
  const both = applied(apply(agentReply, 'reviewer', note('the whip is late')));
  assert.deepEqual([both.file.revision, both.file.threads.map((t) => t.id)], [3, [1, 2]]);
  // A reply since the editor loaded the note doesn't conflict; another edit does, and nothing applies.
  const edited = applied(apply(agentReply, 'reviewer', { op: 'thread.edit', id: 1, ifRev: 1, text: 'the price lands far too soft' })).file;
  const stale = apply(edited, 'reviewer', { op: 'thread.edit', id: 1, ifRev: 1, text: 'lands soft, and late' }, note('never added'));
  assert.ok('conflict' in stale);
  assert.deepEqual([stale.revision, stale.conflict.entries[0].text], [3, 'the price lands far too soft']);
});

test('a decision that asks for one is refused sign-off until the reviewer picks one', () => {
  const candidates: NewDecision['candidates'] = [{ key: 'a', label: 'suno', meta: {} }, { key: 'b', label: 'eleven', meta: { cost: 1.1 } }];
  const posted = applied(apply(withNote, 'agent', { op: 'decision.put', decision: { topic: 'music-bed', question: 'Which bed under the VO?', choose: 'one', candidates } })).file;
  assert.throws(() => apply(posted, 'reviewer', { op: 'decision.close', id: 2 }), /pick a candidate before signing off/);
  const picked = applied(apply(posted, 'reviewer', { op: 'decision.verdict', id: 2, candidate: 'b', verdict: 'pick' }, { op: 'decision.close', id: 2 })).file;
  assert.deepEqual(picked.decisions[0].decided?.picks, ['b']);
});

test('a round posted without its scene and line keeps the place its topic had, so it stays put in the reviewer\'s pass', () => {
  const candidates: NewDecision['candidates'] = [{ key: 'a', label: 'take 1', meta: {} }, { key: 'b', label: 'take 2', meta: {} }];
  const put = (about?: NewDecision['about']): ReviewOp => ({ op: 'decision.put', decision: { topic: 'take-open', question: 'Which take?', choose: 'one', candidates, ...(about && { about }) } });
  const first = applied(apply(emptyReviewFile(), 'agent', put({ scene: 'hook', line: 'open' }))).file;
  const signed = applied(apply(first, 'reviewer', { op: 'decision.verdict', id: 1, candidate: 'a', verdict: 'pick' }, { op: 'decision.close', id: 1 })).file;
  const again = applied(apply(signed, 'agent', put())).file;
  assert.deepEqual(again.decisions.map((d) => [d.id, d.about]), [[1, { scene: 'hook', line: 'open' }], [2, { scene: 'hook', line: 'open' }]]);
});

const takeRange = (to: number): NewDecision['candidates'][number] => ({ key: 'a', label: 'take 1', library: { item: 'rec', from: 31, to }, meta: {} });

test('a take choice re-posted keeps the verdict on a library range only while the range is the same', () => {
  const put = (to: number): ReviewOp => ({ op: 'decision.put', decision: { topic: 'take-open', question: 'Which take?', choose: 'one', candidates: [takeRange(to), { key: 'b', label: 'take 2', meta: {} }] } });
  const picked = applied(apply(applied(apply(emptyReviewFile(), 'agent', put(36))).file, 'reviewer', { op: 'decision.verdict', id: 1, candidate: 'a', verdict: 'pick' })).file;
  assert.equal(applied(apply(picked, 'agent', put(36))).file.decisions[0].candidates[0].verdict, 'pick');
  assert.equal(applied(apply(picked, 'agent', put(37))).file.decisions[0].candidates[0].verdict, undefined);
});

test('only the agent hands the plan over, and only the reviewer takes back a scene\'s sign-off, leaving the others', () => {
  assert.throws(() => apply(withNote, 'reviewer', { op: 'plan.handover' }), ReviewOpRefused);
  const handedOver = applied(apply(withNote, 'agent', { op: 'plan.handover' })).file;
  assert.deepEqual(handedOver.planHandover, { at: '2026-10-11T12:00:00Z' });
  const signed = applied(apply(handedOver, 'reviewer', planSignoff('plate'), planSignoff('close'))).file;
  assert.throws(() => apply(signed, 'agent', { op: 'signoff.takeBack', scene: 'plate' }), ReviewOpRefused);
  const takenBack = applied(apply(signed, 'reviewer', { op: 'signoff.takeBack', scene: 'plate' })).file;
  assert.deepEqual(takenBack.signoffs.map((s) => s.on === 'plan' && s.scene), ['close']);
});

test('a restored thread writes and later deletes its frame image only at review/frames/<id>, whatever path it arrives with', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
  const thread = { ...withNote.threads[0], anchor: { on: 'video' as const, writtenOn: render, frame: 120, image: 'project.ts' } };
  const restored = applied(apply(emptyReviewFile(), 'reviewer', { op: 'thread.restore', thread, image: jpeg }));
  assert.deepEqual(restored.writes.map((w) => w.path), ['review/frames/1.jpg']);
  assert.deepEqual(applied(apply(restored.file, 'reviewer', { op: 'thread.delete', id: 1 })).deletes, ['review/frames/1.jpg']);
});

test('an agent\'s reply names the render that shows the fix by path and hash, and one outside the project is refused', () => {
  const slice = { path: 'out/wip/slices/scene-ink.mp4', hash: '0f1e2d3c4b' };
  const replied = applied(apply(withNote, 'agent', { op: 'thread.reply', id: 1, text: 'eased', transition: 'addressed', render: slice })).file;
  assert.deepEqual(replied.threads[0].entries.at(-1)?.render, slice);
  assert.throws(() => apply(withNote, 'agent', { op: 'thread.reply', id: 1, text: 'eased', render: { path: '../secrets.mp4', hash: '0f1e2d3c4b' } }), ReviewOpRefused);
  assert.throws(() => apply(withNote, 'agent', { op: 'thread.reply', id: 1, text: 'eased', render: { ...slice, hash: 'HEAD' } }), ReviewOpRefused);
  // Not in normal form, it would match no archived version's path.
  assert.throws(() => apply(withNote, 'agent', { op: 'thread.reply', id: 1, text: 'eased', render: { ...slice, path: `./${slice.path}` } }), ReviewOpRefused);
});

test('the agent marks a note it starts on, and its next reply on it, of any kind, clears the mark', () => {
  assert.throws(() => apply(withNote, 'reviewer', { op: 'thread.working', ids: [1] }), ReviewOpRefused);
  const started = applied(apply(withNote, 'agent', { op: 'thread.working', ids: [1] })).file;
  assert.deepEqual(started.threads[0].working, { at: '2026-10-11T12:00:00Z' });
  // The reviewer saying more leaves the agent on it; the agent's plain reply ends it.
  const nudged = applied(apply(started, 'reviewer', { op: 'thread.reply', id: 1, text: 'and the whip' })).file;
  assert.ok(nudged.threads[0].working);
  assert.equal(applied(apply(nudged, 'agent', { op: 'thread.reply', id: 1, text: 'looking at both' })).file.threads[0].working, undefined);
});

test('a working mark reads as worked on for 30 minutes, then lapses, and never on a resolved note', () => {
  const started = applied(apply(withNote, 'agent', { op: 'thread.working', ids: [1] })).file.threads[0];
  const at = Date.parse('2026-10-11T12:00:00Z');
  assert.equal(reviewThreadWorkingUntil(started, at + 29 * 60_000), at + REVIEW_WORKING_STALE_MS);
  assert.equal(reviewThreadWorkingUntil(started, at + 31 * 60_000), null);
  assert.equal(reviewThreadWorkingUntil({ ...started, state: 'resolved' }, at), null);
});
