import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { paintedThreePopUpRig, type PaintedThreePopUp } from './painted-three-pop-up.ts';
import { PAINTED_THREE_SHEET_ROOT, type PaintedThreeSheet } from './painted-three-sheet.ts';

const PITCH = 0.9;
const square = (print: string, side: number): PaintedThreeSheet => ({
  print, widthPx: side, heightPx: side,
  root: { outline: [{ x: 0, y: 0 }, { x: side, y: 0 }, { x: side, y: side }, { x: 0, y: side }], hinge: { from: { x: 0, y: side }, to: { x: side, y: side } } },
});

/** A house standing on the base, rising over its first second; a door on the house, rising over its second. */
const POP_UP: PaintedThreePopUp = {
  at: { x: 0, y: 0 }, pitch: PITCH, thicknessPx: 2,
  base: { print: 'base', widthPx: 400, heightPx: 300, root: { outline: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] } },
  sheets: [
    { ...square('door', 40), id: 'door', on: { sheet: 'house' }, at: { x: 50, y: 90 }, angle: ({ at }) => Math.min(1, Math.max(0, at - 1)) * 1.2 },
    { ...square('house', 100), id: 'house', at: { x: 200, y: 200 }, angle: ({ at }) => Math.min(1, at) * PITCH },
  ],
};

const rootOf = (pose: ReturnType<ReturnType<typeof paintedThreePopUpRig>['poseAt']>, sheet: string) => pose.get(sheet)!.get(PAINTED_THREE_SHEET_ROOT)!;
const facingOf = (matrix: ReturnType<typeof rootOf>) => new Vector3(0, 0, 1).transformDirection(matrix);
/** A sheet's x axis, along its print's rows. */
const along = (matrix: ReturnType<typeof rootOf>) => new Vector3(1, 0, 0).transformDirection(matrix);
const halfPerSecond = ({ at }: { at: number }) => at * 0.5;

test('a sheet lies flat on the tipped base, then stands up to face the camera at the pitch', () => {
  const rig = paintedThreePopUpRig(POP_UP);
  assert.deepEqual(rig.order, ['base', 'house', 'door']);
  const flat = rig.poseAt(paintMoment(0)), risen = rig.poseAt(paintMoment(1));
  assert.ok(facingOf(rootOf(flat, 'house')).distanceTo(facingOf(rootOf(flat, 'base'))) < 1e-12);
  assert.ok(facingOf(rootOf(risen, 'house')).distanceTo(new Vector3(0, 0, 1)) < 1e-12);
  // Its hinge stays put on the base's front as it rises: its back's bottom middle.
  const hinge = new Vector3(50, -100, -1);
  assert.ok(hinge.clone().applyMatrix4(rootOf(flat, 'house')).distanceTo(hinge.clone().applyMatrix4(rootOf(risen, 'house'))) < 1e-9);
});

test('a sheet standing on a sheet rides it, its hinge on its parent as both move', () => {
  const rig = paintedThreePopUpRig(POP_UP);
  for (const at of [0.5, 1, 1.5]) {
    const pose = rig.poseAt(paintMoment(at)), doorHinge = new Vector3(20, -40, -1).applyMatrix4(rootOf(pose, 'door'));
    // The house's front at its print px (50, 90).
    assert.ok(doorHinge.distanceTo(new Vector3(50, -90, 1).applyMatrix4(rootOf(pose, 'house'))) < 1e-9);
  }
  assert.throws(() => paintedThreePopUpRig({ ...POP_UP, sheets: [{ ...POP_UP.sheets[0], on: { sheet: 'nowhere' } }] }), /nowhere, which is no sheet/);
  assert.throws(() => paintedThreePopUpRig({ ...POP_UP, sheets: [POP_UP.sheets[1], { ...POP_UP.sheets[0], on: { sheet: 'house', face: 'lid' } }] }), /face lid, which it hasn't/);
});

test('a yawed sheet stands turned about the normal at its spot, and a turn spins the whole pop-up about the middle of the base', () => {
  const house = POP_UP.sheets[1], yaw = 0.7;
  const plain = paintedThreePopUpRig({ ...POP_UP, sheets: [house] }).poseAt(paintMoment(1));
  const turned = paintedThreePopUpRig({ ...POP_UP, turn: halfPerSecond, sheets: [{ ...house, yaw }] }).poseAt(paintMoment(1));
  const base = rootOf(turned, 'base'), normal = facingOf(base);
  // The hinge's middle stays on the base at `at`; the sheet's facing turns by the yaw plus the turn about the base's normal.
  const hinge = new Vector3(50, -100, -1), onBase = new Vector3(200, -200, 1);
  assert.ok(hinge.clone().applyMatrix4(rootOf(turned, 'house')).distanceTo(onBase.clone().applyMatrix4(base)) < 1e-9);
  assert.ok(Math.abs(along(rootOf(turned, 'house')).angleTo(along(rootOf(plain, 'house'))) - (yaw + 0.5)) < 1e-9);
  assert.ok(Math.abs(along(rootOf(turned, 'house')).dot(normal)) < 1e-9);
  // The base's middle doesn't move, and its normal is the unturned one.
  const middle = new Vector3(200, -150, 0);
  assert.ok(middle.clone().applyMatrix4(base).distanceTo(middle.clone().applyMatrix4(rootOf(plain, 'base'))) < 1e-9);
  assert.ok(normal.distanceTo(facingOf(rootOf(plain, 'base'))) < 1e-12);
});

test('a scaled sheet stands smaller about its hinge, and a sheet on it shrinks with it', () => {
  const [door, house] = POP_UP.sheets;
  const pose = paintedThreePopUpRig({ ...POP_UP, sheets: [door, { ...house, scale: 0.5 }] }).poseAt(paintMoment(2));
  const hinge = new Vector3(50, -100, -1), top = new Vector3(50, 0, -1), onBase = new Vector3(200, -200, 1);
  assert.ok(hinge.clone().applyMatrix4(rootOf(pose, 'house')).distanceTo(onBase.clone().applyMatrix4(rootOf(pose, 'base'))) < 1e-9);
  assert.ok(Math.abs(hinge.clone().applyMatrix4(rootOf(pose, 'house')).distanceTo(top.clone().applyMatrix4(rootOf(pose, 'house'))) - 50) < 1e-9);
  const doorSide = new Vector3(0, 0, 0).applyMatrix4(rootOf(pose, 'door')).distanceTo(new Vector3(40, 0, 0).applyMatrix4(rootOf(pose, 'door')));
  assert.ok(Math.abs(doorSide - 20) < 1e-9);
  assert.throws(() => paintedThreePopUpRig({ ...POP_UP, sheets: [{ ...house, scale: 0 }] }), /scaled by 0/);
});

test("a pop-up's reach holds its furthest sheet, however many stand nearer in", () => {
  const house = POP_UP.sheets[1], one = paperReach([house]), many = paperReach(Array.from({ length: 50 }, (_, i) => ({ ...house, id: `house-${i}` })));
  assert.equal(many, one);
  // Every corner of the risen house lies inside it.
  const pose = paintedThreePopUpRig({ ...POP_UP, sheets: [house] }).poseAt(paintMoment(1)), middle = new Vector3(200, -150, 0).applyMatrix4(rootOf(pose, 'base'));
  for (const [x, y] of [[0, 0], [100, 0]]) assert.ok(new Vector3(x, -y, 0).applyMatrix4(rootOf(pose, 'house')).distanceTo(middle) <= one);
});

function paperReach(sheets: PaintedThreePopUp['sheets']) {
  return paintedThreePopUpRig({ ...POP_UP, sheets }).reach;
}
