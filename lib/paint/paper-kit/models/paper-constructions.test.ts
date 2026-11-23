import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3, type Matrix4 } from 'three';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { paintedThreePopUpRig, PAINTED_THREE_POP_UP_BASE, type PaintedThreePopUpSheet } from '#lib/paint/three-layers/models/painted-three-pop-up.ts';
import { PAINTED_THREE_SHEET_ROOT } from '#lib/paint/three-layers/models/painted-three-sheet.ts';
import { PAPER_BOX_HOUSE_WALLS, PAPER_STAND_UP_TAB, paperBoxHouse, paperBoxHouseNet, paperBoxHouseRoofId, paperBoxHouseTabFace, paperStandUp, paperXTreeSlots } from './paper-constructions.ts';

const BASE = { print: 'base', widthPx: 400, heightPx: 300, root: { outline: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] } };
/** Every sheet's paper 1 px, so where faces meet is known to within it. */
const posed = (sheets: PaintedThreePopUpSheet[], rise: number) => paintedThreePopUpRig({ at: { x: 0, y: 0 }, pitch: 0.9, thicknessPx: 1, base: BASE, sheets }).poseAt(paintMoment(rise));
const ys = (points: readonly { y: number }[]) => points.map(({ y }) => y);
const facing = (matrix: Matrix4) => new Vector3(0, 0, 1).transformDirection(matrix);
/** A print px on a face's middle sheet, in the pop-up's space. */
const landed = (matrix: Matrix4, x: number, y: number) => new Vector3(x, -y, 0).applyMatrix4(matrix);

test('a stand-up rises square to the ground while its tab lies turned over flat behind its foot', () => {
  const card = paperStandUp({
    widthPx: 100, heightPx: 140, outline: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 120 }, { x: 0, y: 120 }], foot: { from: { x: 0, y: 120 }, to: { x: 100, y: 120 } },
    tab: [{ x: 10, y: 120 }, { x: 90, y: 120 }, { x: 90, y: 140 }, { x: 10, y: 140 }], rise: ({ at }) => at,
  })({ id: 'card', print: 'card', at: { x: 200, y: 200 } });
  // Face down once standing; while the card lies flat the tab tucks a sliver short of over, under the card's slab.
  for (const [rise, tuck] of [[0, 0.08], [0.5, 0.04], [1, 0]]) {
    const pose = posed(card, rise), ground = facing(pose.get(PAINTED_THREE_POP_UP_BASE)!.get(PAINTED_THREE_SHEET_ROOT)!);
    assert.ok(Math.abs(facing(pose.get('card')!.get(PAPER_STAND_UP_TAB)!).angleTo(ground.clone().negate()) - tuck) < 1e-9, `the tab ${tuck} short of face down at rise ${rise}`);
  }
  const flat = posed(card, 0), normal = facing(flat.get(PAINTED_THREE_POP_UP_BASE)!.get(PAINTED_THREE_SHEET_ROOT)!);
  assert.ok(landed(flat.get('card')!.get(PAPER_STAND_UP_TAB)!, 50, 140).dot(normal) < landed(flat.get('card')!.get(PAINTED_THREE_SHEET_ROOT)!, 50, 100).dot(normal) - 1);
  const risen = posed(card, 1), ground = facing(risen.get(PAINTED_THREE_POP_UP_BASE)!.get(PAINTED_THREE_SHEET_ROOT)!);
  assert.ok(Math.abs(facing(risen.get('card')!.get(PAINTED_THREE_SHEET_ROOT)!).dot(ground)) < 1e-9);
  // Behind the foot: the tab's far edge lies farther up the ground than the foot does.
  const up = new Vector3(0, 1, 0).transformDirection(risen.get(PAINTED_THREE_POP_UP_BASE)!.get(PAINTED_THREE_SHEET_ROOT)!);
  assert.ok(landed(risen.get('card')!.get(PAPER_STAND_UP_TAB)!, 50, 140).dot(up) > landed(risen.get('card')!.get(PAINTED_THREE_SHEET_ROOT)!, 50, 120).dot(up) + 15);
});

test('an X tree\'s slots run along one centre line and meet halfway up it', () => {
  // A fir: its tip at (60, 0), its foot from 45 to 75 at y 220.
  const slots = paperXTreeSlots({ outline: 'M 60 0 L 120 170 L 75 170 L 75 220 L 45 220 L 45 170 L 0 170 Z', foot: { from: { x: 45, y: 220 }, to: { x: 75, y: 220 } }, heightPx: 220 });
  // Both 13.2 px wide (three default paper thicknesses of 220) about x 60.
  for (const slot of [slots.top, slots.foot]) assert.deepEqual([...new Set(slot.map(({ x }) => Math.round(x * 10) / 10))].toSorted((a, b) => a - b), [53.4, 66.6]);
  assert.equal(Math.max(...ys(slots.top)), 110);
  assert.equal(Math.min(...ys(slots.foot)), 110);
  // Each reaches near its end of the card: the tip's slot within its narrowing, the foot's within a slot's width of the foot.
  assert.ok(Math.min(...ys(slots.top)) < 30 && Math.max(...ys(slots.foot)) > 205);
});

test('a box house\'s walls close round into a box with its tabs flat and its roof on its eaves', () => {
  const house = { widthPx: 120, depthPx: 80, wallPx: 70, tabPx: 14, pitch: 0.6 };
  const { walls } = paperBoxHouseNet(house), pose = posed(paperBoxHouse({ ...house, rise: 1 })({ id: 'house', print: { walls: 'walls', roof: 'roof' }, at: { x: 200, y: 200 } }), 1);
  const faces = pose.get('house')!, ground = facing(pose.get(PAINTED_THREE_POP_UP_BASE)!.get(PAINTED_THREE_SHEET_ROOT)!);
  const wall = (name: string) => faces.get(name === 'front' ? PAINTED_THREE_SHEET_ROOT : name)!;
  // The back's free edge meets the left's free edge, at the foot and at the eaves.
  for (const y of [walls.eavesY, walls.footY]) assert.ok(landed(wall('back'), walls.widthPx, y).distanceTo(landed(wall('left'), 0, y)) < 1.5, `the corner at y ${y}`);
  for (const name of PAPER_BOX_HOUSE_WALLS) {
    assert.ok(Math.abs(facing(wall(name)).dot(ground)) < 1e-9, `${name} stands square`);
    assert.ok(facing(faces.get(paperBoxHouseTabFace(name))!).distanceTo(ground) < 1e-9, `${name}'s tab lies flat, face up`);
  }
  // The roof's back slope comes down onto the back wall's eaves.
  const roof = pose.get(paperBoxHouseRoofId('house'))!, { roof: print } = paperBoxHouseNet(house);
  assert.ok(landed(roof.get('back')!, print.widthPx / 2, 0).distanceTo(landed(wall('back'), walls.widthPx - house.widthPx / 2, walls.eavesY)) < 2);
});
