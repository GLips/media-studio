import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lensExposures } from './lens-exposures.ts';

test("a frame's aperture samples have mean 0 and unit covariance, so the reference blurs by the fast path's gaussian", () => {
  for (const count of [3, 16, 24]) {
    const points = lensExposures(count).map(({ aperture }) => aperture);
    const mean = (f: (p: readonly [number, number]) => number) => points.reduce((sum, p) => sum + f(p), 0) / count;
    const moments = [mean(([x]) => x), mean(([, y]) => y), mean(([x]) => x * x), mean(([x, y]) => x * y), mean(([, y]) => y * y)];
    [0, 0, 1, 0, 1].forEach((want, i) => assert.ok(Math.abs(moments[i] - want) < 1e-9, `${count} exposures: moment ${i} is ${moments[i]}`));
  }
});
