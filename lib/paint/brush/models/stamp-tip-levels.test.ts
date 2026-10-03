import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampTipLevels } from './stamp-tip-levels.ts';

test('a tip\'s levels halve down to one texel, each the mean of the four above it, a tie to the darker', () => {
  // 5 × 3: the odd column and row are dropped.
  const levels = stampTipLevels({ width: 5, height: 3, pixels: Uint8Array.from([
    255, 254, 0, 2, 9,
    255, 253, 0, 0, 9,
    9, 9, 9, 9, 9,
  ]) });
  assert.deepEqual(levels.map(({ width, height }) => [width, height]), [[5, 3], [2, 1], [1, 1]]);
  // 254.25 rounds to 254; 0.5 ties to 0. The last level reads its one row twice.
  assert.deepEqual([...levels[1].texels], [254, 0]);
  assert.deepEqual([...levels[2].texels], [127]);
});
