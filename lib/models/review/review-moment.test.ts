import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beatSpan, defineTimeline, tempoGrid, timelineClockTable } from '#models/timeline/timeline.ts';
import { reviewTimingOf, type ReviewTiming } from './review-moment.ts';
import { formatReviewNotesMarkdown, placeReviewNotes, reviewNoteContext, type ReviewNote } from './review-notes.ts';

// 120 bpm at 30 fps: a beat every 15 frames. Round 4 gives `swatches` two more beats, so `price` starts 30 frames later.
const timingOf = (swatchBeats: number, priceBeats = 4): ReviewTiming => {
  const timeline = defineTimeline({
    grid: tempoGrid(120),
    scenes: { bounce: beatSpan(4), swatches: beatSpan(swatchBeats), price: beatSpan(priceBeats, { cues: { clack: 1 } }) },
  });
  return reviewTimingOf({ fps: 30, startsAt: 0, scenes: [], lines: [], clock: timelineClockTable(timeline) });
};
const before = timingOf(4), after = timingOf(6);
const render = { hash: 'round5', modified: '2026-09-25T12:00:00Z' };
const sources = (timing: ReviewTiming) => ({ fps: 30, frameSize: { w: 1000, h: 500 }, timing });
const written = (frame: number, text: string, extra: Partial<ReviewNote> = {}): ReviewNote =>
  ({ id: text, frame, render: 'round4', text, ...extra, context: reviewNoteContext({ frame }, sources(before)) });

test('a note written before a retime moves to its bar and beat on the new render, and the markdown gives the moment first', () => {
  // f152: two frames past bar 3's beat 2. f136: a frame past `clack`, which places it ahead of its beat.
  const notes = [written(152, 'the price lands soft', { end: 155, x: 0.4, y: 0.6 }), written(136, 'clack is late')];
  assert.equal(notes[0].context.moment?.kind, 'beat');
  const placed = placeReviewNotes(notes, { render, durationInFrames: 400, sources: sources(after) });
  assert.deepEqual(placed.map((n) => [n.frame, n.end, n.x, n.render, n.movedFrom]), [
    [182, 185, 0.4, 'round5', { render: 'round4', frame: 152 }],
    [166, undefined, undefined, 'round5', { render: 'round4', frame: 136 }],
  ]);
  const markdown = formatReviewNotesMarkdown({ media: 'out/video.mp4', kind: 'video', fps: 30, notes: placed }, { render });
  assert.match(markdown, /1\. \*\*bar 3 · beat 2 \+1f · price\.clack \+1f\*\*, f166 \(0:05\.53\) here \(f136 on render `round4`\): clack is late/);
  assert.match(markdown, /2\. \*\*bar 3 · beat 3 \+2f\*\*, f182 \(0:06\.07\)–f185 \(0:06\.17\) here \(f152 on render `round4`\) at \(0\.40, 0\.60\): the price lands soft/);
});

test('a note whose beat the new render no longer has stays on its frame and says why', () => {
  const [kept] = placeReviewNotes([written(160, 'hold the last beat')], { render, durationInFrames: 400, sources: sources(timingOf(4, 2)) });
  assert.deepEqual([kept.frame, kept.render, kept.unplaced], [160, 'round4', 'bar 3 (price) has 2 beats now, not beat 3']);
  assert.match(formatReviewNotesMarkdown({ media: 'out/video.mp4', kind: 'video', fps: 30, notes: [kept] }, { render }), /its moment isn't here: bar 3 \(price\) has 2 beats now/);
});

test('a note on a spoken word follows the word when the line is re-read with a word more ahead of it', () => {
  const lineTiming = (words: string[]) => reviewTimingOf({
    fps: 30, startsAt: 0, clock: null, scenes: [{ id: 'intro', start: 0, dur: 5 }],
    lines: [{ id: 'hook', start: 1, end: 1 + words.length * 0.5, words: words.map((text, i) => ({ text, start: 1 + i * 0.5 })) }],
  });
  const note: ReviewNote = { id: 'n', frame: 61, render: 'round4', text: 'lean on "for"', context: reviewNoteContext({ frame: 61 }, sources(lineTiming(['one', 'price', 'for', 'all']))) };
  assert.deepEqual(note.context.moment, { scene: 'intro', kind: 'word', line: 'hook', word: 2, text: 'for', frames: 1 });
  const [moved] = placeReviewNotes([note], { render, durationInFrames: 150, sources: sources(lineTiming(['one', 'low', 'price', 'for', 'all'])) });
  assert.equal(moved.frame, 76);
});
