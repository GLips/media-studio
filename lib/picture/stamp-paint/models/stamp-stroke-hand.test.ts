import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StampBrush } from './stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe } from './stamp-paint-recipe.ts';
import { handStampStroke } from './stamp-stroke-hand.ts';

const D = 20;
const line = (length: number) => [{ x: 0, y: 0 }, { x: length, y: 0 }];
/** Right along the top, then a sharp turn down: a corner at (400, 0). */
const corner = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }];
const nearest = <P extends { x: number; y: number }>(points: readonly P[], x: number, y: number) =>
  points.reduce((best, p) => (Math.hypot(p.x - x, p.y - y) < Math.hypot(best.x - x, best.y - y) ? p : best));

test('a profile shapes a long stroke fully and a short one only in proportion to its length', () => {
  const long = handStampStroke(line(40 * D), { profile: 'taper' }, D, 's');
  assert.ok(long[0].pressure! < 0.25 && long.at(-1)!.pressure! < 0.25, 'a long taper lands and lifts light');
  assert.equal(nearest(long, 20 * D, 0).pressure, 1);
  const short = handStampStroke(line(3 * D), { profile: 'taper' }, D, 's');
  assert.ok(short[0].pressure! > 0.75, `a dab three diameters long barely tapers: ${short[0].pressure}`);
  const flick = handStampStroke(line(40 * D), { profile: 'pressFlick' }, D, 's');
  assert.ok(flick[0].pressure! > 0.75 && nearest(flick, 20 * D, 0).pressure! < 0.4, 'a flick lands heavy and has faded by halfway');
});

test("the path's turns slow the hand and press harder, and it eases in from its start", () => {
  const points = handStampStroke(corner, { curvature: 0.5 }, D, 's');
  const straight = nearest(points, 200, 0), turn = nearest(points, 400, 0);
  assert.ok(turn.pressure! > 0.8 && straight.pressure! <= 0.55, `corner ${turn.pressure}, straight ${straight.pressure}`);
  assert.ok(turn.speed! < 0.7 * straight.speed!, `corner ${turn.speed}, straight ${straight.speed}`);
  assert.ok(points[0].speed! < 0.5 * straight.speed!, 'the hand starts slow');
  // No curvature leaves pressure alone, though the speed still follows the path.
  assert.ok(handStampStroke(corner, {}, D, 's').every((p) => p.pressure === 1));
  // A repeated point on a straight line is no turn, and a point's own speed is multiplied in.
  const repeated = handStampStroke([{ x: 0, y: 0 }, { x: 0, y: 200, speed: 0.5 }, { x: 0, y: 200, speed: 0.5 }, { x: 0, y: 400, speed: 0.5 }], { curvature: 0.5 }, D, 's');
  assert.equal(nearest(repeated, 0, 200).pressure, 0.5);
  assert.equal(nearest(repeated, 0, 300).speed, 0.5);
});

test('wobble is seeded per stroke, stays within its reach and keeps the lifts', () => {
  const path = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 500, y: 0, lift: true }, { x: 800, y: 0 }];
  const hand = { wobble: { pressure: 0.1, position: 0.2 } };
  const a = handStampStroke(path, hand, D, 'a');
  assert.deepEqual(handStampStroke(path, hand, D, 'a'), a);
  assert.notDeepEqual(handStampStroke(path, hand, D, 'b'), a);
  assert.ok(a.every((p) => Math.abs(p.y) <= 0.2 * D && p.pressure! >= 0.9 - 1e-9));
  assert.ok(a.some((p) => Math.abs(p.y) > 0.05 * D), 'the path does move');
  assert.deepEqual(a.filter((p) => p.lift).length, 1, 'the lifted segment stays one jump');
  assert.ok(Math.abs(a.find((p) => p.lift)!.x - 500) < 1e-9 && !a.some((p) => p.x > 301 && p.x < 499));
});

const brush: StampBrush = {
  name: 'Round', blend: 'normal', accumulation: 'glaze',
  tip: { image: { style: 's', pack: 'p', file: 'tip.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1,
  stepping: 'spread',
  jitter: { lateral: 0, size: 0, opacity: 0, flow: 0, roundness: 0 },
  scatter: { count: 1, countJitter: 0, countPressure: 0, radius: 0 },
  rotation: { angle: 0, follow: 0, jitter: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 },
  falloff: 0, flow: 1,
  pressure: { size: 1, opacity: 0, flow: 0, roundness: 0 },
};

test('in a recipe, a hand stroke thins by its profile and its reveal slows through the corner', () => {
  const [even, handed] = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'opaque' }, (group) => group.pass('p', {}, (pass) => {
    pass.stroke('even', { brush, material: { kind: 'flat', color: '#000000' }, diameter: D, path: corner });
    pass.stroke('hand', { brush, material: { kind: 'flat', color: '#000000' }, diameter: D, path: corner, hand: { profile: 'swell', curvature: 0.3 } });
  })))).groups[0].passes[0].deposits;
  assert.ok(even.stamps.every((s) => s.diameter === D));
  assert.ok(handed.stamps[0].diameter < 0.5 * D && nearest(handed.stamps, 400, 0).diameter > 0.9 * D);
  // The reveal it takes to cross 80 px through the corner against 80 px of the straight before it.
  const crossing = (stamps: typeof even.stamps) => (nearest(stamps, 400, 40).reveal - nearest(stamps, 360, 0).reveal) / (nearest(stamps, 240, 0).reveal - nearest(stamps, 160, 0).reveal);
  assert.ok(Math.abs(crossing(even.stamps) - 1) < 0.05);
  assert.ok(crossing(handed.stamps) > 1.3, `the corner takes ${crossing(handed.stamps)} times as long`);
});
