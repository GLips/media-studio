import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintedThreeCardField, type PaintedThreeCard } from './painted-three-card.ts';

/** A 100 × 200 card, its bottom edge its hinge, cut from SVG path data. */
const CARD: PaintedThreeCard = { print: 'tag', widthPx: 100, heightPx: 200, outline: { shape: 'M 0 0 L 100 0 L 100 200 L 0 200 Z', hinge: { from: { x: 0, y: 200 }, to: { x: 100, y: 200 } } } };

/** The field's texel holding print px (x, y): cut distance, hinge distance, outward normal. */
function fieldAt(x: number, y: number) {
  const { columns, cell, values } = paintedThreeCardField(CARD), at = (Math.floor(y / cell) * columns + Math.floor(x / cell)) * 4;
  return { cut: values[at], hinge: values[at + 1], normal: { x: values[at + 2], y: values[at + 3] } };
}

test('a card is cut along its sides and not its hinge, each cut facing out', () => {
  const nearHinge = fieldAt(50, 199.8), nearSide = fieldAt(99.8, 100);
  // A point by the hinge is as far from a cut as the sides are, and touches the hinge.
  assert.ok(nearHinge.cut > 49 && nearHinge.hinge < 1);
  assert.ok(nearSide.cut < 1 && nearSide.hinge > 99);
  const outward = (x: number, y: number) => ({ x: fieldAt(x, y).normal.x + 0, y: fieldAt(x, y).normal.y + 0 });
  assert.deepEqual(outward(99.8, 100), { x: 1, y: 0 });
  assert.deepEqual(outward(50, 0.2), { x: 0, y: -1 });
});
