import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';
import { reviewDecisionAfterSignOff, reviewDecisionPass, reviewDecisionsInStoryOrder, reviewStoryOrderOf } from './review-decisions.ts';
import type { ReviewDecision, ReviewDecisionAbout } from './review-threads.ts';

const storyboard = defineStoryboard({
  title: 'Queue',
  target: { seconds: 10 },
  scenes: {
    hook: { onScreen: '', motion: '', lines: { open: { text: 'One.' }, turn: { text: 'Two.' } } },
    proof: { onScreen: '', motion: '', lines: { show: { text: 'Three.' } } },
  },
});
const order = reviewStoryOrderOf(storyboard);

let nextId = 1;
const decision = (topic: string, about?: ReviewDecisionAbout, state: ReviewDecision['state'] = 'open'): ReviewDecision => ({
  id: nextId++, topic, question: '?', choose: 'one', state, rev: 1, at: '2026-11-22T12:00:00Z', candidates: [], ...(about && { about }),
});
const topics = (decisions: readonly ReviewDecision[]) => decisions.map((d) => d.topic);

test('decisions walk in story order: by scene, a scene\'s own before its lines\', then those about no scene', () => {
  const posted = [
    decision('headline'),
    decision('proof-show', { scene: 'proof', line: 'show' }),
    decision('hook-turn', { scene: 'hook', line: 'turn' }),
    decision('cut-scene', { scene: 'gone' }),
    decision('hook-look', { scene: 'hook' }),
    decision('hook-open', { scene: 'hook', line: 'open' }),
  ];
  assert.deepEqual(topics(reviewDecisionsInStoryOrder(posted, order)), ['hook-look', 'hook-open', 'hook-turn', 'proof-show', 'headline', 'cut-scene']);
});

test('a pass keeps a decision signed off during it in place, leaves out ones settled before it, and takes in new ones', () => {
  const before = decision('old', { scene: 'hook' }, 'decided');
  const signed = decision('hook-open', { scene: 'hook', line: 'open' }, 'decided');
  const open = decision('proof-show', { scene: 'proof', line: 'show' });
  const posted = decision('hook-turn', { scene: 'hook', line: 'turn' });
  const walked = new Set(['hook-open', 'proof-show']);
  assert.deepEqual(topics(reviewDecisionPass([before, signed, open, posted], walked, order)), ['hook-open', 'hook-turn', 'proof-show']);
});

test('signing off goes to the next open decision, then back to an earlier one, then nowhere', () => {
  const pass = [decision('a'), decision('b', undefined, 'decided'), decision('c'), decision('d')];
  assert.equal(reviewDecisionAfterSignOff(pass, 'a'), 'c');
  assert.equal(reviewDecisionAfterSignOff(pass, 'd'), 'a');
  assert.equal(reviewDecisionAfterSignOff([pass[0], pass[1]], 'a'), null);
});
