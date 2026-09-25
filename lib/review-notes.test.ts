import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MotionSegment, MotionTracks } from './motion-tracks.ts';
import { formatReviewNotesMarkdown, reviewNoteContext, type ReviewContextSources } from './review-notes.ts';

// 30 fps, 1000×500 frame. `intro` then `buy` from 2 s; a card with a price inside it, both on frames 60–90.
const box = (x: number, y: number, w: number, h: number): MotionSegment => {
  const n = 31, of = (v: number) => Array(n).fill(v);
  return { start: 60, end: 90, phase: 'solo', parent: null, attribution: 'scene', screen: { x: of(x), y: of(y), w: of(w), h: of(h), opacity: of(1) }, local: null, values: {} };
};
const motion: MotionTracks = {
  version: 2, fps: 30, frames: { first: 0, last: 90 }, coverage: { scenes: [], ambiguous: [] }, errors: [],
  tracks: [
    { id: 'buy/camera', scene: 'buy', name: 'camera', kind: 'camera', segments: [box(500, 250, 1000, 500)] },
    { id: 'buy/card', scene: 'buy', name: 'card', segments: [box(500, 250, 600, 300)] },
    { id: 'buy/card/price', scene: 'buy', name: 'price', kind: 'odometer', segments: [box(400, 200, 100, 40)] },
  ],
};
const sources: ReviewContextSources = {
  fps: 30, frameSize: { w: 1000, h: 500 },
  scenes: [{ id: 'intro', start: 0, dur: 2 }, { id: 'buy', start: 2, dur: 2 }],
  sounds: [
    { id: 'buy@63', at: 63 / 30, frame: 63, sound: 'impact', source: 'video' },
    { id: 'buy@80', at: 80 / 30, frame: 80, sound: 'whoosh.whip', source: 'video' },
  ],
  motion,
};

test('a note names its scene, the sounds within 3 frames and what is under its point, smallest first', () => {
  assert.deepEqual(reviewNoteContext({ frame: 60, x: 0.4, y: 0.4 }, sources), {
    scenes: ['buy'],
    sounds: [{ id: 'buy@63', sound: 'impact', frame: 63 }],
    elements: [{ id: 'buy/card/price', kind: 'odometer' }, { id: 'buy/card' }],
  });
});

test('a note aimed at a sound names it even out of reach; a range spans scenes; a missing artifact leaves its field off', () => {
  const aimed = reviewNoteContext({ frame: 20, cue: 'buy@80' }, sources);
  assert.deepEqual(aimed.sounds, [{ id: 'buy@80', sound: 'whoosh.whip', frame: 80, targeted: true }]);
  assert.deepEqual(reviewNoteContext({ frame: 50, end: 70 }, sources).scenes, ['intro', 'buy']);
  // A scene starting at 2.01 s first paints on frame 61, as scenesAt does: frame 60 is still the intro's.
  const offFrame = { ...sources, scenes: [{ id: 'intro', start: 0, dur: 2.01 }, { id: 'buy', start: 2.01, dur: 2 }] };
  assert.deepEqual(reviewNoteContext({ frame: 60 }, offFrame).scenes, ['intro']);
  assert.deepEqual(reviewNoteContext({ frame: 61 }, offFrame).scenes, ['buy']);
  assert.deepEqual(reviewNoteContext({ frame: 60, x: 0.4, y: 0.4 }, { fps: 30, frameSize: sources.frameSize }), {});
});

test('the markdown lists notes in time order with their frame, timecode, point and context', () => {
  const md = formatReviewNotesMarkdown({
    media: 'projects/x/out/video.mp4', kind: 'video', fps: 30,
    notes: [
      { id: 'b', frame: 80, text: 'whip lands late', cue: 'buy@80', context: { sounds: [{ id: 'buy@80', sound: 'whoosh.whip', frame: 80, targeted: true }] } },
      { id: 'a', frame: 60, x: 0.4, y: 0.4, text: 'price pops\ntoo early', context: { scenes: ['buy'], elements: [{ id: 'buy/card/price', kind: 'odometer' }] } },
    ],
  }, { title: 'X', savedTo: 'projects/x/review/notes-video.json' });
  assert.equal(md, [
    '## Review notes: X',
    '`projects/x/out/video.mp4` · 30 fps · saved to `projects/x/review/notes-video.json`',
    '',
    '1. **f60 (0:02.00)** at (0.40, 0.40): price pops too early',
    '   - scene: buy',
    '   - under the point: `buy/card/price` (odometer)',
    '2. **f80 (0:02.67)**: whip lands late',
    '   - sound: whoosh.whip `buy@80` at f80 (aimed at)',
    '',
  ].join('\n'));
});
