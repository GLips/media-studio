import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintNodeClockStep } from '#lib/paint/animation/models/paint-clock.ts';
import { shotWarmFrames, shotWarmMoments, shotWarmProblems } from './shot-warm.ts';

test('a warm reads the render frames in its span and each clock\'s distinct moments, an instanced plane\'s shutter ends too', () => {
  const frames = shotWarmFrames({ from: 0.1, to: 0.3 }, 30);
  assert.deepEqual(frames.map(({ at }) => Math.round(at * 30)), [3, 4, 5, 6, 7, 8, 9]);
  // On twos at 24 fps, seven frames 1/30 s apart read three held moments.
  const held = shotWarmMoments(frames, [paintNodeClockStep({ hold: 2 })], 24);
  assert.deepEqual(held.map(({ at }) => Math.round(at * 24)), [2, 4, 6]);
  const items = shotWarmMoments(frames.slice(0, 1), [], 24, 1 / 60);
  assert.deepEqual(items.map(({ at, frame }) => [at * 120, frame * 120].map(Math.round)), [[12, 12], [11, 12], [13, 12]]);
  assert.deepEqual(shotWarmProblems({ from: 2, to: 1 }).map(({ path, message }) => `${path}: ${message}`), [
    "shot.warm: 2..1 isn't a span of scene seconds: from 0 or later, to no earlier than from",
  ]);
});
