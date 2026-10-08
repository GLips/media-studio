import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StampDynamics } from './stamp-brush.ts';
import { drawStampSlots, STAMP_DRAW_SLOTS, stampDrawsRecord } from './stamp-dynamics.ts';
import { stampMarksList } from './stamp-mark-rows.ts';
import { placedAuthoredMarks, placedStrokeMarks, type StampPlacementBrush } from './stamp-placement.ts';

/** A stroke's stamps, read out. */
const placeStrokeStamps = (...args: Parameters<typeof placedStrokeMarks>) => stampMarksList(placedStrokeMarks(...args));
/** An author's placements' stamps, read out. */
const placeAuthoredStamps = (...args: Parameters<typeof placedAuthoredMarks>) => stampMarksList(placedAuthoredMarks(...args));


const brushWith = (dynamics: StampDynamics): StampPlacementBrush => ({
  tip: { roundness: 1, sampling: 'isotropic' },
  spacing: 0.5,
  stepping: 'spread',
  dynamics,
  scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 },
  falloff: 0,
  flow: 1,
});

test('a curve response is read piecewise-linearly over its sensor, flat past its ends, for a scale and an angle target alike', () => {
  // Size keeps all of itself down to a quarter short of full pressure, then half by half short, and no less after.
  const size: StampDynamics = { size: { pressure: { kind: 'curve', points: [[0.25, 1], [0.5, 0.5]] } } };
  const sizes = placeAuthoredStamps([1, 0.8, 0.625, 0.5, 0].map((pressure, i) => ({ x: i * 10, y: 0, pressure })), brushWith(size), 100, 'curve').map((stamp) => stamp.diameter);
  assert.deepEqual(sizes.map((d) => Math.round(d * 1e9) / 1e9), [100, 100, 75, 50, 50]);

  // A stroke heading straight down (π/2) turns its stamps by the curve at its heading: halfway to π, so π/4.
  const turn: StampDynamics = { rotation: { direction: { kind: 'curve', points: [[0, 0], [Math.PI, Math.PI / 2]] } } };
  const stamps = placeStrokeStamps([{ x: 0, y: 0 }, { x: 0, y: 100 }], brushWith(turn), 20, 'curve');
  assert.ok(stamps.length > 1 && stamps.every((stamp) => Math.abs(stamp.rotation - Math.PI / 4) < 1e-6));
});

test("a controlled count keeps 1 + floor((count − 1) × its share), and one at the stroke's first step", () => {
  // The `count 4 fade 10` probe: Photoshop keeps 1, 3, 3, 3, 2, 2, 2, 1, 1 over its first nine steps.
  const brush = { ...brushWith({ count: { fade: { kind: 'linear', amount: 1, steps: 10 } } }), scatter: { count: 4, radius: 0, lateral: 0 } };
  const stamps = placeStrokeStamps([{ x: 0, y: 0 }, { x: 400, y: 0 }], brush, 100, 'count');
  const perStep = new Map<number, number>();
  for (const stamp of stamps) perStep.set(Math.round(stamp.x), (perStep.get(Math.round(stamp.x)) ?? 0) + 1);
  assert.deepEqual([...perStep.values()], [1, 3, 3, 3, 2, 2, 2, 1, 1]);
});

test('an `around` jitter spreads size either side of what pressure gives it, folded under full, and count up to twice', () => {
  // Size on pressure at 0.5 with 100% jitter: Photoshop's stamps reach from none to the full diameter, never past it.
  const sized = brushWith({ size: { pressure: { kind: 'linear', amount: 1 }, random: { kind: 'linear', amount: 1, around: true } } });
  const sizes = placeAuthoredStamps(Array.from({ length: 400 }, (_, i) => ({ x: i, y: 0, pressure: 0.5 })), sized, 100, 'around').map((s) => s.diameter);
  assert.ok(Math.max(...sizes) <= 100 && Math.max(...sizes) > 90 && Math.min(...sizes) < 10, `${Math.min(...sizes)}..${Math.max(...sizes)}`);
  // Count 4 at 100% jitter: from none to 8 a step, 4 on average.
  const counted = { ...brushWith({ count: { random: { kind: 'linear', amount: 1, around: true } } }), scatter: { count: 4, radius: 0, lateral: 0 } };
  const perStep = new Map<number, number>();
  for (const stamp of placeStrokeStamps([{ x: 0, y: 0 }, { x: 20000, y: 0 }], counted, 100, 'around')) perStep.set(Math.round(stamp.x), (perStep.get(Math.round(stamp.x)) ?? 0) + 1);
  const counts = [...perStep.values()], mean = counts.reduce((a, b) => a + b, 0) / 401;
  assert.ok(Math.max(...counts) === 8 && perStep.size < 401 && Math.abs(mean - 4) < 0.4, `max ${Math.max(...counts)}, ${perStep.size} steps laid, mean ${mean}`);
});

test("a stamp's draws are its stream's, one a slot in STAMP_DRAW_SLOTS' order, an authored stamp drawing none for the stroke's own", () => {
  // Every painting's randomness hangs on this order: a slot drawn out of turn reseeds every stamp after it.
  let n = 0;
  const counting = () => ++n;
  assert.deepEqual(Object.entries(drawStampSlots(counting, 'stroke', stampDrawsRecord())), STAMP_DRAW_SLOTS.map((slot, i) => [slot, i + 1]));
  n = 0;
  const strokeOnly = new Set(['lateral', 'scatterTurn', 'scatterReach']);
  let drawn = 0;
  assert.deepEqual(Object.entries(drawStampSlots(counting, 'authored', stampDrawsRecord())), STAMP_DRAW_SLOTS.map((slot) => [slot, strokeOnly.has(slot) ? 0 : ++drawn]));
});
