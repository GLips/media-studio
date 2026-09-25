import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FPS } from './frame.ts';
import { backOutEase, perceptualSpring, springBy, stagger, staggerFinish } from './motion.ts';

test('a back-out overshoots by the share of its travel asked for and lands on exactly 1', () => {
  const peak = (ease: (k: number) => number) => Math.max(...Array.from({ length: 10001 }, (_, i) => ease(i / 10000)));
  const pop = backOutEase(0.126);
  assert.ok(Math.abs(peak(pop) - 1.126) < 1e-4, `peaks at ${peak(pop)}`);
  assert.equal(pop(0), 0);
  assert.equal(pop(1), 1);
  assert.ok(peak(backOutEase(0)) <= 1 + 1e-12);
});

test('a deadline spring looks landed at its deadline, not before, and settles to exactly 1 at `settled`', () => {
  for (const bounce of [0, 0.3, 0.6, 0.75]) {
    const s = springBy(0.6, bounce);
    const frame = 1 / FPS;
    assert.ok(Math.abs(1 - s(0.6)) < 0.005, `bounce ${bounce}: ${s(0.6)} at the deadline`);
    assert.ok(Math.abs(1 - s(0.6 - frame)) >= 0.005, `bounce ${bounce}: landed a frame early`);
    assert.ok(s.settled > s.landed, `bounce ${bounce}: settles at ${s.settled}`);
    assert.equal(s(s.settled + frame), 1);
    assert.notEqual(s(s.settled - frame), 1, `bounce ${bounce}: still before ${s.settled}`);
  }
});

test('a perceptual spring is the mass-spring Apple and kvin.me define, and holds exactly 1 from `settled`', () => {
  for (const bounce of [0, 0.3, 0.6]) {
    const d = 0.5, s = perceptualSpring(d, bounce);
    // mass 1, stiffness (2π/d)², damping (1 − bounce)·4π/d, pulled from 0 toward 1, integrated in small steps.
    const k = (2 * Math.PI / d) ** 2, c = ((1 - bounce) * 4 * Math.PI) / d, dt = 1e-5;
    let x = 0, v = 0;
    for (let i = 1; i <= 0.8 / dt; i++) {
      v += (k * (1 - x) - c * v) * dt;
      x += v * dt;
      if (i % 5000 === 0) assert.ok(Math.abs(s(i * dt) - x) < 1e-3, `bounce ${bounce} at ${i * dt}s: ${s(i * dt)} vs ${x}`);
    }
    assert.ok(Math.abs(s(s.arrival) - 0.98) < 1e-3 && s.arrival < s.settled, `bounce ${bounce}: arrives at ${s(s.arrival)}`);
    assert.equal(s(s.settled), 1);
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
