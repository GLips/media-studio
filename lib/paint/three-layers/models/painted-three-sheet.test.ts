import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { PAINTED_THREE_SHEET_ROOT, paintedThreeSheetField, paintedThreeSheetFolding, type PaintedThreeSheet } from './painted-three-sheet.ts';

const box = (x0: number, y0: number, x1: number, y1: number): StampPoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** The field's texel holding print px (x, y) of `sheet`'s face `face`: cut distance, stand distance, outward normal. */
function fieldAt(sheet: PaintedThreeSheet, face: string, x: number, y: number) {
  const { x0, y0, columns, cell, values } = paintedThreeSheetField(paintedThreeSheetFolding(sheet).faces.get(face)!), at = (Math.floor((y - y0) / cell) * columns + Math.floor((x - x0) / cell)) * 4;
  return { cut: values[at], stand: values[at + 1], normal: { x: values[at + 2] + 0, y: values[at + 3] + 0 } };
}

/** Where flat print px `p` of `sheet`'s face `face` lies folded at `angle`'s moment, sheet space. */
const folded = (sheet: PaintedThreeSheet, face: string, p: StampPoint, at = 0) => new Vector3(p.x, -p.y, 0).applyMatrix4(paintedThreeSheetFolding(sheet).poseAt(paintMoment(at)).get(face)!);
const near = (a: Vector3, b: Vector3) => a.distanceTo(b) < 1e-9;

/** A box net's wall, folded up square. */
const wall = (id: string, outline: StampPoint[], from: StampPoint, to: StampPoint) => ({ id, outline, hinge: { from, to }, angle: Math.PI / 2 });

/** A 100 × 100 card standing on its foot, a tab 80 wide hinged below it, folded by `angle`. */
const tabbed = (angle: number): PaintedThreeSheet => ({
  print: 'tag', widthPx: 100, heightPx: 120,
  root: { outline: 'M 0 0 L 100 0 L 100 100 L 0 100 Z', hinge: { from: { x: 0, y: 100 }, to: { x: 100, y: 100 } } },
  folds: [{ id: 'tab', outline: box(10, 100, 90, 120), hinge: { from: { x: 10, y: 100 }, to: { x: 90, y: 100 } }, angle }],
});

test('a card is cut along its sides and not where it stands, each cut facing out', () => {
  const card: PaintedThreeSheet = { ...tabbed(0), folds: [] }, nearStand = fieldAt(card, PAINTED_THREE_SHEET_ROOT, 50, 99.8), nearSide = fieldAt(card, PAINTED_THREE_SHEET_ROOT, 99.8, 50);
  assert.ok(nearStand.cut > 49 && nearStand.stand < 1);
  assert.ok(nearSide.cut < 1 && nearSide.stand > 49);
  assert.deepEqual(nearSide.normal, { x: 1, y: 0 });
  assert.deepEqual(fieldAt(card, PAINTED_THREE_SHEET_ROOT, 50, 0.2).normal, { x: 0, y: -1 });
});

test('a tab folds on its hinge with no cut along it, and folds flat back against its card at π', () => {
  // Its root's foot is a stand edge where the tab isn't, a fold where it is: neither is cut.
  assert.ok(fieldAt(tabbed(0), PAINTED_THREE_SHEET_ROOT, 50, 99.8).cut > 39);
  assert.ok(fieldAt(tabbed(0), 'tab', 50, 100.2).cut > 9);
  assert.ok(fieldAt(tabbed(0), 'tab', 10.2, 110).cut < 1);
  // Positive turns it toward the front; at π it lies on the card, mirrored about its hinge.
  assert.ok(near(folded(tabbed(Math.PI / 2), 'tab', { x: 50, y: 120 }), new Vector3(50, -100, 20)));
  assert.ok(folded(tabbed(Math.PI), 'tab', { x: 50, y: 120 }).distanceTo(new Vector3(50, -80, 0)) < 1e-9);
  assert.ok(near(folded(tabbed(Math.PI), 'tab', { x: 30, y: 100 }), new Vector3(30, -100, 0)));
});

test('a tent folds its second face about the ridge, its eaves an apex apart', () => {
  // Two 100 × 60 faces about a ridge at y 60, turned 120° back: a 60° apex, so eave to ridge to eave is equilateral.
  const tent: PaintedThreeSheet = {
    print: 'roof', widthPx: 100, heightPx: 120, root: { outline: box(0, 0, 100, 60) },
    folds: [{ id: 'far', outline: box(0, 60, 100, 120), hinge: { from: { x: 0, y: 60 }, to: { x: 100, y: 60 } }, angle: (-2 * Math.PI) / 3 }],
  };
  const eave = folded(tent, PAINTED_THREE_SHEET_ROOT, { x: 50, y: 0 }), ridge = folded(tent, 'far', { x: 50, y: 60 }), farEave = folded(tent, 'far', { x: 50, y: 120 });
  assert.ok(Math.abs(eave.distanceTo(farEave) - 60) < 1e-9 && Math.abs(ridge.distanceTo(farEave) - 60) < 1e-9);
  assert.ok(farEave.z < 0);
});

test('a box net folds up its walls to meet at the corners, a window cut through one', () => {
  const net: PaintedThreeSheet = {
    print: 'box', widthPx: 300, heightPx: 300, root: { outline: box(100, 100, 200, 200) },
    folds: [
      wall('north', box(100, 0, 200, 100), { x: 100, y: 100 }, { x: 200, y: 100 }),
      wall('east', box(200, 100, 300, 200), { x: 200, y: 100 }, { x: 200, y: 200 }),
      { ...wall('south', box(100, 200, 200, 300), { x: 100, y: 200 }, { x: 200, y: 200 }), holes: [box(130, 230, 170, 270)] },
      wall('west', box(0, 100, 100, 200), { x: 100, y: 100 }, { x: 100, y: 200 }),
    ],
  };
  const corners: [string, StampPoint, string, StampPoint][] = [
    ['north', { x: 100, y: 0 }, 'west', { x: 0, y: 100 }], ['north', { x: 200, y: 0 }, 'east', { x: 300, y: 100 }],
    ['south', { x: 100, y: 300 }, 'west', { x: 0, y: 200 }], ['south', { x: 200, y: 300 }, 'east', { x: 300, y: 200 }],
  ];
  for (const [a, p, b, q] of corners) assert.ok(near(folded(net, a, p), folded(net, b, q)), `${a} meets ${b}`);
  // The floor is folded all round: nothing on it is a cut. The window is, facing into it.
  assert.ok(fieldAt(net, PAINTED_THREE_SHEET_ROOT, 100.2, 150).cut > 1000);
  const inWindow = fieldAt(net, 'south', 150, 250), byWindow = fieldAt(net, 'south', 129.5, 250);
  assert.ok(inWindow.cut < 0 && byWindow.cut > 0 && byWindow.cut < 1);
  assert.deepEqual(byWindow.normal, { x: 1, y: 0 });
  assert.throws(() => paintedThreeSheetFolding({ ...net, folds: [wall('north', box(100, 0, 200, 100), { x: 100, y: 90 }, { x: 200, y: 90 })] }), /lies along none of its outline/);
  assert.throws(() => paintedThreeSheetFolding({ ...net, folds: [{ ...net.folds![0], on: 'roof' }] }), /folds off roof, which is no face/);
});
