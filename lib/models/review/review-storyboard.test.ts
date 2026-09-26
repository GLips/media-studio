import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beatSpan, defineTimeline, tempoGrid, timelineClockTable } from '#models/timeline/timeline.ts';
import { reviewStoryboardOf, reviewTimingMarksOf } from './review-storyboard.ts';

// 120 bpm at 30 fps: a beat every 15 frames. `bounce` is frames 0–60, `price` 60–120 with `clack` on its beat 1.
const clock = timelineClockTable(defineTimeline({
  grid: tempoGrid(120),
  scenes: { bounce: beatSpan(4), price: beatSpan(4, { cues: { clack: 1 } }) },
}));
const scenes = [
  { id: 'bounce', start: 0, dur: 2, lines: [] },
  { id: 'price', start: 2, dur: 2, note: 'the price rolls down', rung: 'board' as const, lines: [] },
];

test('a card per scene carries its rung and note, with a still on each cue captioned in timeline.ts\'s words; a slice keeps what it holds', () => {
  const whole = reviewStoryboardOf({ fps: 30, frames: { from: 0, end: 120 }, scenes, lines: [], clock });
  assert.deepEqual(whole.map((c) => [c.id, c.rung, c.from, c.to, c.timing]), [['bounce', undefined, 0, 60, '4 beats'], ['price', 'board', 60, 120, '4 beats']]);
  assert.deepEqual(whole[1].stills, [{ frame: 75, moments: [{ kind: 'cue', name: 'clack', frame: 75, at: 'beat 1' }] }]);
  // `bounce` names nothing, so it gets a still from its middle.
  assert.deepEqual(whole[0].stills, [{ frame: 30, moments: [] }]);

  const slice = reviewStoryboardOf({ fps: 30, frames: { from: 60, end: 120 }, scenes, lines: [], clock });
  assert.deepEqual(slice.map((c) => [c.id, c.from, c.stills.map((s) => s.frame)]), [['price', 0, [15]]]);
  const marks = reviewTimingMarksOf({ frames: { from: 60, end: 120 }, clock });
  assert.deepEqual([marks.beats.length, marks.beats.some((b) => b.down), marks.moments.map((m) => [m.scene, m.name, m.frame])], [4, false, [['price', 'clack', 15]]]);
});
