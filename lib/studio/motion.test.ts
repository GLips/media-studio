import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FPS } from './frame.ts';
import { springBy, stagger, staggerFinish } from './motion.ts';

test('a deadline spring looks landed at its deadline, not before, and settles to exactly 1 later', () => {
  for (const bounce of [0, 0.3, 0.6]) {
    const s = springBy(0.6, bounce);
    const frame = 1 / FPS;
    assert.ok(Math.abs(1 - s(0.6)) < 0.005, `bounce ${bounce}: ${s(0.6)} at the deadline`);
    assert.ok(Math.abs(1 - s(0.6 - frame)) >= 0.005, `bounce ${bounce}: landed a frame early`);
    assert.ok(s.settled > s.landed, `bounce ${bounce}: settles at ${s.settled}`);
    assert.equal(s(s.settled + frame), 1);
  }
});

test('a capped stagger spreads starts over the cap on whole frames, and its finish is the last start plus the move', () => {
  const starts = Array.from({ length: 20 }, (_, i) => stagger(i, 20, { each: 0.08, max: 0.4 }));
  assert.equal(starts[0], 0);
  assert.equal(starts[19], 0.4);
  for (const t of starts) assert.ok(Math.abs(t * FPS - Math.round(t * FPS)) < 1e-9, `${t} is between frames`);
  assert.ok(new Set(starts).size < 20, 'a long capped list shares frames');
  assert.equal(staggerFinish(20, { each: 0.08, max: 0.4, duration: 0.5 }), 0.9);
  assert.equal(staggerFinish(0, { each: 0.08, duration: 0.5 }), 0);
  assert.equal(stagger(0, 1, { each: 0.08, max: 0.4 }), 0);
});

test('a stagger from the centre, the edges or an index starts its first mover at 0 and its last at the full spread', () => {
  const from = (n: number, f: 'center' | 'edges' | number) => Array.from({ length: n }, (_, i) => stagger(i, n, { lagRatio: 0.5, duration: 0.4, from: f }));
  assert.deepEqual(from(4, 'center'), [0.2, 0, 0, 0.2]);
  assert.deepEqual(from(5, 'edges'), [0, 0.2, 0.4, 0.2, 0]);
  assert.deepEqual(from(5, 3), [0.6, 0.4, 0.2, 0, 0.2]);
});
