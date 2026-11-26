import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawingSchedule, redrawSeed } from './drawing-schedule.ts';

const makeSchedule = () => drawingSchedule({ fps: 12 }, [{ at: 0.05, cadence: { fps: 12 } }]);

test('cold and reverse seeks give each mark the same seed on the same drawing', () => {
  const schedule = makeSchedule();
  const times = [0, 1 / 60, 0.05, 0.1, 0.05 + 1 / 12];
  const forward = times.map(schedule.at);
  assert.deepEqual(times.toReversed().map(makeSchedule().at).toReversed(), forward);
  assert.deepEqual(times.map((t) => makeSchedule().at(t)), forward);
  assert.deepEqual(forward.map((d) => d.time), [0, 0, 0.05, 0.05, 0.05 + 1 / 12]);
  const seeds = forward.map((d) => redrawSeed('hero/cheek', d.token));
  assert.equal(seeds[0], seeds[1]);
  assert.equal(seeds[2], seeds[3]);
  assert.equal(new Set(seeds).size, 3);
  assert.notEqual(seeds[0], redrawSeed('hero/eye', forward[0].token));
});

test('live samples follow exposure time while a held phase takes one drawing at the cut', () => {
  const score = drawingSchedule({ live: 30 }, [{ at: 1, cadence: 'held' }]);
  assert.equal(score.at(0.01).time, 0.01);
  assert.equal(score.at(0.01).token, score.at(0).token);
  assert.notEqual(score.at(1 / 30).token, score.at(0).token);
  assert.deepEqual(score.at(2), score.at(1));
  assert.equal(score.at(2).time, 1);
});

test('invalid cadence or cut data fails before sampling', () => {
  for (const fps of [Infinity, NaN, 0, -1]) {
    assert.throws(() => drawingSchedule({ fps }), /drawing fps must be finite and positive/);
    assert.throws(() => drawingSchedule('held', [{ at: 1, cadence: { live: fps } }]), /drawing fps must be finite and positive/);
  }
  assert.throws(() => drawingSchedule('held', [2, 1].map((at) => ({ at, cadence: 'held' }))), /strictly increasing/);
});
