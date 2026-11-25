import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryQuietSpans } from './library-quiet.ts';

const run = (db: number, n: number): number[] => Array.from({ length: n }, () => db);
// 10 ms windows: speech, a decay into the floor, quiet broken by a click, a 20 ms dip between syllables, speech, quiet.
const shaped = (floor: number) => [...run(-14, 30), -20, -26, ...run(floor, 10), -20, ...run(floor, 9), ...run(-14, 15), floor, floor, ...run(-14, 15), ...run(floor, 25)];

test("quiet is read against a track's own floor and speech, so a noisy room and a denoised one cut alike", () => {
  for (const floor of [-36, -60]) assert.deepEqual(libraryQuietSpans(shaped(floor)), [[0.32, 0.52], [0.84, 1.09]]);
});
