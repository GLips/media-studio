import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPieceTables, samplePieceTracks, type ScenePieces } from './piece-tracks.ts';

// A 100 px box sliding right 20 px a frame toward a HUD part at x 300–400: 200 px clear on frame 0, touching on frame
// 10, 40 px into it on frame 12 (then out of shot).
const hud = { tr: { x: 300, y: 0, w: 100, h: 50 } };
const pieces: ScenePieces = {
  tracks: { box: (f) => (f > 12 ? null : { x: 20 * f + 50, y: 25, box: { x: 20 * f, y: 0, w: 100, h: 50 } }) },
  keepClear: () => hud,
};
const scene = { clock: { id: 'slide', from: 0, to: 14 }, pieces };

test('clearance is the gap to the nearest kept-clear part, negative once the box overlaps it', () => {
  const [piece] = samplePieceTracks([scene], [0, 10, 12, 13]);
  assert.deepEqual(piece.rows.map((r) => r.clearance?.margin ?? null), [200, 0, -40, null]);
  const table = formatPieceTables([piece]);
  assert.ok(table.includes('tightest: frame 12, -40.0 px into tr'), table.join('\n'));
});

test('a piece is sampled only on the frames its scene plays', () => {
  const [piece] = samplePieceTracks([scene], [12, 13, 14, 15]);
  assert.deepEqual(piece.rows.map((r) => r.frame), [12, 13]);
  assert.deepEqual(samplePieceTracks([scene], [20, 21]), []);
});
