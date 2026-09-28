import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MotionSegment, MotionTracks } from '#models/motion/motion-tracks.ts';
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

test('the markdown lists notes in time order with their frame, timecode, point and context, and says which were on another render', () => {
  const md = formatReviewNotesMarkdown({
    media: 'work/projects/x/out/video.mp4', kind: 'video', fps: 30,
    notes: [
      { id: 'c', frame: 85, text: 'hold is short', context: {} },
      { id: 'b', frame: 80, render: '0441aaaaaa', text: 'whip lands late', cue: 'buy@80', context: { sounds: [{ id: 'buy@80', sound: 'whoosh.whip', frame: 80, targeted: true }] } },
      { id: 'a', frame: 60, x: 0.4, y: 0.4, render: '0855bbbbbb', text: 'price pops\ntoo early', context: { scenes: ['buy'], elements: [{ id: 'buy/card/price', kind: 'odometer' }] } },
    ],
  }, { title: 'X', savedTo: 'work/projects/x/review/notes-video.json', render: { hash: '0855bbbbbb', modified: '2026-09-25T15:55:00.000Z' } });
  assert.equal(md, [
    '## Review notes: X',
    '`work/projects/x/out/video.mp4` · render `0855bbbbbb` modified 2026-09-25T15:55:00.000Z · 30 fps · saved to `work/projects/x/review/notes-video.json`',
    '',
    '1. **f60 (0:02.00)** at (0.40, 0.40): price pops too early',
    '   - scene: buy',
    '   - under the point: `buy/card/price` (odometer)',
    '2. **f80 (0:02.67)**: whip lands late',
    '   - written on render `0441aaaaaa`, not this one',
    '   - sound: whoosh.whip `buy@80` at f80 (aimed at)',
    '3. **f85 (0:02.83)**: hold is short',
    '   - render not recorded',
    '',
  ].join('\n'));
});

test('a note on a variant sheet names the variant under its point, and whether the still check refused it', () => {
  const rect = (x: number) => ({ x, y: 0.1, w: 0.4, h: 0.8 });
  const cells = [
    { variant: 'short-card', axes: { headline: 'short', crop: 'card' }, refused: false, rect: rect(0.05) },
    { variant: 'long-card', axes: { headline: 'long', crop: 'card' }, refused: true, rect: rect(0.5) },
  ];
  const context = reviewNoteContext({ x: 0.7, y: 0.5 }, { fps: 30, frameSize: { w: 1, h: 1 }, cells });
  assert.deepEqual(context, { cell: { variant: 'long-card', axes: { headline: 'long', crop: 'card' }, refused: true } });
  assert.deepEqual(reviewNoteContext({ x: 0.47, y: 0.5 }, { fps: 30, frameSize: { w: 1, h: 1 }, cells }), {});
  const md = formatReviewNotesMarkdown({ media: 'work/projects/x/out/still-sheets/card-og.png', kind: 'still', notes: [{ id: 'a', x: 0.7, y: 0.5, text: 'this one', context }] }, {});
  assert.match(md, /variant: `long-card` \(headline long, crop card\), refused by the still check/);
});
