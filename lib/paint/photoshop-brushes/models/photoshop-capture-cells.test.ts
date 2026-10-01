import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparePhotoshopCells, cropPhotoshopCell, type PhotoshopPixels } from './photoshop-capture-cells.ts';

/** A sheet `w`×`h` whose pixel (x, y) is `px(x, y)`, as 16-bit RGBA. */
function sheet(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): PhotoshopPixels {
  const rgba = new Uint16Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(px(x, y), (y * w + x) * 4);
  return { width: w, height: h, rgba };
}

test('a cell reads back from its box, and two paintings compare on alpha and premultiplied colour', () => {
  const base = sheet(8, 6, (x, y) => [x * 1000, y * 1000, 7, x >= 4 ? 65535 : 0]);
  const cell = cropPhotoshopCell(base, { x: 4, y: 2, width: 3, height: 2 });
  assert.equal(cell.width, 3);
  assert.deepEqual([...cell.rgba.subarray(0, 4)], [4000, 2000, 7, 65535]);
  assert.throws(() => cropPhotoshopCell(base, { x: 6, y: 0, width: 4, height: 1 }), /outside/);

  // Colour where nothing is painted is Photoshop's leftover, not paint: it doesn't count.
  const leftover = sheet(8, 6, (x, y) => [x >= 4 ? x * 1000 : 123, y * 1000, 7, x >= 4 ? 65535 : 0]);
  assert.equal(comparePhotoshopCells(base, leftover).identical, true);

  const fainter = sheet(8, 6, (x, y) => [x * 1000, y * 1000, 7, x === 5 && y === 1 ? 65000 : x >= 4 ? 65535 : 0]);
  const d = comparePhotoshopCells(base, fainter);
  assert.equal(d.identical, false);
  assert.equal(d.differing, 1);
  assert.equal(d.maxAlpha, 535);
});
