import assert from 'node:assert/strict';
import { test } from 'node:test';
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

test("the path's turns press harder", () => {
  const points = handStampStroke(corner, { curvature: 0.5 }, D, 's');
  const straight = nearest(points, 200, 0), turn = nearest(points, 400, 0);
  assert.ok(turn.pressure! > 0.8 && straight.pressure! <= 0.55, `corner ${turn.pressure}, straight ${straight.pressure}`);
  // No curvature leaves pressure alone.
  assert.ok(handStampStroke(corner, {}, D, 's').every((p) => p.pressure === 1));
  // A repeated point on a straight line is no turn.
  const repeated = handStampStroke([{ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 0, y: 200 }, { x: 0, y: 400 }], { curvature: 0.5 }, D, 's');
  assert.equal(nearest(repeated, 0, 200).pressure, 0.5);
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
