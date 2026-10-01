import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintClockTimeAt, type PaintClock } from './paint-clock.ts';

const FPS = 24;

test('a loop held on twos and placed at an off-grid cue steps on the scene grid and starts at its first drawing', () => {
  const clock: PaintClock = [{ kind: 'hold', frames: 2 }, { kind: 'at', start: 1.03 }, { kind: 'loop', period: 0.5, mode: 'repeat' }];
  const at = (t: number) => paintClockTimeAt(clock, t, FPS);
  assert.equal(at(1.0), 0, 'before the cue it reads its start');
  // The cue falls between grid steps 1.0 and 1.0833; the first drawing after it shows at the next step.
  assert.ok(Math.abs(at(1.09) - (26 / 24 - 1.03)) < 1e-9);
  assert.equal(at(1.09), at(1.12), 'two render frames inside one hold read one drawing');
  assert.ok(at(1.03 + 0.5 + 2 / 24) < 0.5, 'it wraps after its period');
});

test('a pingpong loop reflects on odd cycles, and a rate inside a hold steps on its own grid', () => {
  const pingpong: PaintClock = [{ kind: 'loop', period: 1, mode: 'pingpong' }];
  assert.ok(Math.abs(paintClockTimeAt(pingpong, 1.25, FPS) - 0.75) < 1e-9);
  const slowed: PaintClock = [{ kind: 'rate', rate: 0.5 }, { kind: 'hold', frames: 2 }];
  // Half speed, held on twos of its own time: a new drawing every four scene frames.
  const steps = new Set(Array.from({ length: 8 }, (_, frame) => paintClockTimeAt(slowed, frame / FPS, FPS)));
  assert.equal(steps.size, 2);
});
