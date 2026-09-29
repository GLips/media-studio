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

test('a hollow stroke reads as unfilled and a soft-edged one as wider-edged, each costing it score', () => {
  const solid = measureStrokeCoverage(band(20, 179, 40, 200), W, H)!;
  const hollow = measureStrokeCoverage(band(20, 179, 40, 20, 6, 220), W, H)!;
  assert.ok(solid.fill > 0.95 && hollow.fill < 0.5, `fill ${solid.fill} → ${hollow.fill}`);
  const soft = band(20, 179, 40, 200);
  for (let y = 0; y < H; y++) for (let x = 20; x <= 179; x++) {
    const depth = Math.min(y - 10, 49 - y);
    if (depth >= 0 && depth < 8) soft[y * W + x] = Math.round(200 * (depth + 1) / 9);
  }
  const softened = measureStrokeCoverage(soft, W, H)!;
  assert.ok(softened.edgeWidth >= 4 && solid.edgeWidth <= 2, `edge ${solid.edgeWidth} → ${softened.edgeWidth}`);
  assert.equal(compareStrokeProfiles(solid, solid).score, 0);
  assert.ok(compareStrokeProfiles(solid, hollow).score > compareStrokeProfiles(solid, softened).score);
});
