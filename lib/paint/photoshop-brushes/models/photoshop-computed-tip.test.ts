import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoshopComputedTipAlpha, photoshopComputedTipSpan } from './photoshop-computed-tip.ts';

test("a soft computed tip reaches past its diameter and a hard one stops at it, and the image spans the whole tip", () => {
  // Hardness 0 is 10^(−(r/R)²): a tenth at the rim, which a tip image spanning only the diameter would cut off.
  assert.ok(Math.abs(photoshopComputedTipAlpha(64, 128, 0) - 0.1) < 0.005);
  assert.ok(photoshopComputedTipSpan(128, 0) > 1.5);
  // A hard edge is a pixel-wide erf, centred a little inside the rim.
  assert.ok(photoshopComputedTipAlpha(62, 128, 1) > 0.95 && photoshopComputedTipAlpha(66, 128, 1) < 0.01);
  assert.ok(photoshopComputedTipSpan(128, 1) < 1.1);
  for (const hardness of [0, 0.5, 1]) {
    const span = photoshopComputedTipSpan(128, hardness);
    assert.equal(photoshopComputedTipAlpha((span * 128) / 2, 128, hardness), 0);
  }
});
