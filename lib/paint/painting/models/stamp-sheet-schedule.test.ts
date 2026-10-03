import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StampSheetClock } from './stamp-sheet-program.ts';
import { StampSheetRefusal } from './stamp-sheet-refusal.ts';
import {
  stampSheetClockStarted, stampSheetDecided, stampSheetEntryFrom, stampSheetSceneOf, stampSheetSolveStart, stampSheetWashSetMoment, stampSheetWashStart,
} from './stamp-sheet-schedule.ts';

/** A solve's state whose unclocked run ended at model `tc`, its clock starting there at scene `scene`. */
const clockedAt = (tc: number, scene: number | null) => stampSheetClockStarted(stampSheetDecided(stampSheetSolveStart(1, 2), { tau: tc, scene: null }), scene);

test('on a scale, a wash starts at its origin mapped from τc, the second exact, refused while its layer is still wet; a set wash waits on the grid', () => {
  const clock: StampSheetClock = { kind: 'scale', scale: 0.025, origin: 2 }, state = clockedAt(100, 2);
  assert.deepEqual(stampSheetWashStart(clock, state, { origin: 6 }, true, 150), { kind: 'starts', at: { tau: 260, exact: 6 } });
  assert.deepEqual(stampSheetWashStart(clock, state, { origin: 6 }, true, 300), { kind: 'still-wet', origin: 6, until: 7 });
  assert.deepEqual(stampSheetWashStart(clock, state, { origin: 6 }, true, Infinity), { kind: 'never-sets' });
  const set = stampSheetWashStart(clock, state, { origin: 'set' }, true, 123.4561);
  assert.ok(set.kind === 'starts');
  assert.ok(Math.abs(set.at.tau - 123.457) < 1e-9 && set.at.exact === null);
  assert.ok(Math.abs(stampSheetSceneOf(clock, state, 6, set.at)! - (2 + 23.457 * 0.025)) < 1e-9);
});

test('under instant a clocked entry lands from when the sheet has set, at its order time; an unclocked one by the laws; its wash set at its last landing', () => {
  const clock: StampSheetClock = { kind: 'instant' }, state = clockedAt(10, null), from = { tau: 10, exact: null };
  const clocked = stampSheetEntryFrom(clock, state, { name: 'dot', orderTime: 3, at: null }, from, 12.3456);
  assert.ok(Math.abs(clocked.tau - 12.346) < 1e-9);
  assert.equal(stampSheetSceneOf(clock, state, 3, clocked), 3);
  assert.deepEqual(stampSheetEntryFrom(clock, state, { name: 'ground', orderTime: null, at: null }, from, 12.3456), from);
  assert.deepEqual(stampSheetWashSetMoment(clock, stampSheetDecided(state, { tau: 12.346, scene: 3 }), true, 15), { tau: 15, scene: 3 });
});

test('a fixed at on a scale lands at its own scene second exactly, and is refused before its predecessor', () => {
  const clock: StampSheetClock = { kind: 'scale', scale: 0.025, origin: 0 }, state = clockedAt(0, 0), late = { name: 'late', orderTime: 9, at: 9 };
  const fixed = stampSheetEntryFrom(clock, state, late, { tau: 100, exact: null }, null);
  assert.deepEqual(fixed, { tau: 360, exact: 9 });
  assert.equal(stampSheetSceneOf(clock, state, 9, fixed), 9);
  assert.throws(() => stampSheetEntryFrom(clock, state, late, { tau: 400, exact: null }, null), (error) => error instanceof StampSheetRefusal && error.message === 'late: fixed at 9 s precedes its predecessor at 10 s');
});
