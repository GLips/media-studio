import assert from 'node:assert/strict';
import { test } from 'node:test';
import { steadyBeatGrid } from '#models/timeline/beat-grid.ts';
import { needleContactAt, needlePoseAt, needleRig, needleScreenPoint, needleShotAt } from './needle.ts';

const rig = needleRig({ format: { fps: 30, width: 1920, height: 1080 } });

const g = steadyBeatGrid(120);
// On the beats, the last two out by the frame's corners, where the perspective is strongest.
const strikes = [
  { at: g.at(1), x: 888, y: 588, ink: '#ee4c23', streak: true },
  { at: g.at(2), x: 1320, y: 348, ink: '#4144f4' },
  { at: g.at(3), x: 40, y: 1050, ink: '#ff00c2' },
  { at: g.at(4), x: 1880, y: 30, ink: '#19d36b' },
];
const lensing = { rig, shutter: 0.25, fastShutter: 1, focus: 6 };

test('every exposure of a contact frame sees the tip on its strike\'s pixel, and the contact names it; a frame before, it is coming in', () => {
  for (const [index, s] of strikes.entries()) {
    // A scene's clock can land a hair under the beat: a frame over the fps, less the scene's start.
    for (const t of [s.at, s.at - 1e-9]) {
      const shot = needleShotAt(strikes, t, lensing);
      for (const share of [1, 0.5, 0]) {
        const tip = needleScreenPoint(needlePoseAt(strikes, shot.exposureAt((-share * shot.shutter) / 30), rig)!.tip, rig);
        assert.ok(Math.hypot(tip.x - s.x, tip.y - s.y) < 0.01, `strike ${index} at ${t}, ${share} of the shutter back: tip at ${tip.x}, ${tip.y}`);
      }
      assert.equal(needleContactAt(strikes, t)?.index, index);
    }
    const before = s.at - 1 / 30;
    assert.notEqual(needleContactAt(strikes, before)?.index, index);
    const pose = needlePoseAt(strikes, before, rig)!;
    assert.ok(pose.tip[2] > 0 && pose.fast, `strike ${index}: a frame early the tip is ${pose.tip[2]} px up, fast: ${pose.fast}`);
  }
});

test('each strike is one blow: out of shot between strikes, in and out at the fast shutter, sharp from the contact through the drive', () => {
  const frames = (s: (typeof strikes)[number], ks: number[]) => ks.map((k) => needleShotAt(strikes, s.at + k / 30, lensing));
  for (const [index, s] of strikes.entries()) {
    const [early, coming, contact, drive, leaving, gone, between] = frames(s, [-3, -1, 0, 1, 3, 4, 8]);
    assert.equal(early.pose, null, `strike ${index}: in shot three frames early`);
    assert.equal(between.pose, null, `strike ${index}: in shot between strikes`);
    assert.deepEqual([coming, leaving].map((f) => f.pose?.fast && f.shutter), [1, 1], `strike ${index}: coming in and leaving`);
    assert.deepEqual([contact, drive].map((f) => !f.pose!.fast && f.shutter), [0.25, 0.25], `strike ${index}: contact and drive`);
    // Gone, but the frame's shutter still catches the end of the exit.
    assert.deepEqual([gone.pose, gone.shutter], [null, 1], `strike ${index}: the frame after it leaves`);
    assert.equal(contact.streak !== null, index === 0, `strike ${index}: a streak on its contact frame`);
  }
  // The streak takes the whole way in: its first moment has the needle wholly out of frame.
  const streak = needleShotAt(strikes, strikes[0].at, lensing).streak!;
  const first = needlePoseAt(strikes, streak.exposureAt((-(1 - 1e-6) * streak.shutter) / 30), rig)!;
  const tip = needleScreenPoint(first.tip, rig);
  assert.ok(tip.x > 1920 || tip.x < 0 || tip.y > 1080 || tip.y < 0, `the streak starts with the tip at ${tip.x}, ${tip.y}`);
  assert.equal(streak.shutter, rig.enter * 30);
});
