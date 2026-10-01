import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampFrozenMarks, type PlacedStamp } from '#lib/paint/brush/models/stamp-placement.ts';
import { stampBinsAppended, stampMarksOrderedBins } from './stamp-mark-load.ts';

const stampAt = (x: number, y: number): PlacedStamp => ({
  x, y, diameter: 20, rotation: 0, roundness: 1, alpha: 1, opacity: 1, flipX: false, flipY: false, blur: 0, grainTurn: 0,
  grainDepth: 1, grainDepthByPressure: 1, pressure: 1, reveal: 0, tint: { hue: 0, saturation: 0, lightness: 0, secondary: 0 },
});

/** Each tile's stamps as the shader reads them from `buffer`'s table at `at`. */
const tilesRead = (buffer: readonly number[], at: number, tiles: number) =>
  Array.from({ length: tiles }, (_, t) => buffer.slice(buffer[at + t], buffer[at + t + 1]));

test('an ordered layer\'s bins read the same wherever in the bin buffer they land', () => {
  const tilesX = 4, tilesY = 3, tiles = tilesX * tilesY;
  const first = stampFrozenMarks([stampAt(10, 10), stampAt(70, 40)]);
  const second = stampFrozenMarks([stampAt(100, 80), stampAt(40, 40), stampAt(50, 45)]);
  const alone: number[] = [], shared: number[] = [];
  stampBinsAppended(stampMarksOrderedBins(second, 1, tilesX, tilesY), alone);
  stampBinsAppended(stampMarksOrderedBins(first, 1, tilesX, tilesY), shared);
  const at = stampBinsAppended(stampMarksOrderedBins(second, 1, tilesX, tilesY), shared);
  assert.ok(at > 0);
  assert.deepEqual(tilesRead(shared, at, tiles), tilesRead(alone, 0, tiles));
  assert.ok(tilesRead(alone, 0, tiles).some((tile) => tile.length > 1));
});
