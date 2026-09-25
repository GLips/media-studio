import assert from 'node:assert/strict';
import { test } from 'node:test';
import { steadyBeatGrid } from '../beats.ts';
import '../tsx-test-hooks.ts';

const { bouncingBallAt } = await import('./bounce.tsx');

// The showcase's first bar: four landings a beat apart at 120 BPM, the last launching into the swell.
const grid = steadyBeatGrid(120, 0.5);
const bar = { beats: [0, 1, 2, 3].map((n) => grid.at(n)), spb: grid.spb, launch: {} };

test('lands on each beat at its biggest squash, resting on the line it dents', () => {
  for (const [i, beat] of bar.beats.entries()) {
    const pose = bouncingBallAt(beat, bar);
    assert.equal(pose.phase, 'contact');
    assert.equal(pose.contact, i);
    assert.ok(Math.abs(pose.w / pose.h - 3.4) < 1e-9 && Math.abs(pose.angle) < 1e-9, `landing ${i} is 3.4:1 flat on its beat`);
    assert.ok(Math.abs(pose.y + pose.h / 2 - (700 + pose.dent)) < 1e-9, `landing ${i} rests on the dented line`);
    for (const off of [-1 / 30, -1 / 60, 1 / 60, 1 / 30]) {
      const near = bouncingBallAt(beat + off, bar);
      assert.ok(near.w / near.h < 3.3, `landing ${i} is flatter on its beat than ${(off * 60).toFixed(0)} reference frames off it`);
    }
  }
});

test('moves without a jump and keeps its area, from the drop to a covered frame', () => {
  // The launch peaks near 8,000 px/s: at 8 kHz no honest step reaches 2 px, and a seam between phases would.
  const dt = 1 / 8000, fill = bar.beats[3] + grid.spb - 1 / 30;
  let last = bouncingBallAt(0, bar);
  for (let t = dt; t <= fill; t += dt) {
    const pose = bouncingBallAt(t, bar);
    if (last.phase !== 'waiting') {
      assert.ok(Math.hypot(pose.x - last.x, pose.y - last.y) < 2, `${t.toFixed(4)} s: the centre jumps`);
      assert.ok(Math.abs(Math.log(pose.w / pose.h) - Math.log(last.w / last.h)) < 0.05, `${t.toFixed(4)} s: the shape jumps`);
    }
    if (pose.phase !== 'waiting' && pose.phase !== 'swell') {
      assert.ok(Math.abs(pose.w * pose.h - 112 * 112) < 1e-6, `${t.toFixed(4)} s: ${pose.w.toFixed(1)} × ${pose.h.toFixed(1)} px`);
    }
    last = pose;
  }
  assert.equal(bouncingBallAt(fill, bar).phase, 'field');
});
