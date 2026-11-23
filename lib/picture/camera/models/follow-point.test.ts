import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followPointAt } from './follow-point.ts';
import { pointZoomOf } from './point-zoom.ts';

test('a followed cursor that jumps is aimed at as one glide, and the zoom on it never shows past the screen', () => {
  // The cursor jumps from the left to the right of a 4096×2304 screen at 1 s.
  const path = [{ t: 0, x: 100, y: 100 }, { t: 0.99, x: 100, y: 100 }, { t: 1, x: 4000, y: 2200 }, { t: 3, x: 4000, y: 2200 }];
  const aims = [0, 0.7, 0.9, 1, 1.1, 1.3, 2].map((t) => followPointAt(path, t, { seconds: 0.6 }).x);
  assert.ok(aims.every((x, i) => i === 0 || x >= aims[i - 1]), `aims move one way: ${aims.join(', ')}`);
  assert.ok(Math.abs(aims[3] - 2050) < 200 && aims[0] < 101 && aims[6] > 3999, `halfway at the jump, settled either side: ${aims.join(', ')}`);
  // Zoomed 2× into a 1920×1080 box, aimed at the corner: the picture's corner stays on the box's.
  const zoom = pointZoomOf({ w: 4096, h: 2304 }, { w: 1920, h: 1080 }, { x: 4000, y: 2200 }, 2);
  assert.equal(zoom.scale, (1920 / 4096) * 2);
  assert.deepEqual([zoom.x + 4096 * zoom.scale, zoom.y + 2304 * zoom.scale].map(Math.round), [1920, 1080]);
});
