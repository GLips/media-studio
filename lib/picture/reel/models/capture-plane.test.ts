import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Shot } from '#lib/picture/camera/models/camera.ts';
import { capturePlaneProjection, capturePlaneView, PLANE_REST_POSE } from './capture-plane.ts';

const shot: Shot = { src: 'page.png', w: 1440, h: 3000, scale: 3, rects: {} };
const price = { x: 200, y: 400, w: 520, h: 200 };
const FRAME = { width: 1920, height: 1080 };

test('hangs a page rect on the card where the card shows it, flat or at rest', () => {
  const v = capturePlaneView(shot, price, FRAME, { fit: { w: 1040, h: 800 }, centre: { x: 960, y: 540 } });
  const flat = capturePlaneProjection(v, { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6, `${JSON.stringify(a)} is not ${JSON.stringify(b)}`);
  // Flat on the lens plane, the rect fills the card's box and the card is the view's box.
  near(flat.pageToScreen({ x: price.x, y: price.y }), { x: v.box.x, y: v.box.y });
  near(flat.pageToScreen({ x: price.x + price.w, y: price.y + price.h }), { x: v.box.x + v.box.w, y: v.box.y + v.box.h });
  near(flat.corners[2], { x: v.box.x + v.box.w, y: v.box.y + v.box.h });
  assert.ok(flat.covers({ x: 960, y: 540 }) && !flat.covers({ x: 100, y: 100 }));

  // At rest (ry −8°) the face turns left, its left edge away: shorter on screen than its right.
  const [tl, tr, br, bl] = capturePlaneProjection(v, PLANE_REST_POSE).corners;
  assert.ok(bl.y - tl.y < br.y - tr.y);
});
