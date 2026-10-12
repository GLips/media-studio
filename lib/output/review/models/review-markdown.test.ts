import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatReviewThreadsMarkdown } from './review-markdown.ts';
import type { PlacedReviewThread } from './review-placement.ts';
import type { ReviewThreadKind, ReviewThreadState } from './review-threads.ts';

const writtenOn = { path: 'out/video.mp4', hash: 'a1b2c3d4e5' };
const thread = (id: number, kind: ReviewThreadKind, state: ReviewThreadState, text: string): PlacedReviewThread => ({
  id, kind, state, rev: id, entries: [{ author: 'reviewer', text, at: '2026-10-11T12:00:00Z', rev: id }],
  anchor: { on: 'video', writtenOn, frame: id * 30, point: { x: 0.5, y: 0.5 }, image: `review/frames/${id}.jpg` },
  placement: { frame: id * 30, shifted: false },
});

test('the markdown keeps a note\'s paragraphs, lists open and reopened notes by default, and always lists keeps', () => {
  const markdown = formatReviewThreadsMarkdown([
    thread(1, 'fix', 'open', 'The second strike lands soft.\n\nGive it the ease the first one has.'),
    thread(2, 'fix', 'resolved', 'whip is late'),
    thread(3, 'fix', 'addressed', 'logo too small'),
    thread(4, 'keep', 'open', 'the end card holds two seconds'),
    thread(5, 'question', 'reopened', 'why the cut here?'),
  ], { project: 'zz-review-sandbox', renderPath: 'out/video.mp4', renderHash: 'a1b2c3d4e5', fps: 30, size: { w: 1920, h: 1080 } });
  assert.match(markdown, /The second strike lands soft\.\n\nGive it the ease the first one has\./);
  assert.deepEqual([...markdown.matchAll(/^### #(\d+)/gm)].map((m) => Number(m[1])), [1, 5, 4]);
  assert.match(markdown, /## Keep\n\n### #4 keep/);
  assert.match(markdown, /frame: work\/projects\/zz-review-sandbox\/review\/frames\/1\.jpg/);
  assert.match(markdown, /look: studio look zz-review-sandbox --video out\/video\.mp4 --frames 27:33 --crop 760,390,400,300/);
});

test('a note on another still is read in that still\'s own pixels, never the render\'s', () => {
  const still: PlacedReviewThread = {
    id: 9, kind: 'fix', state: 'open', rev: 9, entries: [{ author: 'reviewer', text: 'crop tighter', at: '2026-10-11T12:00:00Z', rev: 9 }],
    anchor: { on: 'still', writtenOn: { path: 'out/stills/bar4.png', hash: 'f00d' }, point: { x: 0.5, y: 0.25 } },
    placement: { shifted: false },
  };
  const markdown = formatReviewThreadsMarkdown([still], {
    project: 'zz-review-sandbox', renderPath: 'out/video.mp4', renderHash: 'a1b2c3d4e5', fps: 30, size: { w: 1920, h: 1080 },
    stills: { 'out/stills/bar4.png': { hash: 'f00d', size: { w: 1280, h: 1600 } } },
  });
  assert.match(markdown, /point \(640, 400\) px of 1280×1600/);
  assert.doesNotMatch(markdown, /unplaced|written on/);
});

test('a note on a playing decision candidate says the time it was heard at', () => {
  const heard: PlacedReviewThread = {
    id: 12, kind: 'fix', state: 'open', rev: 12, entries: [{ author: 'reviewer', text: 'the drop is late', at: '2026-10-11T12:00:00Z', rev: 12 }],
    anchor: { on: 'decision', decision: 7, candidate: 'b', at: 12.04 },
    placement: { shifted: false },
  };
  const markdown = formatReviewThreadsMarkdown([heard], { project: 'zz-review-sandbox', renderPath: 'out/video.mp4', renderHash: 'a1b2c3d4e5', fps: 30, size: { w: 1920, h: 1080 } });
  assert.match(markdown, /### #12 fix · open — decision #7, candidate b at 0:12\.04/);
});
