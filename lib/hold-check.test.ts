import assert from 'node:assert/strict';
import { test } from 'node:test';
import { holdProblems } from './hold-check.ts';
import type { MotionSegment, MotionTracks } from './motion-tracks.ts';

// 10 fps, frames 0–29: `price` glides in over frames 0–9, holds, then its x drifts 5px at frame 25.
const fps = 10;
const xs = Array.from({ length: 30 }, (_, f) => (f < 10 ? 100 + 50 * f : f < 25 ? 600 : 605));
const segment = (start: number, end: number, phase: MotionSegment['phase'], opacity: (f: number) => number): MotionSegment => {
  const n = end - start + 1, at = (f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(start + i));
  return {
    start, end, phase, parent: null, attribution: 'scene',
    screen: { x: at((f) => xs[f]), y: at(() => 300), w: at(() => 200), h: at(() => 80), opacity: at(opacity) },
    local: null, values: {},
  };
};
const motion = (segments: MotionSegment[]): MotionTracks => ({
  version: 2, fps, frames: { first: 0, last: 29 },
  tracks: [{ id: 'buy/price', scene: 'buy', name: 'price', segments }],
  coverage: { scenes: [{ id: 'buy', tracks: 1, unmeasured: [] }], ambiguous: [] }, errors: [],
});
const hold = (h: { for: number; start: number; end: number; hold?: string }) => ({ scene: 'buy', hold: 'price', ...h });
const noCrossfades = { crossfades: [] };

test('a hold passes on a long enough steady stretch, and a failure names what moved, when, by how much', () => {
  const m = motion([segment(0, 29, 'solo', () => 1)]);
  assert.deepEqual(holdProblems(m, noCrossfades, [hold({ for: 1.5, start: 0, end: 3 })], 'demo').problems, []);
  const [p] = holdProblems(m, noCrossfades, [hold({ for: 2, start: 0, end: 3 })], 'demo').problems;
  assert.match(p.problem, /for 1\.50s at most, 1\.00–2\.50s\. Into it, its x moves 50px .*; at 2\.50s its x moves 5px \(holds within 2px\)\./);
  assert.match(p.problem, /Review: studio look demo --graph=0\.00:3\.00 --tracks=buy\/price$/);
  // A looser tolerance declared on the hold lets the drift pass.
  assert.deepEqual(holdProblems(m, noCrossfades, [{ ...hold({ for: 2, start: 1, end: 3 }), within: 6 }], 'demo').problems, []);
});

test('fading, and the next scene dissolving over it, count as not visible; an untagged subject is named', () => {
  // Fades out over frames 20–29 inside its own scene: steady only while opaque.
  const fading = motion([segment(0, 29, 'solo', (f) => (f < 20 ? 1 : 1 - (f - 19) / 10))]);
  assert.match(holdProblems(fading, noCrossfades, [hold({ for: 1.5, start: 1, end: 3 })], 'demo').problems[0].problem, /at 2\.00s it is 90% opaque/);
  // At full opacity itself, but the next scene covers it from 1.5s on.
  const covered = motion([segment(0, 14, 'solo', () => 1), segment(15, 29, 'out', () => 1)]);
  const crossfades = [{ from: 'buy', to: 'next', start: 1.5, end: 2.5 }];
  assert.match(holdProblems(covered, { crossfades }, [hold({ for: 1, start: 1, end: 3 })], 'demo').problems[0].problem, /it is under the next scene's crossfade/);
  assert.match(holdProblems(covered, noCrossfades, [hold({ for: 1, start: 1, end: 3, hold: 'total' })], 'demo').problems[0].problem, /it isn't tracked: .*\(tracked in buy: price\)/);
});
