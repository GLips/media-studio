import assert from 'node:assert/strict';
import { test } from 'node:test';
import { steadyBeatGrid } from '../beats.ts';
import '../tsx-test-hooks.ts';

const { needleContactAt, needlePoseAt, needleScreenPoint } = await import('./needle.tsx');

const g = steadyBeatGrid(120);
// On the beats, the last two out by the frame's corners, where the perspective is strongest.
const strikes = [
  { at: g.at(1), x: 888, y: 588, ink: '#ee4c23' },
  { at: g.at(2), x: 1320, y: 348, ink: '#4144f4' },
  { at: g.at(3), x: 40, y: 1050, ink: '#ff00c2' },
  { at: g.at(4), x: 1880, y: 30, ink: '#19d36b' },
];

test('on its contact frame the tip is on the strike\'s pixel and the contact names it; a frame before, neither', () => {
  for (const [index, s] of strikes.entries()) {
    // A scene's clock can land a hair under the beat: a frame over the fps, less the scene's start.
    for (const t of [s.at, s.at - 1e-9]) {
      const tip = needleScreenPoint(needlePoseAt(strikes, t)!.tip);
      assert.ok(Math.hypot(tip.x - s.x, tip.y - s.y) < 0.01, `strike ${index} at ${t}: tip at ${tip.x}, ${tip.y}`);
      assert.equal(needleContactAt(strikes, t)?.index, index);
    }
    const before = s.at - 1 / 30;
    assert.notEqual(needleContactAt(strikes, before)?.index, index);
    const pose = needlePoseAt(strikes, before);
    assert.ok(!pose || pose.tip[2] > 0, `strike ${index}: the tip is at or in the surface a frame early`);
  }
});
