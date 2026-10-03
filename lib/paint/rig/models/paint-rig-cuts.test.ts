import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePaintRigCutLayer, type PaintRigDrawnCut } from './paint-rig-cuts.ts';
import { paintRigPaintedCoverage } from './paint-rig-painted-coverage.ts';

const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

test('regions overlapping across a skin joint split on its line, a hinge overlaps its parent, and the parts tile the layer', () => {
  // Body 0..40, thigh hinged at y 40 overlapping it by a 6 px disc; shin drawn from y 60, overlapping the thigh to 80, skinned at y 70.
  const cuts: PaintRigDrawnCut[] = [
    { part: { id: 'body', parent: null, z: 0 }, polygon: rect(10, 0, 30, 40) },
    { part: { id: 'thigh', parent: 'body', z: 1, pivot: { x: 20, y: 40 }, joint: 'hinge' }, polygon: rect(10, 40, 30, 80), overlap: { radius: 6 } },
    { part: { id: 'shin', parent: 'thigh', z: 0, pivot: { x: 20, y: 70 }, joint: 'skin', blend: 12 }, polygon: rect(10, 60, 30, 110) },
  ];
  const layer = resolvePaintRigCutLayer('side.figure', cuts, { w: 100, h: 200 }, new Float32Array(100 * 200).fill(1)), { box, owner, matte } = layer;
  const ownerAt = (x: number, y: number) => layer.parts[owner[(y - box.y0) * box.w + x - box.x0]]?.id;
  // The shin was cut later, yet above its joint line the thigh keeps what both regions claim.
  assert.deepEqual([ownerAt(20, 65), ownerAt(20, 69), ownerAt(20, 70), ownerAt(20, 100)], ['thigh', 'thigh', 'shin', 'shin']);
  assert.ok(matte.every((cover, t) => (cover > 0) === (owner[t] >= 0)));
  const overlap = layer.overlaps.get(1)!;
  const overlapRows = new Set([...overlap.keys()].filter((t) => overlap[t]).map((t) => box.y0 + Math.floor(t / box.w)));
  assert.deepEqual([Math.min(...overlapRows), Math.max(...overlapRows)], [34, 39]);
});

test('the paint is the silhouette: a region over blank paper owns nothing there, a faint glaze is covered whole, a pale texel at a dark edge partly', () => {
  // A 30 × 10 sheet of paper (240 grey); a faint glaze 17 below it at x 2..9, dark paint at x 15..24 with a pale texel on its left edge.
  const w = 30, h = 10, paper = new Uint8Array(w * h * 4).fill(240), sheet = paper.slice();
  const paint = (x: number, y: number, value: number) => sheet.set([value, value, value], 4 * (y * w + x));
  for (let y = 2; y < 8; y++) for (let x = 2; x < 10; x++) paint(x, y, 240 - 17);
  for (let y = 2; y < 8; y++) for (let x = 15; x < 25; x++) paint(x, y, 90);
  paint(15, 4, 220);
  const painted = paintRigPaintedCoverage(sheet, paper, w, h), at = (x: number, y: number) => painted[y * w + x];
  assert.deepEqual([at(2, 2), at(5, 5), at(9, 7), at(20, 5)], [1, 1, 1, 1]);
  assert.ok(at(15, 4) > 0 && at(15, 4) < 0.5);
  const layer = resolvePaintRigCutLayer('side.figure', [{ part: { id: 'body', parent: null, z: 0 }, polygon: rect(0, 0, 30, 10) }], { w, h }, painted);
  const unpainted = [...layer.region.keys()].filter((t) => !painted[t]);
  assert.ok(unpainted.length > 0 && unpainted.every((t) => layer.region[t] === 1 && layer.matte[t] === 0 && layer.owner[t] === -1));
});
