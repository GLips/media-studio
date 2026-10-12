import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beatSpan, defineTimeline, tempoGrid, timelineClockTable } from '#lib/timing/timeline/models/timeline.ts';
import { reviewMomentAt, reviewTimingOf, type ReviewTiming } from './review-moment.ts';
import { placeReviewThread } from './review-placement.ts';
import type { ReviewThread } from './review-threads.ts';

// 120 bpm at 30 fps, a beat every 15 frames. The final cut gives `swatches` two more beats, so `price` starts 30 later.
const timingOf = (swatchBeats: number): ReviewTiming => reviewTimingOf({
  fps: 30, startsAt: 0, scenes: [], lines: [],
  clock: timelineClockTable(defineTimeline({ grid: tempoGrid(120), scenes: { bounce: beatSpan(4), swatches: beatSpan(swatchBeats), price: beatSpan(4) } })),
});
const animatic = { path: 'out/wip/animatic.mp4', hash: 'cfbb1d2063' };
const final = { kind: 'video' as const, path: 'out/video.mp4', hash: 'a1b2c3d4e5', timing: timingOf(6), durationInFrames: 400 };
const videoNote = (frame: number, withMoment: boolean): ReviewThread => ({
  id: 1, kind: 'fix', state: 'open', rev: 1, entries: [{ author: 'reviewer', text: 'soft', at: '2026-10-11T12:00:00Z', rev: 1 }],
  anchor: { on: 'video', writtenOn: animatic, frame, end: frame + 3, ...(withMoment && { moment: reviewMomentAt(frame, timingOf(4)) }) },
});

test('a note on the animatic follows its moment onto the final render, written-on kept; one with no moment there is unplaced', () => {
  const note = videoNote(152, true);
  assert.deepEqual(placeReviewThread(note, final), { frame: 182, end: 185, shifted: true });
  assert.equal(note.anchor.on === 'video' && note.anchor.writtenOn, animatic);
  assert.deepEqual(placeReviewThread(note, { ...final, ...animatic, timing: timingOf(4) }), { frame: 152, end: 155, shifted: false });
  assert.ok('unplaced' in (placeReviewThread(videoNote(152, false), final) ?? {}));
});
