import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { paintKeyed, paintKeyedHit } from './paint-keyed.ts';

/** `value` read every hundredth of a second from `from` to `to` seconds. */
const sampled = <T,>(value: (moment: ReturnType<typeof paintMoment>) => T, from: number, to: number) =>
  Array.from({ length: Math.round((to - from) * 100) + 1 }, (_, i) => value(paintMoment(from + i / 100)));

test('smooth passes each key at speed and never past it; only a spring or back overshoots, then settles on its key', () => {
  const rising = paintKeyed([{ at: 0, value: 0 }, { at: 1, value: 10 }, { at: 2, value: 12 }, { at: 3, value: 40 }], { between: 'smooth' });
  const steps = sampled(rising, 0, 3);
  assert.ok(steps.every((v, i) => i === 0 || v >= steps[i - 1] - 1e-9), 'it never turns back between rising keys');
  assert.ok(rising(paintMoment(1.01)) - rising(paintMoment(0.99)) > 0.05, 'it passes key 1 moving');
  assert.ok(rising(paintMoment(0.01)) < 0.01, 'it leaves its first key from rest');
  const turning = sampled(paintKeyed([{ at: 0, value: 0 }, { at: 1, value: 10 }, { at: 2, value: 5 }], { between: 'smooth' }), 0, 2);
  assert.equal(Math.max(...turning), 10);
  assert.equal(Math.min(...turning.slice(100)), 5);

  const sprung = paintKeyed([{ at: 0, value: 0 }, { at: 1, value: 10, curve: { spring: { duration: 0.5, bounce: 0.3 } } }]);
  assert.ok(Math.max(...sampled(sprung, 0, 3)) > 10.2, 'a bouncing spring passes its key');
  assert.ok(Math.abs(sprung(paintMoment(sprung.settlesAt)) - 10) < 0.05, 'and has settled by settlesAt');
  const backed = paintKeyed([{ at: 0, value: 0 }, { at: 1, value: 10, curve: { back: 0.1 } }]);
  assert.ok(Math.max(...sampled(backed, 0, 1)) > 10.5);
  assert.equal(backed(paintMoment(1)), 10);
});

test('a hold keeps the value before it until its time, a through point is passed on the way, and a channel takes its own curve', () => {
  const walk = paintKeyed([
    { at: 0, value: { x: 0, y: 0 } }, { at: 1, hold: true },
    { at: 2, value: { x: 100, y: 0 }, through: [{ x: 50, y: 40 }] },
    { at: 3, value: { x: 110, y: 10 }, curves: { x: 'in' } },
  ]);
  assert.deepEqual(walk(paintMoment(0.9)), { x: 0, y: 0 });
  const passing = Math.min(...sampled(walk, 1, 2).map(({ x, y }) => Math.hypot(x - 50, y - 40)));
  assert.ok(passing < 1, `it passes its through point, nearest ${passing} px`);
  // Half way to key 3, x has eased in a quarter of its 10 px; y, by no curve, half of its.
  const half = walk(paintMoment(2.5));
  assert.ok(Math.abs(half.x - 102.5) < 1e-9 && Math.abs(half.y - 5) < 1e-9, JSON.stringify(half));
});

test('a hit winds back, strikes and settles from rest to rest; keys are refused out of order, of another shape, or curved first', () => {
  const hit = paintKeyedHit({ at: 1, peak: 12, attack: 0.1, settle: 0.4, anticipate: { value: -3, lead: 0.2 } });
  // Wound back from 0.7 s to 0.9 s, struck by 1 s, settled by 1.4 s, each stretch half way at its middle.
  const at = (t: number) => Math.round(hit(paintMoment(t)) * 1e9) / 1e9;
  assert.deepEqual([0, 0.7, 0.8, 0.9, 0.95, 1, 1.2, 1.4, 2].map(at), [0, 0, -1.5, -3, 4.5, 12, 6, 0, 0]);
  assert.throws(() => paintKeyed([{ at: 1, value: 0 }, { at: 1, value: 2 }]), /key 1 is at 1 s, not after key 0/);
  assert.throws(() => paintKeyed([{ at: 0, value: { x: 0 } }, { at: 1, value: { x: 1, y: 2 } }]), /key 1's value isn't shaped as key 0's/);
  assert.throws(() => paintKeyed([{ at: 0, value: 0, curve: 'inOut' }, { at: 1, value: 2 }]), /key 0 has a curve/);
});
