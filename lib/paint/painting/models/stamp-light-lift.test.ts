import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_BANDS, paintBandsToLinearRgb } from '#lib/paint/materials/models/paint-spectrum.ts';
import { stampLightLiftBasis } from './stamp-light-lift.ts';

test('linear light lifted into the bands shows as itself, white as a flat reflectance of 1, near 0..1 throughout', () => {
  const basis = stampLightLiftBasis(PAINT_BANDS);
  const lift = (rgb: readonly number[]) => Float64Array.from({ length: PAINT_BANDS.count }, (_, k) => basis.reduce((sum, spectrum, c) => sum + rgb[c] * spectrum[k], 0));
  for (const rgb of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.8, 0.35, 0.05], [0.02, 0.3, 0.6], [0.5, 0.5, 0.5]]) {
    paintBandsToLinearRgb(PAINT_BANDS, lift(rgb)).forEach((v, c) => assert.ok(Math.abs(v - rgb[c]) < 1e-9, `${rgb.join(', ')} shows as ${v} in channel ${c}`));
  }
  for (const v of lift([1, 1, 1])) assert.ok(Math.abs(v - 1) < 1e-9);
  const all = basis.flatMap((spectrum) => Array.from(spectrum));
  assert.ok(Math.min(...all) > -0.15 && Math.max(...all) < 1.15, `the basis strays to ${Math.min(...all)}..${Math.max(...all)}`);
});
