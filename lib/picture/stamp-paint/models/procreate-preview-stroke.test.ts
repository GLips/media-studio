import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareStrokeProfiles, measureStrokeCoverage } from './procreate-preview-stroke.ts';

const W = 200, H = 60;

/** A horizontal band from x0 to x1, `thickness` tall about the middle, at `value`, with a rim `rim` pixels deep at `rimValue`. */
function band(x0: number, x1: number, thickness: number, value: number, rim = 0, rimValue = value): Uint8Array {
  const coverage = new Uint8Array(W * H), top = Math.round((H - thickness) / 2);
  for (let y = top; y < top + thickness; y++) {
    const depth = Math.min(y - top, top + thickness - 1 - y);
    for (let x = x0; x <= x1; x++) coverage[y * W + x] = depth < rim ? rimValue : value;
  }
  return coverage;
}

test('a stroke that falls short and thin of its preview reads as shorter, thinner and off by its missing part', () => {
  const preview = measureStrokeCoverage(band(20, 179, 40, 200), W, H)!;
  const ours = measureStrokeCoverage(band(20, 99, 20, 200), W, H)!;
  const c = compareStrokeProfiles(preview, ours);
  assert.equal(c.length, 0.5);
  assert.equal(c.peak, 0.5);
  // Half the span missing (a full gap) and half at half thickness: 0.5 + 0.25.
  assert.ok(Math.abs(c.profileError - 0.75) < 0.03, `profileError ${c.profileError}`);
  assert.equal(c.density, 0);
});

test("a wet rim reads as a darker edge than the stroke's body", () => {
  const rimmed = measureStrokeCoverage(band(20, 179, 50, 120, 3, 240), W, H)!;
  const flat = measureStrokeCoverage(band(20, 179, 50, 120), W, H)!;
  const c = compareStrokeProfiles(flat, rimmed);
  assert.ok(c.rim.ours > 0.3, `rim ${c.rim.ours}`);
  assert.ok(Math.abs(c.rim.preview) < 1e-9);
});
