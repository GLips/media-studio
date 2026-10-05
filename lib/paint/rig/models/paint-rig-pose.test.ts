import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { PaintRigCutDeclaration } from './paint-rig-cuts.ts';
import { paintRigMirroredPose, paintRigPosedPoint, paintRigTwoBoneReach, type PaintRigMoves, type PaintRigSkeleton } from './paint-rig-pose.ts';

const HIP = { x: 100, y: 120 }, KNEE = { x: 110, y: 180 }, ANKLE = { x: 100, y: 240 };
const legParts = (at: (p: StampPoint) => StampPoint): PaintRigCutDeclaration[] => [
  { id: 'body', z: 0, parent: null },
  { id: 'thigh', z: 1, parent: 'body', joint: 'hinge', pivot: at(HIP) },
  { id: 'shin', z: 2, parent: 'thigh', joint: 'skin', pivot: at(KNEE), blend: 8 },
];
const LEG: PaintRigSkeleton = { parts: legParts((p) => p), pivot: { x: 100, y: 100 } };
const BODY = { body: { x: 7, y: -4, rotation: 0.2 } } satisfies PaintRigMoves;
const near = (a: StampPoint, b: StampPoint, within = 1e-9) => Math.hypot(a.x - b.x, a.y - b.y) <= within;
/** Which way round `b` lies from `a` about `o`, as the picture shows it (y down): positive clockwise. */
const side = (o: StampPoint, a: StampPoint, b: StampPoint) => Math.sign((a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x));

test('a two-bone reach puts its tip on the target, riding its turned and moved parent, its joint on the side asked', () => {
  const hip = paintRigPosedPoint(LEG, BODY, 'body', HIP);
  for (const target of [{ x: 150, y: 210 }, { x: 60, y: 200 }, { x: 130, y: 140 }]) {
    for (const bend of ['clockwise', 'counterclockwise'] as const) {
      const reach = paintRigTwoBoneReach(LEG, BODY, { chain: ['thigh', 'shin'], tip: ANKLE, target, bend });
      const posed = { ...BODY, thigh: { rotation: reach.upper }, shin: { rotation: reach.lower } };
      assert.ok(near(paintRigPosedPoint(LEG, posed, 'shin', ANKLE), target) && near(reach.tip, target));
      assert.ok(near(paintRigPosedPoint(LEG, posed, 'thigh', KNEE), reach.joint));
      assert.equal(side(hip, target, reach.joint), bend === 'clockwise' ? 1 : -1);
      // The shin's turn in the group's frame is its parents' and its own: a foot hanging level turns by its negative.
      assert.ok(Math.abs(Math.sin(0.2 + reach.upper + reach.lower - reach.turn)) < 1e-12);
    }
  }
});

test('a reach straightens continuously as its target leaves, and points straight at one past its full reach', () => {
  const hip = paintRigPosedPoint(LEG, BODY, 'body', HIP), full = 2 * Math.hypot(KNEE.x - HIP.x, KNEE.y - HIP.y);
  let opening = Math.PI;
  for (let k = 0.9; k <= 1.3; k += 0.001) {
    const target = { x: hip.x + 0.6 * k * full, y: hip.y + 0.8 * k * full };
    const { joint, tip } = paintRigTwoBoneReach(LEG, BODY, { chain: ['thigh', 'shin'], tip: ANKLE, target, bend: 'counterclockwise' });
    const now = Math.abs(Math.atan2(joint.y - hip.y, joint.x - hip.x) - Math.atan2(0.8, 0.6));
    assert.ok(now <= opening + 1e-12, `the joint opened again at ${k.toFixed(3)} of full reach`);
    opening = now;
    if (k >= 1) assert.ok(now < 1e-7 && near(tip, { x: hip.x + 0.6 * full, y: hip.y + 0.8 * full }, 1e-6));
  }
});

/** A point mirrored in water lying at y 260. */
const mirror = (p: StampPoint) => ({ x: p.x, y: 2 * 260 - p.y });

test('a mirrored pose poses the rig drawn mirrored as the mirror image of the rig, keeping each part\'s cel', () => {
  const reflection: PaintRigSkeleton = { parts: legParts(mirror), pivot: mirror(LEG.pivot) };
  const pose = { ...BODY, thigh: { rotation: -0.4, x: 3 }, shin: { rotation: 0.9, y: 2, cel: 'shin-bent' } };
  const mirrored = paintRigMirroredPose(pose, 'y');
  assert.deepEqual(mirrored.shin, { rotation: -0.9, y: -2, cel: 'shin-bent' });
  for (const point of [ANKLE, { x: 104, y: 200 }]) {
    assert.ok(near(paintRigPosedPoint(reflection, mirrored, 'shin', mirror(point)), mirror(paintRigPosedPoint(LEG, pose, 'shin', point))));
  }
});
