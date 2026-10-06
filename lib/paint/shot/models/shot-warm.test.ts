import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintNodeClockStep } from '#lib/paint/animation/models/paint-clock.ts';
import { shotWarmCombinations, shotWarmFrames, shotWarmPastScene, shotWarmProblems } from './shot-warm.ts';

test("a warm reads the render frames in its span, only those its scene shows", () => {
  const frames = shotWarmFrames({ from: 0.1, to: 0.3 }, 30);
  assert.deepEqual(frames.map(({ at }) => Math.round(at * 30)), [3, 4, 5, 6, 7, 8, 9]);
  // A span written in frames runs past its 8 s scene: it warms the scene's frames, 0..239, and says so.
  assert.deepEqual(shotWarmFrames({ from: 7.9, to: 192 }, 30, 8).map(({ at }) => Math.round(at * 30)), [237, 238, 239]);
  assert.deepEqual(shotWarmPastScene({ from: 0, to: 192 }, 8).map(({ path, message }) => `${path}: ${message}`), [
    "shot.warm: runs to 192 s; its scene ends at 8 s: warm counts scene seconds, not frames, and stops at the scene's end",
  ]);
  assert.deepEqual(shotWarmProblems({ from: 2, to: 1 }).map(({ path, message }) => `${path}: ${message}`), [
    "shot.warm: 2..1 isn't a span of scene seconds: from 0 or later, to no earlier than from",
  ]);
});

test("a painted plane's warm solves each pairing of its clocks' moments once, a source and a movement held apart", () => {
  const frames = shotWarmFrames({ from: 0.1, to: 0.3 }, 30), twos = paintNodeClockStep({ hold: 2 }), threes = paintNodeClockStep({ hold: 3 });
  const solvedAt = (clocks: Parameters<typeof shotWarmCombinations>[1]) => shotWarmCombinations(frames, clocks, 24).map(({ at }) => Math.round(at * 30));
  // Its source on twos, its movement unheld: it moves every frame.
  assert.deepEqual(solvedAt([[twos], []]), [3, 4, 5, 6, 7, 8, 9]);
  // Its source on twos and its movement on threes: a frame pairing both as one before it solves nothing new.
  assert.deepEqual(solvedAt([[twos], [threes]]), [3, 4, 5, 8]);
});
