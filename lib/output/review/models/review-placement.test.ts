import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beatSpan, defineTimeline, tempoGrid, timelineClockTable } from '#lib/timing/timeline/models/timeline.ts';
import { reviewMomentAt, reviewTimingOf, type ReviewTiming } from './review-moment.ts';
import { layReviewSlices, placeReviewThread } from './review-placement.ts';
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

test('a note written on a slice laid into the cut is placed on the cut at the same picture, through where the slice starts', () => {
  const slice = { path: 'out/wip/slices/scene-swatches.mp4', hash: '0f1e2d3c4b' };
  const note: ReviewThread = { ...videoNote(12, false), anchor: { on: 'video', writtenOn: slice, frame: 12, end: 15 } };
  assert.deepEqual(placeReviewThread(note, { ...final, splices: [{ hash: slice.hash, startsAt: 60 }] }), { frame: 72, end: 75, shifted: false });
});

const slice = (name: string, from: number, end: number, started: string) => ({ thread: 1, path: `out/wip/slices/${name}.mp4`, hash: name, from, end, pictureOnly: false, started });

test('overlapping slices are laid newest first per frame: an older one shows only outside the newer ones\' spans', () => {
  // A spans 0–100, B (newer) 40–60 inside it, C (newest) 50–120 across B's end and A's.
  const laid = layReviewSlices([slice('A', 0, 100, '2026-10-11T12:01:00Z'), slice('B', 40, 60, '2026-10-11T12:02:00Z'), slice('C', 50, 120, '2026-10-11T12:03:00Z')]);
  assert.deepEqual(laid.map((s) => [s.hash, s.from, s.end, s.startsAt]), [['A', 0, 40, 0], ['B', 40, 50, 40], ['C', 50, 120, 50]]);
});
