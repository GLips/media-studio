import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beatSpan, defineTimeline, tempoGrid, timelineClockTable } from '#lib/timing/timeline/models/timeline.ts';
import { formatReviewMomentPlace, placeReviewMoment, reviewMomentAt, reviewTimingOf, type ReviewTiming } from './review-moment.ts';

// 120 bpm at 30 fps: a beat every 15 frames. Round 4 gives `swatches` two more beats, so `price` starts 30 frames later.
const timingOf = (swatchBeats: number, priceBeats = 4): ReviewTiming => {
  const timeline = defineTimeline({
    grid: tempoGrid(120),
    scenes: { bounce: beatSpan(4), swatches: beatSpan(swatchBeats), price: beatSpan(priceBeats, { cues: { clack: 1 } }) },
  });
  // Only `price` declares a rung; the timeline report's start and length are the clock's business here.
  return reviewTimingOf({ fps: 30, startsAt: 0, scenes: [{ id: 'price', from: 0, to: 0, rung: 'blocking' }], lines: [], clock: timelineClockTable(timeline) });
};
const before = timingOf(4), after = timingOf(6);

test('a moment read before a retime lands on its bar and beat after it, a cue ahead of its beat, and names its rung', () => {
  // f152: two frames past bar 3's beat 2 (from 0). f136: a frame past `clack`, which places it ahead of its beat.
  const beat = reviewMomentAt(152, before), cue = reviewMomentAt(136, before);
  assert.ok(beat && cue);
  assert.equal(formatReviewMomentPlace(beat), 'bar 3 · blocking · beat 2 +2f');
  assert.equal(formatReviewMomentPlace(cue), 'bar 3 · blocking · beat 1 +1f · price.clack +1f');
  assert.deepEqual([placeReviewMoment(beat, after), placeReviewMoment(cue, after)], [{ frame: 182 }, { frame: 166 }]);
  assert.deepEqual(placeReviewMoment(beat, timingOf(4, 2)), { unplaced: 'bar 3 (price) has beats 0–1 now, not beat 2' });
});

// One line from 1 s, a word every half second.
const lineTiming = (words: string[]) => reviewTimingOf({
  fps: 30, startsAt: 0, clock: null, scenes: [{ id: 'intro', from: 0, to: 150 }],
  lines: [{ id: 'hook', start: 1, end: 1 + words.length * 0.5, words: words.map((text, i) => ({ text, start: 1 + i * 0.5 })) }],
});

test('a moment on a spoken word follows the word when the line is re-read with a word more ahead of it', () => {
  const moment = reviewMomentAt(61, lineTiming(['one', 'price', 'for', 'all']));
  assert.ok(moment);
  assert.deepEqual(moment, { scene: 'intro', kind: 'word', line: 'hook', word: 2, text: 'for', frames: 1 });
  assert.deepEqual(placeReviewMoment(moment, lineTiming(['one', 'low', 'price', 'for', 'all'])), { frame: 76 });
});
