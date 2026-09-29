import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recapPopStarts } from './recap.ts';

const FPS = 30;
const frames = (starts: number[]) => starts.map((s) => Math.round(s * FPS * 1e6) / 1e6);

test('tiles pop in the reference\'s orders, on whole frames', () => {
  // The 2×2 in Z order, a frame apart; the 3×3 by anti-diagonal over 0.1 s; a 3×2 from its middle column out.
  assert.deepEqual(frames(recapPopStarts(4, 2, 2, 'z', 0.1, FPS)), [0, 1, 2, 3]);
  assert.deepEqual(frames(recapPopStarts(9, 3, 3, 'antidiagonal', 0.1, FPS)), [0, 1, 2, 1, 2, 2, 2, 2, 3]);
  assert.deepEqual(frames(recapPopStarts(6, 3, 2, 'centre', 0.1, FPS)), [3, 0, 3, 3, 0, 3]);
});
