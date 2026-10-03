import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gpuHalfBits, gpuHalfValue } from './gpu-half-float.ts';

test('a number becomes the nearest half float, subnormals, infinities and NaN included', () => {
  for (const v of [0, 1, -2.5, 65504, 6.103515625e-5, 2 ** -24, 3 * 2 ** -24, -5e-6, 1 / 3]) {
    const back = gpuHalfValue(gpuHalfBits(v));
    assert.ok(Math.abs(back - v) <= Math.max(2 ** -25, Math.abs(v) * 2 ** -11), `${v} came back ${back}`);
  }
  // A faint premultiplied edge: sRGB level 1 at alpha 0.1 stays visible.
  assert.ok(gpuHalfValue(gpuHalfBits(3e-5)) > 0);
  assert.equal(gpuHalfBits(2 ** -26), 0);
  assert.equal(gpuHalfValue(gpuHalfBits(1e6)), Infinity);
  assert.equal(gpuHalfValue(gpuHalfBits(-1e6)), -Infinity);
  assert.ok(Number.isNaN(gpuHalfValue(gpuHalfBits(NaN))));
  // Rounding a mantissa up carries into the exponent: just under 2 rounds to 2.
  assert.equal(gpuHalfValue(gpuHalfBits(1.9999)), 2);
});
