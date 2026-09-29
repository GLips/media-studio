import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CODE_GLYPHS, scrambleAt, scrambleFinish } from './type.ts';

type Timing = Parameters<typeof scrambleAt>[2];

/** What's locked at `t`, an underscore for each character still scrambling. */
const lockedAt = (text: string, t: number, timing: Timing) => scrambleAt(text, t, timing).map((s) => (s.locked ? s.char : '_')).join('');

test('locks left to right on its schedule, a space never scrambling nor taking a turn', () => {
  // The reference's CODE: C at 0.03 s, then O, D and E 0.05 s apart.
  const code = { seed: 'code', delay: 0.03, each: 0.05 };
  assert.deepEqual([0, 0.05, 0.1, 0.15, 0.2].map((t) => lockedAt('CODE', t, code)), ['____', 'C___', 'CO__', 'COD_', 'CODE']);
  const done = scrambleFinish('CODE', code);
  assert.equal(lockedAt('CODE', done - 1e-4, code), 'COD_', 'the last letter is still scrambling just before scrambleFinish');
  assert.equal(lockedAt('CODE', done, code), 'CODE', 'and locked on it');
  assert.equal(lockedAt('CODE', 0.3, { seed: 'code', delay: 0.1, each: 0.1 }), 'COD_', 'D locks at 0.3, however inexactly summed');

  const box = { seed: 'box', delay: 0, each: 0.1 };
  assert.equal(lockedAt('ONE BOX.', 0.25, box), 'ONE ____', 'B locks the turn after E');
  assert.ok(Math.abs(scrambleFinish('ONE BOX.', box) - 0.6) < 1e-9, 'seven turns: the space takes none');
  assert.equal(lockedAt('ONE BOX.', 0.61, box), 'ONE BOX.');
});

test('scrambles from its charset, the same glyphs for the same seed and tick, re-rolled each tick', () => {
  // Nothing locks inside the window, so every slot shows a glyph.
  const glyphs = (t: number, seed: string | number = 'code', charset?: string) =>
    scrambleAt('CODE', t, { seed, charset, delay: 10, rate: 60 }).map((s) => s.char).join('');
  const ticks = Array.from({ length: 60 }, (_, n) => glyphs((n + 0.25) / 60));

  assert.ok(ticks.every((g) => [...g].every((c) => CODE_GLYPHS.includes(c))), 'the reference\'s code glyphs by default');
  assert.deepEqual(Array.from({ length: 60 }, (_, n) => glyphs((n + 0.75) / 60)), ticks, 'a tick shows one set of glyphs, render after render');
  assert.ok(ticks.filter((g, n) => n > 0 && g !== ticks[n - 1]).length > 50, 'glyphs re-roll from tick to tick');
  assert.notDeepEqual(Array.from({ length: 60 }, (_, n) => glyphs((n + 0.25) / 60, 'hud')), ticks, 'another seed, other glyphs');
  assert.ok([...glyphs(0.1, 'hud', 'AB')].every((c) => c === 'A' || c === 'B'), 'a charset of its own');
});
