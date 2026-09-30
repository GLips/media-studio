import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePhotoshopBrush } from '#lib/picture/photoshop-brushes/models/photoshop-brush.ts';
import { drawPhotoshopBristleTip } from '#lib/picture/photoshop-brushes/models/photoshop-bristle.ts';
import { photoshopPaintablePreset, readPhotoshopPreset } from '#lib/picture/photoshop-brushes/models/photoshop-preset.ts';
import { bindStampBrushImages } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { placeStrokeStamps } from '#lib/picture/stamp-paint/models/stamp-placement.ts';
import { renderStampReferenceDeposit } from './stamp-reference-deposit.ts';
import { stampReferenceMips } from './stamp-reference-image.ts';

const asset = (file: string) => ({ style: 's', pack: 'p', file });
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
  const drawn = drawPhotoshopBristleTip(preset.tip, 512);
  const mips = (pixels: Uint8Array) => stampReferenceMips({ width: drawn.size, height: drawn.size, paint: Float32Array.from(pixels, (v) => 1 - v / 255) });
  const images: Record<string, ReturnType<typeof mips>> = { 'tip.png': mips(drawn.image), 'contact.png': mips(drawn.contact) };
  const { brush } = normalizePhotoshopBrush('Flat', { preset, tip: { kind: 'bristle', image: asset('tip.png'), contact: asset('contact.png') } });
  const bound = bindStampBrushImages(brush, (image) => images[image.file]);
  // A stroke straight down, then turning right: the flat face stays across the first heading, spanning x throughout.
  const box = { x: -60, y: -20, width: 240, height: 240 };
  const paint = (pressure: number, stamps = Infinity) => renderStampReferenceDeposit({
    brush: bound, stamps: placeStrokeStamps([{ x: 0, y: 0, pressure }, { x: 0, y: 100, pressure }, { x: 150, y: 100, pressure }], brush, 40, 'bristle').slice(0, stamps), dualStamps: [],
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
