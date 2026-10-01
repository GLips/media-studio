import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampBloomSizing } from './stamp-wet-bloom.ts';
import type { StampWetLanding } from './stamp-wetness.ts';
import type { StampGrid } from './stamp-region.ts';

const SIZE = 12;
const grid = (at: (i: number, j: number) => number): StampGrid => {
  const values = new Float32Array(SIZE * SIZE);
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) values[j * SIZE + i] = at(i, j);
  return { x0: 0, y0: 0, cell: 8, columns: SIZE, rows: SIZE, values };
};
const DAMP = 0.35;
/** A brush laying `brushWater` where `lays`, on paper as wet as `paper` says, workable as wet over damp. */
function landing(paper: (i: number, j: number) => number, lays: (i: number, j: number) => boolean, brushWater = 0.7): StampWetLanding {
  const workable = (i: number, j: number) => Math.min(1, paper(i, j) / DAMP);
  const after = (i: number, j: number) => (lays(i, j) ? Math.max(brushWater, paper(i, j)) : paper(i, j));
  return {
    tau: 0, water: brushWater,
    before: { wetness: grid(paper), workable: grid(workable), dried: grid(() => 0) },
    after: { wetness: grid(after), workable: grid((i, j) => Math.min(1, after(i, j) / DAMP)), dried: grid(() => 0) },
  };
}
const drop = (i: number, j: number) => Math.abs(i - 6) <= 1 && Math.abs(j - 6) <= 1;

test('a drop blooms on damp paper, and merges on flooded or dry paper', () => {
  const damp = stampBloomSizing(landing(() => 0.3, drop), 0.5, 36);
  assert.ok(damp && damp.drive > 0.9 && damp.sigma > 10);
  assert.equal(stampBloomSizing(landing(() => 0.7, drop), 0.5, 36), null);
  assert.equal(stampBloomSizing(landing(() => 0, drop), 0.5, 36), null);
});

// A lattice point half under a wet stroke averages to damp; a stroke laid on along its edge isn't a bloom.
test('a stroke laid on beside a wet one, its edge half covering a cell, does not bloom', () => {
  const stroke = (i: number) => (i <= 4 ? 0.7 : i === 5 ? DAMP : 0);
  assert.equal(stampBloomSizing(landing((i) => stroke(i), (i) => i >= 5 && i <= 7), 0.5, 36), null);
});

test('crayon (flow 0) never blooms', () => {
  assert.equal(stampBloomSizing(landing(() => 0.3, drop), 0, 36), null);
});
