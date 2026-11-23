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
