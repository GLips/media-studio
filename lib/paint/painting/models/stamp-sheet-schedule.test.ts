import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StampSheetClock } from './stamp-sheet-program.ts';
import { StampSheetRefusal } from './stamp-sheet-refusal.ts';
import {
  stampSheetClockStarted, stampSheetDecided, stampSheetEntryFrom, stampSheetMomentAfter, stampSheetSceneOf, stampSheetSolveStart, stampSheetUnreachable,
  stampSheetWashStart, type StampSheetLift, type StampSheetShortRefused,
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
  assert.deepEqual(stampSheetMomentAfter(clock, stampSheetDecided(state, { tau: 12.346, scene: 3 }), true, 15), { tau: 15, scene: 3 });
});

test('a fixed at on a scale lands at its own scene second exactly, and is refused before its predecessor', () => {
  const clock: StampSheetClock = { kind: 'scale', scale: 0.025, origin: 0 }, state = clockedAt(0, 0), late = { name: 'late', orderTime: 9, at: 9 };
  const fixed = stampSheetEntryFrom(clock, state, late, { tau: 100, exact: null }, null);
  assert.deepEqual(fixed, { tau: 360, exact: 9 });
  assert.equal(stampSheetSceneOf(clock, state, 9, fixed), 9);
  assert.throws(() => stampSheetEntryFrom(clock, state, late, { tau: 400, exact: null }, null), (error) => error instanceof StampSheetRefusal && error.message === 'late: fixed at 9 s precedes its predecessor at 10 s');
});

test('a wet short where it lands names the fix for what its core did: too late, a lift it crosses, nothing shiny, else the rim', () => {
  const lost = { x0: 64, y0: 32, x1: 96, y1: 64 }, rim = { x0: 0, y0: 96, x1: 32, y1: 128 }, glint: StampSheetLift = { name: 'glint', support: { x0: 70, y0: 0, x1: 82, y1: 120 } };
  const fail = (held: number, dulled: number, unshone: readonly (typeof lost)[], fixed: number | null = null, never = 0) => stampSheetUnreachable({
    name: 'reeds', rule: { on: 'wet', lifts: [glint] }, at: { tau: 2, held, totals: { weight: 1000, never, dulled } }, where: { boxes: [lost, rim], unshone },
    unscheduled: ['ripple'], regime: 'drying', fixed,
  });
  assert.equal(
    fail(800, 0, [lost]),
    "reeds: unreachable from this committed prefix: on 'wet' held over 80% of its core (needs 95%) when it lands, at model 2 s [64,32 → 96,64] [0,96 → 32,128]; " +
      "it crosses glint, which took up the paper's water there: lay it before glint. Unscheduled after it: ripple",
  );
  // Flood, lift, a wait, then the charge: the flood dried past its shine outweighs the lift's track, so the lift isn't the fix.
  assert.match(fail(0, 850, [lost]), /; the water under it dried past shiny before it lands: lay it sooner, ahead of what waits after that water, or flood wetter before it\. /);
  assert.match(fail(600, 300, [lost], 9), /when it lands, at its `at` of 9 s .*; the water under it dried past shiny before its `at`: move the `at` earlier, or flood wetter/);
  assert.match(fail(800, 0, [rim]), /; part of its core lies where the water under it falls away \(a flood's rim/);
  assert.match(fail(0, 0, [rim]), /held over 0% .*; nothing under it is shiny: flood wetter before it\. /);
  assert.match(fail(800, 0, [lost], null, 100), /; never wetted on this sheet: 10% of its core met no water before it/);
});

/** A `damp` or `dry` application's refusal, holding `held` of 1000 at model 5 s. */
const coatRefused = (on: 'damp' | 'dry', held: number, regime: StampSheetShortRefused['regime'], fixed: number | null = null, unscheduled: readonly string[] = []) => stampSheetUnreachable({
  name: 'coat', rule: { on }, at: { tau: 5, held, totals: { weight: 1000, never: 0, dulled: 0 } }, where: { boxes: [], unshone: [] }, unscheduled, regime, fixed,
});

test("a refusal names the first five applications it leaves unscheduled and counts the rest", () => {
  assert.match(coatRefused('damp', 400, 'drying', null, ['a', 'b', 'c', 'd', 'e', 'f', 'g']), /\. Unscheduled after it: a, b, c, d, e and 2 more$/);
});

test("an on's refusal prints its share a tenth under the need it misses, an upper bound only for a damp searched as the paper dries", () => {
  assert.match(coatRefused('damp', 946, 'drying'), /on 'damp' held over at most 94\.6% of its core \(needs 95%\), at model 5 s; sets before the rest turns matte/);
  assert.match(coatRefused('dry', 996, 'never'), /on 'dry' held over 99\.6% of its core \(needs 100%\), at model 5 s; nothing dries/);
  assert.equal(
    coatRefused('damp', 400, 'drying', 6),
    "coat: unreachable from this committed prefix: on 'damp' held over 40% of its core (needs 95%), at its `at` of 6 s; " +
      'move the `at` to where `studio paint check --solve` says its paper is damp, or drop the `on`',
  );
});
