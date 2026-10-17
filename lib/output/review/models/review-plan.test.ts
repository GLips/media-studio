import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStoryboard } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';
import { storyboardSceneHash } from '#lib/timing/storyboard/models/storyboard-sign-off.ts';
import { formatReviewPlanWordDiff, placeReviewPlanThread, reviewPlanSceneTexts, reviewPlanSignoffs, reviewPlanWordDiff } from './review-plan.ts';
import type { ReviewPlanAnchor } from './review-threads.ts';

const plan = (verdict: string, closeMotion = 'It fades in') => defineStoryboard({
  title: 'A test plan',
  target: { seconds: 10 },
  voice: 'Callirrhoe',
  scenes: {
    plate: {
      onScreen: 'The camera on a plate',
      motion: 'Shutter on "photo"',
      lines: {
        snap: { text: 'Take a photo of your plate.', cues: { shutter: 'photo' } },
        verdict: { text: verdict },
      },
    },
    close: { onScreen: 'The end card', motion: closeMotion, seconds: 1.5 },
  },
});

const note = (text: string): ReviewPlanAnchor => ({ on: 'plan', scene: 'plate', field: 'line', line: 'verdict', text });

test('a quoted phrase is found again after the line is edited around it, and lands on its word', () => {
  const after = plan("Then you'll see straight away which FODMAPs are in it.");
  const resolvedAfter = resolveStoryboard(after);
  const placed = placeReviewPlanThread(note('FODMAPs are'), after, resolvedAfter);
  assert.deepEqual([placed.scene, placed.line, placed.words, placed.unplaced], ['plate', 'verdict', [6, 7], false]);
  // The frame is the quote's first word on the timeline, past the line's start.
  const verdictStart = resolvedAfter.timeline!.scene('plate').lines.find((l) => l.id === 'verdict')!.frame;
  assert.ok(placed.frame! > verdictStart);
});

test('a note whose quote has gone reads as unplaced, at its scene', () => {
  const edited = plan('You will know what is in it.');
  const resolved = resolveStoryboard(edited);
  const placed = placeReviewPlanThread(note('FODMAPs'), edited, resolved);
  assert.equal(placed.unplaced, true);
  assert.equal(placed.frame, resolved.timeline!.scene('plate').origin);
});

test('a scene edited after its sign-off reads as stale while another stays signed', () => {
  const signedPlan = plan("You'll see which FODMAPs are in it.");
  const signedResolved = resolveStoryboard(signedPlan);
  const signoffs = (['plate', 'close'] as const).map((scene) => ({
    on: 'plan' as const, scene, hash: storyboardSceneHash(signedPlan, signedResolved, scene)!, texts: reviewPlanSceneTexts(signedPlan, scene), at: '2026-10-16T09:00:00Z',
  }));
  // Only the close's motion changes, and it's the last scene, so the plate's timing doesn't move either.
  const edited = plan("You'll see which FODMAPs are in it.", 'It slides up');
  const states = reviewPlanSignoffs(edited, resolveStoryboard(edited), signoffs);
  assert.deepEqual(states.map((s) => [s.scene, s.state]), [['plate', 'signed'], ['close', 'stale']]);
  // The stale scene says what changed, field by field, from the texts its sign-off kept.
  assert.deepEqual(states[1].changes, [{ key: 'motion', was: 'It fades in', now: 'It slides up' }]);
});

test('a word diff keeps the words both say and marks the rest removed, then added', () => {
  const runs = reviewPlanWordDiff("You'll see which FODMAPs are in it.", "You'll see straight away which ingredients are in it.");
  assert.deepEqual(runs, [
    { kind: 'same', text: "You'll see" }, { kind: 'added', text: 'straight away' }, { kind: 'same', text: 'which' },
    { kind: 'removed', text: 'FODMAPs' }, { kind: 'added', text: 'ingredients' }, { kind: 'same', text: 'are in it.' },
  ]);
  assert.equal(formatReviewPlanWordDiff(runs), "You'll see {+straight away+} which [-FODMAPs-] {+ingredients+} are in it.");
});
