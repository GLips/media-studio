import assert from 'node:assert/strict';
import { test } from 'node:test';
import { librarySoundSpans } from './library-quiet.ts';

const run = (db: number, n: number): number[] => Array.from({ length: n }, () => db);
// 10 ms windows: speech, a decay into the floor, quiet broken by a click, a 20 ms dip between syllables, speech, quiet,
// a breath, quiet, speech, and quiet.
const shaped = (floor: number) => [
  ...run(-14, 30), -20, -26, ...run(floor, 10), -20, ...run(floor, 9), ...run(-14, 15), floor, floor, ...run(-14, 15), ...run(floor, 25),
  ...run(-32, 20), ...run(floor, 10), ...run(-14, 15), ...run(floor, 10),
];

test("quiet is read against a track's own floor and speech, so a noisy room and a denoised one cut alike", () => {
  for (const floor of [-36, -60]) {
    const { quiet, clicks } = librarySoundSpans(shaped(floor));
    // The decay ends 0.32 s in; the click stays quiet; the second word decays at 0.84 s, into the breath or the quiet.
    assert.deepEqual([quiet[0], quiet[1][0], clicks], [[0.32, 0.52], 0.84, [[0.42, 0.43]]]);
  }
});

test('a breath is a soft sound of its own between quiet, where a denoised floor sets it apart; in a noisy room it is quiet', () => {
  assert.deepEqual(librarySoundSpans(shaped(-60)).soft, [[1.09, 1.29]]);
  assert.deepEqual(librarySoundSpans(shaped(-36)), { quiet: [[0.32, 0.52], [0.84, 1.39], [1.54, 1.64]], soft: [], clicks: [[0.42, 0.43]] });
});
