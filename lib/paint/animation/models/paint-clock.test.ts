import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clipSeconds, compilePaintPlayClock, paintBoilEpochAt, paintPlayClipTimeAt, paintPlayInterval, sceneSeconds, type PaintPlayClock,
} from './paint-clock.ts';

const FPS = 24;
const compiled = (clock: PaintPlayClock) => compilePaintPlayClock(clock, []);
const clipAt = (clock: PaintPlayClock, t: number) => paintPlayClipTimeAt(compiled(clock), sceneSeconds(t), FPS);

test('a loop held on twos and placed at an off-grid cue steps on the scene grid and starts at its first drawing', () => {
  const clock: PaintPlayClock = { at: 1.03, hold: 2, loop: { period: 0.5 } };
  assert.ok(clipAt(clock, 1.0) <= 0, 'before the cue it reads its start');
  // The cue falls between grid steps 1.0 and 1.0833; the first drawing after it shows at the next step.
  assert.ok(Math.abs(clipAt(clock, 1.09) - (26 / 24 - 1.03)) < 1e-9);
  assert.equal(clipAt(clock, 1.09), clipAt(clock, 1.12), 'two render frames inside one hold read one drawing');
  assert.ok(clipAt(clock, 1.03 + 0.5 + 2 / 24) < 0.5, 'it wraps after its period');
});

const twice = (mode: 'repeat' | 'pingpong'): PaintPlayClock => ({ at: 0, loop: { period: 1, mode, times: 2 } });
const epochAt = (frame: number, revealEnd: number) => paintBoilEpochAt(sceneSeconds(frame / 24), sceneSeconds(revealEnd), 2, 24);

test('a play\'s interval follows from its parts, and once it ends it holds its final clip time', () => {
  // Codex's case: held on twos from 0.03 s, a 1 s clip. Its last held drawing before 1.03 s is 0.97 in; it must go on to its end.
  const late: PaintPlayClock = { at: 0.03, hold: 2 };
  assert.deepEqual(paintPlayInterval(compiled(late), clipSeconds(1)), { start: 0.03, end: 1.03 });
  assert.ok(clipAt(late, 1.2) >= 1, `${clipAt(late, 1.2)}`);
  // Half speed from 1 s: the clip runs, and writes until 3 s.
  const slow: PaintPlayClock = { at: 1, rate: 0.5 };
  assert.deepEqual(paintPlayInterval(compiled(slow), clipSeconds(1)), { start: 1, end: 3 });
  assert.equal(clipAt(slow, 2), 0.5);
  // A loop run twice ends with its last cycle: repeating at its period's end, a pingpong back at its start.
  assert.equal(paintPlayInterval(compiled(twice('repeat')), clipSeconds(Infinity)).end, 2);
  assert.deepEqual([0.5, 1.5, 2.5, 9].map((t) => clipAt(twice('repeat'), t)), [0.5, 0.5, 1, 1]);
  assert.deepEqual([0.25, 1.25, 2.5].map((t) => clipAt(twice('pingpong'), t)), [0.25, 0.75, 0]);
  // Cut at `until`, it holds the drawing shown then.
  const cut: PaintPlayClock = { at: 0, hold: 2, until: 0.1 };
  assert.equal(clipAt(cut, 5), clipAt(cut, 0.1));
});

test('a group keeps its drawn seed through its reveal and up to the next grid step, then boils on the grid', () => {
  assert.deepEqual([9, 10, 11, 12, 13, 14].map((frame) => epochAt(frame, 10.5 / 24)), [0, 0, 0, 1, 1, 2]);
  // A group that finished earlier steps on the same frames.
  assert.deepEqual([11, 12, 13, 14].map((frame) => epochAt(frame, 3 / 24) - epochAt(frame - 1, 3 / 24)), [0, 1, 0, 1]);
});
