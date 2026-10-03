import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampTipLevels } from '#lib/paint/brush/models/stamp-tip-levels.ts';
import { stampTipHull } from './stamp-tip-hull.ts';

/** A tip `size` texels across painting an off-centre soft disc, white round it, and its levels as the GPU gets them. */
function discTip(size: number) {
  const pixels = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - size * 0.4, y + 0.5 - size * 0.55) / (size * 0.3);
    pixels[y * size + x] = Math.round(255 * Math.min(1, Math.max(0, d - 0.6) / 0.4));
  }
  return stampTipLevels({ width: size, height: size, pixels });
}

const inside = (hull: Float32Array, x: number, y: number) => {
  for (let i = 0; i < hull.length; i += 2) {
    const [ax, ay, bx, by] = [hull[i], hull[i + 1], hull[(i + 2) % hull.length], hull[(i + 3) % hull.length]];
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < -1e-6) return false;
  }
  return true;
};

test('a tip\'s hull holds every texel a stamp can sample paint from, within the square, and folds nowhere', () => {
  const levels = discTip(64);
  for (const coarsest of [0, 2, 4]) {
    const hull = stampTipHull(levels, coarsest);
    for (const level of levels.slice(0, coarsest + 1)) {
      level.texels.forEach((texel, i) => {
        if (texel === 255) return;
        const tx = i % level.width, ty = Math.floor(i / level.width);
        // A bilinear sample reaches paint from a texel's neighbours: the texel grown by one, where it's in the tip.
        for (const x of [tx - 1, tx + 2]) for (const v of [ty - 1, ty + 2]) {
          const u = Math.min(1, Math.max(0, x / level.width)), w = Math.min(1, Math.max(0, v / level.height));
          assert.ok(inside(hull, u, w), `level ${level.width}: ${u},${w} is outside the hull for coarsest ${coarsest}`);
        }
      });
    }
    for (const corner of hull) assert.ok(corner >= 0 && corner <= 1);
    // Strictly convex, counter-clockwise: a fan over it covers each pixel once.
    for (let i = 0; i < hull.length; i += 2) {
      const n = hull.length;
      const [ax, ay, bx, by, cx, cy] = [hull[i], hull[i + 1], hull[(i + 2) % n], hull[(i + 3) % n], hull[(i + 4) % n], hull[(i + 5) % n]];
      assert.ok((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0);
    }
  }
  // Paint at the finest level only fills part of the square; the coarsest level's one texel fills all of it.
  assert.ok(!inside(stampTipHull(levels, 0), 0.02, 0.02));
  assert.ok(inside(stampTipHull(levels, levels.length - 1), 0.02, 0.02));
});

test('a bare tip is drawn as its whole square', () => {
  assert.deepEqual([...stampTipHull(stampTipLevels({ width: 4, height: 4, pixels: new Uint8Array(16).fill(255) }), 0)], [0, 0, 1, 0, 1, 1, 0, 1]);
});
