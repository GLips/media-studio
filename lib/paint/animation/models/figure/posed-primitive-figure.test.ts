import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampPolygonDistance, type StampRegion } from '#lib/paint/painting/models/stamp-region.ts';
import { posedFigureShapes, posedPrimitiveFigure, type PaintFigureView } from './posed-primitive-figure.ts';

// A big ball in front of a small one set behind it and off to the right, and a pebble wholly hidden behind the ball.
const balls = posedPrimitiveFigure({
  joints: { root: { at: [0, 0, 0] }, arm: { parent: 'root', at: [0, 0, 0] } },
  parts: {
    back: { primitives: [{ kind: 'ellipsoid', joint: 'arm', at: [1.2, 0, -2], radii: [0.8, 0.8, 0.8] }] },
    pebble: { primitives: [{ kind: 'ellipsoid', joint: 'root', at: [0, 0, -3], radii: [0.3, 0.3, 0.3] }] },
    front: { primitives: [{ kind: 'ellipsoid', joint: 'root', radii: [1, 1, 1] }], pivot: { joint: 'root', at: [0, 0, 0] } },
  },
  anchors: { top: { joint: 'root', at: [0, 1, 0], part: 'front' } },
});
const view: PaintFigureView = { centre: { x: 200, y: 200 }, scale: 100 };
const points = (region: StampRegion | undefined) => (region?.kind === 'polygon' ? region.points : []);

test('a part behind another is clipped by it, and a part wholly hidden has no region', () => {
  const shapes = posedFigureShapes(balls, {}, view);
  const back = points(shapes.parts.back.region);
  assert.ok(back.length > 0);
  // The front ball's disc is radius 100 about (200, 200): nothing of the back ball shows inside it.
  for (const p of back) assert.ok(Math.hypot(p.x - 200, p.y - 200) > 99, `(${p.x}, ${p.y}) shows through the front ball`);
  assert.ok(back.some((p) => p.x > 270), 'the back ball still shows past the front one');
  assert.equal(shapes.parts.pebble.region, undefined);
  assert.equal(shapes.parts.pebble.pieces.length, 0);
  // Turned round to look from behind, the back ball is the nearer and cuts into the front one instead.
  const behind = posedFigureShapes(balls, {}, { ...view, yaw: 180 });
  const centre = { x: 200 - 120, y: 200 };
  assert.ok(stampPolygonDistance(points(behind.parts.back.region), centre.x, centre.y) > 0, 'seen from behind, the back ball is whole');
});

test('the same figure, pose and view give a byte-identical value, whatever was evaluated between', () => {
  const pose = { turns: { arm: { y: 30, z: 10 } }, scale: { front: 1.3 } };
  const first = JSON.stringify(posedFigureShapes(balls, pose, { ...view, pitch: 20, perspective: { distance: 8 } }));
  posedFigureShapes(balls, {}, { ...view, yaw: 70 });
  assert.equal(JSON.stringify(posedFigureShapes(balls, pose, { ...view, pitch: 20, perspective: { distance: 8 } })), first);
});

test('part, joint and anchor names are checked at compile time', () => {
  const shapes = posedFigureShapes(balls, { scale: { front: 1.5 } }, view);
  assert.ok(shapes.anchors.top.y < 200 - 140, 'an anchor on a part grows with it');
  // @ts-expect-error a misspelt part name doesn't compile
  assert.equal(shapes.parts.frnot, undefined);
  // @ts-expect-error nor does a misspelt anchor
  assert.equal(shapes.anchors.tpo, undefined);
  // @ts-expect-error nor a pose turning a joint the figure hasn't got
  posedFigureShapes(balls, { turns: { elbow: { z: 10 } } }, view);
  // @ts-expect-error nor a declaration whose part hangs on an undeclared joint
  posedPrimitiveFigure({ joints: { root: { at: [0, 0, 0] } }, parts: { ball: { primitives: [{ kind: 'ellipsoid', joint: 'rot', radii: [1, 1, 1] }] } }, anchors: {} });
});
