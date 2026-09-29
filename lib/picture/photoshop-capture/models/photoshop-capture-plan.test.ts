import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PHOTOSHOP_REFERENCE_MAX_DIAMETER, PHOTOSHOP_REFERENCE_MARKS, PHOTOSHOP_SHEET_SIZE, planPhotoshopProbeCapture, planPhotoshopReferenceCapture, photoshopReferenceSize,
  type PhotoshopBox, type PhotoshopCaptureSheet,
} from './photoshop-capture-plan.ts';
import { PHOTOSHOP_PROBE_RAMP, PHOTOSHOP_REPEAT_SAMPLE, photoshopProbes } from './photoshop-probes.ts';

const overlaps = (a: PhotoshopBox, b: PhotoshopBox) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Every cell on its sheet, apart from every other, at a ramp-period origin, with its strokes inside it. */
function assertLaidOut(sheets: PhotoshopCaptureSheet[]) {
  for (const sheet of sheets) {
    sheet.cells.forEach((cell, i) => {
      const { box } = cell;
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= sheet.width && box.y + box.height <= sheet.height, `${cell.item} is off ${sheet.name}`);
      // A texture fixed to the canvas then has the same phase in every cell, so a cell and its repeat compare.
      assert.equal(box.x % PHOTOSHOP_PROBE_RAMP.width, 0);
      assert.equal(box.y % PHOTOSHOP_PROBE_RAMP.width, 0);
      for (const other of sheet.cells.slice(i + 1)) assert.ok(!overlaps(box, other.box), `${cell.item} overlaps ${other.item} on ${sheet.name}`);
      for (const [x, y] of cell.strokes.flat()) assert.ok(x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height, `${cell.item}'s ${cell.mark} leaves its cell`);
    });
  }
}

test('the probe run paints every probe and each copy once, and its repeats twice at the same places', () => {
  const probes = photoshopProbes();
  const sheets = planPhotoshopProbeCapture(probes, { repeat: PHOTOSHOP_REPEAT_SAMPLE });
  assertLaidOut(sheets);
  const captured = sheets.filter((s) => s.group === 'capture').flatMap((s) => s.cells);
  assert.equal(captured.length, probes.reduce((n, p) => n + p.marks.length * (p.copies ?? 1), 0));
  assert.deepEqual(new Set(captured.map((c) => c.item)), new Set(probes.map((p) => p.name)));
  const a = sheets.filter((s) => s.group === 'repeat-a').flatMap((s) => s.cells), b = sheets.filter((s) => s.group === 'repeat-b').flatMap((s) => s.cells);
  assert.deepEqual(new Set(a.map((c) => c.item)), new Set(PHOTOSHOP_REPEAT_SAMPLE));
  assert.deepEqual(b, a);
  assert.throws(() => planPhotoshopProbeCapture(probes, { only: ['no such probe'] }), /no probe named/);
});

test('a pack brush is painted at its own size, a size-less one at the default, and a huge one capped to fit a sheet', () => {
  assert.deepEqual(photoshopReferenceSize(41), { diameter: 41, sizing: 'own' });
  assert.equal(photoshopReferenceSize(null).sizing, 'unsized');
  assert.deepEqual(photoshopReferenceSize(2500), { diameter: PHOTOSHOP_REFERENCE_MAX_DIAMETER, sizing: 'capped' });
  const brushes = [12, 41, null, 300, 2500].map((native, i) => ({ key: `brush ${i}`, diameter: photoshopReferenceSize(native).diameter }));
  const sheets = planPhotoshopReferenceCapture(brushes);
  assertLaidOut(sheets);
  for (const sheet of sheets) assert.equal(sheet.width, PHOTOSHOP_SHEET_SIZE);
  const cells = sheets.flatMap((s) => s.cells);
  assert.equal(cells.length, brushes.length * PHOTOSHOP_REFERENCE_MARKS.length);
  for (const cell of cells) assert.ok(cell.box.height >= 3 * brushes.find((b) => b.key === cell.item)!.diameter, `${cell.item}'s cell is too small for it`);
});
