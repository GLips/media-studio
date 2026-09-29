import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lerp, motionCurves, seg } from '#lib/picture/motion/models/motion.ts';
import { mechanicalWheels, odometerWheels, type OdometerMode, type OdometerWheel } from './odometer-wheels.ts';

const FPS = 30;

/** What the wheels read, highest place first, asserting it's a clean rest: whole rows, no smear, cells whole or gone. */
function restingReading(wheels: OdometerWheel[]): string {
  return wheels.toReversed().map(({ at, was, digitRows: [lo, hi], presence }) => {
    assert.ok(Number.isInteger(at) && at === was, `a wheel still turning, from ${was} to ${at}`);
    assert.ok(presence === 0 || presence === 1, `a cell still growing or shrinking, at ${presence}`);
    return presence === 1 && at >= lo && at <= hi ? String(((at % 10) + 10) % 10) : '';
  }).join('');
}

test('the wheels rest on exactly the digits either side of a roll, and hold still right up to it and from it', () => {
  const cases: { from: number; to: number; decimals: number; mode: OdometerMode; before: string; after: string }[] = [
    { from: 2, to: 1.6, decimals: 2, mode: 'mechanical', before: '200', after: '160' },
    { from: 9.99, to: 10, decimals: 2, mode: 'mechanical', before: '999', after: '1000' },
    { from: 174, to: 9, decimals: 0, mode: 'mechanical', before: '174', after: '9' },
    { from: 1299, to: 1249, decimals: 0, mode: 'direct', before: '1299', after: '1249' },
    { from: 0, to: 174, decimals: 0, mode: 'slot', before: '0', after: '174' },
  ];
  for (const { from, to, decimals, mode, before, after } of cases) {
    const value = (t: number) => lerp(from, to, seg(t, 1, 1.7, motionCurves.expo.entrance));
    const turning = { decimals, mode, spin: 2, lockStagger: 2 / FPS, fps: FPS };
    // Three frames out, a place about to come or go is within reach of the smoothing that moves its cell.
    assert.equal(restingReading(odometerWheels(value, 1 - 3 / FPS, turning)), before, `${mode} ${from} → ${to}, before`);
    assert.equal(restingReading(odometerWheels(value, 1.7 + 3 / FPS, turning)), after, `${mode} ${from} → ${to}, after`);
  }
});

test('a geared place turns only while the place below it rolls over from 9', () => {
  let before = mechanicalWheels(1580, 4);
  for (let step = 1; step <= 800; step++) {
    const now = mechanicalWheels(1580 + step / 20, 4);
    for (let place = 1; place < 4; place++) {
      const below = ((before[place - 1] % 10) + 10) % 10;
      if (now[place] !== before[place]) assert.ok(below >= 9, `place ${place} turned with the one below at ${below}`);
    }
    before = now;
  }
  assert.deepEqual(before, [1620, 162, 16, 1]);
});
