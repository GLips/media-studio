import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, bindStampBrushImages, type StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { placeStrokeStamps, type PlacedStamp } from '#lib/picture/stamp-paint/models/stamp-placement.ts';
import { normalizePhotoshopBrush } from '#lib/picture/photoshop-brushes/models/photoshop-brush.ts';
import { photoshopPaintablePreset, readPhotoshopPreset } from '#lib/picture/photoshop-brushes/models/photoshop-preset.ts';
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
    x: 2, y: 2, diameter: 4, rotation: 0, roundness: 1, alpha: 0.5, opacity, flipX: false, flipY: false, blur: 0, grainTurn: 0, grainDepth: 1, pressure: 1, tint: { hue: 0, saturation: 0, lightness: 0, secondary: 0 }, reveal: 0,
  });
  const at = (stamps: PlacedStamp[]) => renderStampReferenceDeposit({
    brush: bindStampBrushImages(brush, 4, () => tip), stamps, dualStamps: [], diameter: 4, opacity: 1, grainOffset: { main: [0, 0], dual: [0, 0] }, box: { x: 0, y: 0, width: 4, height: 4 },
  }).coverage[1 * 4 + 1];
  // Two stamps at flow 0.5 build to 0.75 of full; at opacity 0.6, to 0.75 of 0.6.
  assert.ok(Math.abs(at([stamp(1), stamp(1)]) - 0.75) < 1e-6);
  assert.ok(Math.abs(at([stamp(0.6), stamp(0.6)]) - 0.45) < 1e-6);
  // A fainter stamp over a stronger one leaves it; laid first, the stronger one still builds over it.
  assert.ok(Math.abs(at([stamp(1), stamp(0.2)]) - 0.5) < 1e-6);
  assert.ok(Math.abs(at([stamp(0.2), stamp(1)]) - 0.55) < 1e-6);
});

test("a tip image that isn't square keeps its proportions: a stamp's diameter spans the image's width", () => {
  const tip = stampReferenceMips({ width: 20, height: 5, paint: new Float32Array(100).fill(1) });
  const stamp: PlacedStamp = {
    x: 20, y: 20, diameter: 40, rotation: 0, roundness: 1, alpha: 1, opacity: 1, flipX: false, flipY: false, blur: 0, grainTurn: 0, grainDepth: 1, pressure: 1, tint: { hue: 0, saturation: 0, lightness: 0, secondary: 0 }, reveal: 0,
  };
  const { coverage } = renderStampReferenceDeposit({
    brush: bindStampBrushImages(brush, 40, () => tip), stamps: [stamp], dualStamps: [], diameter: 40, opacity: 1, grainOffset: { main: [0, 0], dual: [0, 0] }, box: { x: 0, y: 0, width: 40, height: 40 },
  });
  const painted = (along: (i: number) => number) => Array.from({ length: 40 }, (_, i) => coverage[along(i)]).filter((c) => c > 0.5).length;
  assert.equal(painted((x) => 20 * 40 + x), 40);
  assert.equal(painted((y) => y * 40 + 20), 10);
});

const pct = (value: number) => ({ _unit: '#Prc', value });
const total = (coverage: Float32Array) => coverage.reduce((sum, c) => sum + c, 0);

test("a flat bristle tip lies across the stroke's first heading, and paints more of its footprint the harder it's pressed", () => {
  const preset = photoshopPaintablePreset(readPhotoshopPreset({
    _class: 'brushPreset',
    Brsh: {
      _class: 'dBrush', Dmtr: { _unit: '#Pxl', value: 40 }, Angl: { _unit: '#Ang', value: 0 }, Spcn: pct(2), Intr: true,
      'Shp ': { _long: 6 }, Dnst: pct(0.4), Lngt: pct(1), clumping: pct(0.25), thickness: pct(0.3), stiffness: pct(0.6), physics: true,
    },
  }));
  assert.ok(preset?.tip.kind === 'bristle');
  const { brush: flat } = normalizePhotoshopBrush('Flat', { preset, tip: { kind: 'bristle' } });
  const bound = bindStampBrushImages(flat, 40, (image) => {
    if (!('draw' in image)) throw new Error(`a bristle brush names no asset, but ${image.file}`);
    const { size, pixels } = image.draw();
    return stampReferenceMips({ width: size, height: size, paint: Float32Array.from(pixels, (v) => 1 - v / 255) });
  });
  // A stroke straight down, then turning right: the flat face stays across the first heading, spanning x throughout.
  const box = { x: -60, y: -20, width: 240, height: 240 };
  const paint = (pressure: number, stamps = Infinity) => renderStampReferenceDeposit({
    brush: bound, stamps: placeStrokeStamps([{ x: 0, y: 0, pressure }, { x: 0, y: 100, pressure }, { x: 150, y: 100, pressure }], flat, 40, 'bristle').slice(0, stamps), dualStamps: [],
    diameter: 40, opacity: 1, grainOffset: { main: [0, 0], dual: [0, 0] }, box,
  }).coverage;
  const full = paint(1);
  const painted = (coverage: Float32Array, y: number) => Array.from({ length: box.width }, (_, x) => coverage[(y - box.y) * box.width + x]).filter((c) => c > 0.05).length;
  // Down the first leg, a row crosses the whole face, about 1.04 × 40 px; along the second, a column crosses only its
  // depth, 5 px and a bristle's width each side, where a face turning with the stroke would paint 40 rows.
  assert.ok(Math.abs(painted(full, 50) - 42) <= 5, `across ${painted(full, 50)}`);
  const column = (coverage: Float32Array, x: number) => Array.from({ length: box.height }, (_, y) => coverage[y * box.width + (x - box.x)]).filter((c) => c > 0.05).length;
  assert.ok(column(full, 120) < 20, `the held face paints ${column(full, 120)} rows along the second leg`);
  // One stamp, as a dense tip's stroke covers its footprint at any pressure (as Photoshop's does).
  const pressed = total(paint(1, 1)), light = total(paint(0.3, 1));
  assert.ok(light < 0.7 * pressed, `pressed ${pressed.toFixed(0)}, light ${light.toFixed(0)}`);
});
