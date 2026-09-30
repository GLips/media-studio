import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, bindStampBrushImages, type StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { placeStrokeStamps, type PlacedStamp } from '#lib/picture/stamp-paint/models/stamp-placement.ts';
import { renderStampReferenceDeposit } from './stamp-reference-deposit.ts';
import { stampReferenceMips } from './stamp-reference-image.ts';

const brush: StampBrush = {
  name: 'Round', blend: 'normal', accumulation: { kind: 'buildToOpacity' },
  tip: { image: { style: 's', pack: 'p', file: 'tip.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.25,
  stepping: 'eachStamp',
  dynamics: stampLinearDynamics({ size: { pressure: 1 } }),
  scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 },
  falloff: 0, flow: 1,
};

test('Photoshop steps each stamp by its own size from the first point, and paints nothing on the last', () => {
  const even = placeStrokeStamps([{ x: 0, y: 0 }, { x: 100, y: 0 }], brush, 40, 's');
  assert.deepEqual(even.map((s) => s.x), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
  // Pressure halving the size along the stroke closes the stamps up as they shrink.
  const thinning = placeStrokeStamps([{ x: 0, y: 0, pressure: 1 }, { x: 100, y: 0, pressure: 0.5 }], brush, 40, 's');
  const steps = thinning.slice(1).map((s, i) => s.x - thinning[i].x);
  assert.ok(thinning.length > even.length && steps.every((step, i) => i === 0 || step < steps[i - 1]), `steps ${steps.map((s) => s.toFixed(2))}`);
});

test('a buildToOpacity stroke lays each stamp toward its own opacity and never lowers what a stronger one left', () => {
  const tip = stampReferenceMips({ width: 2, height: 2, paint: new Float32Array([1, 1, 1, 1]) });
  const stamp = (opacity: number): PlacedStamp => ({
    x: 2, y: 2, diameter: 4, rotation: 0, roundness: 1, alpha: 0.5, opacity, flipX: false, flipY: false, blur: 0, grainTurn: 0, tint: { hue: 0, saturation: 0, lightness: 0, secondary: 0 }, reveal: 0,
  });
  const at = (stamps: PlacedStamp[]) => renderStampReferenceDeposit({
    brush: bindStampBrushImages(brush, () => tip), stamps, dualStamps: [], diameter: 4, opacity: 1, grainOffset: { main: [0, 0], dual: [0, 0] }, box: { x: 0, y: 0, width: 4, height: 4 },
  }).coverage[1 * 4 + 1];
  // Two stamps at flow 0.5 build to 0.75 of full; at opacity 0.6, to 0.75 of 0.6.
  assert.ok(Math.abs(at([stamp(1), stamp(1)]) - 0.75) < 1e-6);
  assert.ok(Math.abs(at([stamp(0.6), stamp(0.6)]) - 0.45) < 1e-6);
  // A fainter stamp over a stronger one leaves it; laid first, the stronger one still builds over it.
  assert.ok(Math.abs(at([stamp(1), stamp(0.2)]) - 0.5) < 1e-6);
  assert.ok(Math.abs(at([stamp(0.2), stamp(1)]) - 0.55) < 1e-6);
});
