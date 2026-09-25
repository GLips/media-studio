import assert from 'node:assert/strict';
import { test } from 'node:test';
import { steadyBeatGrid } from '../beats.ts';
import '../tsx-test-hooks.ts';

const { NEEDLE_RIG, needleContactAt, needleLensHeight, needlePoseAt, needleScreenPoint, needleShotAt } = await import('./needle.tsx');

const g = steadyBeatGrid(120);
// On the beats, the last two out by the frame's corners, where the perspective is strongest.
const strikes = [
  { at: g.at(1), x: 888, y: 588, ink: '#ee4c23' },
  { at: g.at(2), x: 1320, y: 348, ink: '#4144f4' },
  { at: g.at(3), x: 40, y: 1050, ink: '#ff00c2' },
  { at: g.at(4), x: 1880, y: 30, ink: '#19d36b' },
];
const lensing = { shutter: 0.25, fastShutter: 0.5, focus: 6 };

test('every exposure of a contact frame sees the tip on its strike\'s pixel, and the contact names it; a frame before, it is still falling', () => {
  for (const [index, s] of strikes.entries()) {
    // A scene's clock can land a hair under the beat: a frame over the fps, less the scene's start.
    for (const t of [s.at, s.at - 1e-9]) {
      const shot = needleShotAt(strikes, t, lensing);
      for (const share of [1, 0.5, 0]) {
        const tip = needleScreenPoint(needlePoseAt(strikes, shot.exposureAt((-share * shot.shutter) / 30))!.tip);
        assert.ok(Math.hypot(tip.x - s.x, tip.y - s.y) < 0.01, `strike ${index} at ${t}, ${share} of the shutter back: tip at ${tip.x}, ${tip.y}`);
      }
      assert.equal(needleContactAt(strikes, t)?.index, index);
    }
    const before = s.at - 1 / 30;
    assert.notEqual(needleContactAt(strikes, before)?.index, index);
    const pose = needlePoseAt(strikes, before)!;
    assert.ok(pose.tip[2] > 0 && pose.fast, `strike ${index}: a frame early the tip is ${pose.tip[2]} px up, fast: ${pose.fast}`);
  }
});

test('between two beats it lifts from the "and" till its image is `lift` bigger, and falls in two frames at the fast shutter', () => {
  const lens = needleLensHeight(NEEDLE_RIG.fov);
  for (let index = 0; index < strikes.length - 1; index++) {
    const frame = g.frame(index + 1);
    const grow = (k: number) => {
      const z = needlePoseAt(strikes, (frame + k) / 30)!.tip[2];
      return z / (lens - z);
    };
    assert.ok(grow(7) < 0.2 * NEEDLE_RIG.lift, `strike ${index}: grown ${grow(7)} on the "and"`);
    assert.ok(grow(11) > 0.9 * NEEDLE_RIG.lift, `strike ${index}: grown ${grow(11)} four frames on`);
    assert.ok(Math.abs(grow(13) - NEEDLE_RIG.lift) < 1e-6, `strike ${index}: grown ${grow(13)} at the top`);
    const fast = Array.from({ length: 15 }, (_, k) => k).filter((k) => needleShotAt(strikes, (frame + k) / 30, lensing).shutter === 0.5);
    assert.deepEqual(fast, [13, 14], `strike ${index}`);
  }
});
