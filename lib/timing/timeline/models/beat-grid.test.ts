import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beatGrid } from './beat-grid.ts';

test('a steady grid sits on the real beats where the tracker was pulled off them', () => {
  // 120 BPM from 0.4 s, as a tracker reads a syncopated track: beats 2–11 pulled 80 ms early, the rest within 10 ms.
  const beats = Array.from({ length: 48 }, (_, i) => 0.4 + i * 0.5 + (i >= 2 && i < 12 ? -0.08 : ((i * 7) % 5) * 0.004 - 0.008));
  const grid = beatGrid({ bpm: 119.8, beats }, { steady: true });
  for (const n of [0, 5, 20, 47]) assert.ok(Math.abs(grid.at(n) - (0.4 + n * 0.5)) < 0.006, `beat ${n} at ${grid.at(n)}`);
  assert.equal(grid.frame(5, 30), 87);
});
