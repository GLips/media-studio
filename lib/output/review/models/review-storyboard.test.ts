import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beatSpan, defineTimeline, tempoGrid, timelineClockTable } from '#lib/timing/timeline/models/timeline.ts';
import { reviewBoardOf, reviewStoryboardOf, reviewTimingMarksOf } from './review-storyboard.ts';

// 120 bpm at 30 fps: a beat every 15 frames. `bounce` is frames 0–60, `price` 60–120 with `clack` on its beat 1.
const clock = timelineClockTable(defineTimeline({
  grid: tempoGrid(120),
  scenes: { bounce: beatSpan(4), price: beatSpan(4, { cues: { clack: 1 } }) },
}));
const scenes = [
  { id: 'bounce', from: 0, to: 60, lines: [] },
  { id: 'price', from: 60, to: 120, note: 'the price rolls down', rung: 'blocking' as const, lines: [] },
];

test('a card per scene carries its rung and note, with a still on each cue captioned in the plan\'s words; a slice keeps what it holds', () => {
  const whole = reviewStoryboardOf({ fps: 30, frames: { from: 0, end: 120 }, scenes, lines: [], clock });
  assert.deepEqual(whole.map((c) => [c.id, c.rung, c.from, c.to, c.timing]), [['bounce', undefined, 0, 60, '4 beats'], ['price', 'blocking', 60, 120, '4 beats']]);
  assert.deepEqual(whole[1].stills, [{ frame: 75, moments: [{ kind: 'cue', name: 'clack', frame: 75, at: 'beat 1' }] }]);
  // `bounce` names nothing, so it gets a still from its middle.
  assert.deepEqual(whole[0].stills, [{ frame: 30, moments: [] }]);

  const slice = reviewStoryboardOf({ fps: 30, frames: { from: 60, end: 120 }, scenes, lines: [], clock });
  assert.deepEqual(slice.map((c) => [c.id, c.from, c.stills.map((s) => s.frame)]), [['price', 0, [15]]]);
  const marks = reviewTimingMarksOf({ frames: { from: 60, end: 120 }, clock });
  assert.deepEqual([marks.beats.length, marks.beats.some((b) => b.down), marks.moments.map((m) => [m.scene, m.name, m.frame])], [4, false, [['price', 'clack', 15]]]);
});

test('the Board of a 9:16 render draws its tiles at 9:16, a row per scene; without a snapshot, one row spread across the file', () => {
  const storyboard = reviewStoryboardOf({ fps: 30, frames: { from: 0, end: 120 }, scenes, lines: [], clock });
  const tall = reviewBoardOf({ storyboard, frameSize: { w: 1080, h: 1920 }, durationInFrames: 120 });
  assert.equal(tall.aspect, 9 / 16);
  assert.deepEqual(tall.rows.map((r) => [r.scene?.id, r.scene?.rung, r.stills.map((s) => s.frame)]), [['bounce', undefined, [30]], ['price', 'blocking', [75]]]);

  const untimed = reviewBoardOf({ frameSize: null, durationInFrames: 120 });
  assert.equal(untimed.aspect, null);
  assert.deepEqual(untimed.rows.map((r) => [r.scene, r.stills.map((s) => s.frame)]), [[undefined, [5, 15, 25, 35, 45, 55, 65, 75, 85, 95, 105, 115]]]);
});
