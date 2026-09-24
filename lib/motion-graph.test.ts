import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findChannelMoves } from './motion-graph.ts';

const fps = 30, still = 0.05;

test('a spring that overshoots reads as one move, with its overshoot and when it lands', () => {
  // 0 → 100 over 10 frames, past it to 112, back under to 98, then settles on 100 and holds.
  const values = [0, 0, 10, 30, 55, 80, 100, 112, 108, 98, 100, 100, 100, 100];
  const [move, ...rest] = findChannelMoves([{ start: 30, values }], { fps, still });
  assert.equal(rest.length, 0);
  assert.deepEqual([move.start, move.end, move.from, move.to], [31, 40, 0, 100]);
  assert.deepEqual(move.overshoot, { by: 12, frame: 37 });
  assert.equal(move.windup, undefined);
  assert.equal(move.reversals, 2);
  // Within 1 of 100 from frame 40 only: 98 at 39 is still 2 off.
  assert.equal(move.landed, 40);
});

test('a long hold ends a move, a missing sample breaks one, and nothing joins across series', () => {
  const hold = Array(10).fill(50);
  const moves = findChannelMoves([
    { start: 0, values: [0, 25, 50, ...hold, 75, 100] },
    { start: 100, values: [100, null, 90, 80] },
  ], { fps, still });
  assert.deepEqual(moves.map((m) => [m.start, m.end, m.from, m.to]), [[0, 2, 0, 50], [12, 14, 50, 100], [102, 103, 90, 80]]);
});
