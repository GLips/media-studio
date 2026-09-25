import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectStudyCuts, measureStudyFrames, offBeatFrames, type BeatGrid } from './reel-study.ts';

const flat = (v: number) => ({ rgb: new Uint8Array(12).fill(v) });

test('finds a hard cut but not a steady fade', () => {
  // A fade that brightens a little every frame, then a jump to white: only the jump is a cut.
  const frames = [...Array.from({ length: 30 }, (_, i) => flat(i * 3)), ...Array.from({ length: 10 }, () => flat(255))];
  assert.deepEqual(detectStudyCuts(measureStudyFrames(frames), 60), [30]);
});

test('places a moment on the beat grid, in frames early or late', () => {
  const grid: BeatGrid = { bpm: 120, phase: 0.25, detectedBpm: 120, detectedBeats: [] };
  assert.deepEqual(offBeatFrames(grid, 0.25 + 3 * 0.5 + 2 / 60, 60), { beat: 3, frames: 2 });
  assert.deepEqual(offBeatFrames(grid, 0.25 + 5 * 0.5 - 3 / 60, 60), { beat: 5, frames: -3 });
});
