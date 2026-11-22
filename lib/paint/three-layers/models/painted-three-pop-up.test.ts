import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { PaintedThreeCard } from './painted-three-card.ts';
import { paintedThreePopUpRig, type PaintedThreePopUp } from './painted-three-pop-up.ts';

const PITCH = 0.9;
const square = (print: string, side: number): PaintedThreeCard => ({
  print, widthPx: side, heightPx: side,
  outline: { shape: [{ x: 0, y: 0 }, { x: side, y: 0 }, { x: side, y: side }, { x: 0, y: side }], hinge: { from: { x: 0, y: side }, to: { x: side, y: side } } },
});

/** A house standing on the base, rising over its first second; a door on the house, rising over its second. */
const POP_UP: PaintedThreePopUp = {
  at: { x: 0, y: 0 }, pitch: PITCH, thicknessPx: 2,
  base: { print: 'base', widthPx: 400, heightPx: 300, outline: { shape: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] } },
  cards: [
    { ...square('door', 40), id: 'door', on: 'house', at: { x: 50, y: 90 }, angle: ({ at }) => Math.min(1, Math.max(0, at - 1)) * 1.2 },
    { ...square('house', 100), id: 'house', at: { x: 200, y: 200 }, angle: ({ at }) => Math.min(1, at) * PITCH },
  ],
};

const facingOf = (matrix: ReturnType<ReturnType<typeof paintedThreePopUpRig>['poseAt']> extends ReadonlyMap<string, infer M> ? M : never) => new Vector3(0, 0, 1).transformDirection(matrix);

test('a card lies flat on the tipped base, then stands up to face the camera at the pitch', () => {
  const rig = paintedThreePopUpRig(POP_UP);
  assert.deepEqual(rig.order, ['base', 'house', 'door']);
  const flat = rig.poseAt(paintMoment(0)), risen = rig.poseAt(paintMoment(1));
  assert.ok(facingOf(flat.get('house')!).distanceTo(facingOf(flat.get('base')!)) < 1e-12);
  assert.ok(facingOf(risen.get('house')!).distanceTo(new Vector3(0, 0, 1)) < 1e-12);
  // Its hinge stays put on the base's front as it rises: its back's bottom middle.
  const hinge = new Vector3(50, -100, -1);
  assert.ok(hinge.clone().applyMatrix4(flat.get('house')!).distanceTo(hinge.clone().applyMatrix4(risen.get('house')!)) < 1e-9);
});

test('a card standing on a card rides it, its hinge on its parent as both move', () => {
  const rig = paintedThreePopUpRig(POP_UP);
  for (const at of [0.5, 1, 1.5]) {
    const pose = rig.poseAt(paintMoment(at)), doorHinge = new Vector3(20, -40, -1).applyMatrix4(pose.get('door')!);
    // The house's front at its print px (50, 90).
    assert.ok(doorHinge.distanceTo(new Vector3(50, -90, 1).applyMatrix4(pose.get('house')!)) < 1e-9);
  }
  assert.throws(() => paintedThreePopUpRig({ ...POP_UP, cards: [{ ...POP_UP.cards[0], on: 'nowhere' }] }), /nowhere, which is no card/);
});
