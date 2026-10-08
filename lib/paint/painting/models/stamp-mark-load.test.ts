import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampFrozenMarks, type PlacedStamp } from '#lib/paint/brush/models/stamp-placement.ts';
import { createStampBinBuffer, stampMarksOrderedBins } from './stamp-mark-load.ts';
import { stampRoundTipFootprint } from './stamp-tip-support.ts';

const stampAt = (x: number, y: number): PlacedStamp => ({
  x, y, diameter: 20, rotation: 0, roundness: 1, alpha: 1, opacity: 1, flipX: false, flipY: false, blur: 0, grainTurn: 0,
  grainDepth: 1, grainDepthByPressure: 1, pressure: 1, tint: { hue: 0, saturation: 0, lightness: 0, secondary: 0 },
});

/** Each tile's stamps as the shader reads them from `buffer`'s table at `at`. */
const tilesRead = (buffer: readonly number[], at: number, tiles: number) =>
  Array.from({ length: tiles }, (_, t) => buffer.slice(buffer[at + t], buffer[at + t + 1]));

test('an ordered layer\'s bins read the same wherever in the bin buffer they land', () => {
  const tilesX = 4, tilesY = 3, tiles = tilesX * tilesY, tip = stampRoundTipFootprint();
  const first = stampFrozenMarks([stampAt(10, 10), stampAt(70, 40)]);
  const second = stampFrozenMarks([stampAt(100, 80), stampAt(40, 40), stampAt(50, 45)]);
  const alone = createStampBinBuffer(), shared = createStampBinBuffer();
  alone.append(stampMarksOrderedBins(second, tip, tilesX, tilesY, 0));
  shared.append(stampMarksOrderedBins(first, tip, tilesX, tilesY, 0));
  const at = shared.append(stampMarksOrderedBins(second, tip, tilesX, tilesY, 0));
  assert.ok(at > 0);
  assert.deepEqual(tilesRead([...shared.data()], at, tiles), tilesRead([...alone.data()], 0, tiles));
  assert.ok(tilesRead([...alone.data()], 0, tiles).some((tile) => tile.length > 1));
});

test('an ordered layer bins a stamp in every tile its tip reaches, an off-centre tip past its diameter', () => {
  // The tip's image hangs from its corner on the stamp's place: at (16, 10) its paint runs to x 36, past the first tile.
  const tip = { ...stampRoundTipFootprint(), center: [0, 0] as const };
  const bins = stampMarksOrderedBins(stampFrozenMarks([stampAt(16, 10)]), tip, 2, 1, 0);
  assert.deepEqual(tilesRead([...bins], 0, 2), [[0], [0]]);
});
