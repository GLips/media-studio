import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintRigCutParts, type PaintRigCutLayer } from './paint-rig-cuts.ts';
import { paintRigBandStretch, paintRigSkinGroups, paintRigSkinMesh, paintRigSkinTriangles } from './paint-rig-skin.ts';

/** A limb 24 px wide and 84 tall: `upper` owns rows 0..42, `lower` (skin, `blend` px) the rest, its pivot at (12, 42). */
function limb(blend: number): PaintRigCutLayer {
  const box = { x0: 0, y0: 0, w: 24, h: 84 }, owner = new Int16Array(box.w * box.h), matte = new Float32Array(box.w * box.h).fill(1);
  for (let t = 0; t < owner.length; t++) owner[t] = Math.floor(t / box.w) < 42 ? 0 : 1;
  const parts = paintRigCutParts([{ id: 'upper', parent: null, z: 0 }, { id: 'lower', parent: 'upper', z: 0, joint: 'skin', blend, pivot: { x: 12, y: 42 } }]);
  return { id: 'side.limb', box, parts, owner, matte, overlaps: new Map() };
}
/** Rotation by `degrees` about `pivot`. */
const turn = (degrees: number, pivot: StampPoint) => {
  const c = Math.cos((degrees * Math.PI) / 180), s = Math.sin((degrees * Math.PI) / 180);
  return ({ x, y }: StampPoint) => ({ x: pivot.x + c * (x - pivot.x) - s * (y - pivot.y), y: pivot.y + s * (x - pivot.x) + c * (y - pivot.y) });
};

test('a skin joint\'s share in its child runs from 0 to 1 across its blend, half on the joint', () => {
  const layer = limb(24), [group] = paintRigSkinGroups(layer), mesh = paintRigSkinMesh(layer, group), stride = mesh.columns + 1;
  const down = [18, 24, 30, 36, 48, 54, 60, 66].map((y) => mesh.shares[(y / mesh.cell) * stride + 2]);
  assert.deepEqual([down[0], down.at(-1)], [0, 1]);
  for (let k = 1; k < down.length; k++) assert.ok(down[k] >= down[k - 1]);
  // Rows 36 and 48 lie 6 px either side of the joint line: their shares mirror each other.
  assert.ok(down[3] > 0 && down[3] < 0.5 && Math.abs(down[3] + down[4] - 1) < 1e-6);
});

test('a bend turns the band through an arc, folding only under a blend of about the angle × the half-width, and the child lands where its map puts it', () => {
  const pivot = { x: 12, y: 42 }, bent = (blend: number, degrees: number, shift = { x: 0, y: 0 }) => {
    const layer = limb(blend), [group] = paintRigSkinGroups(layer), mesh = paintRigSkinMesh(layer, group), lower = turn(degrees, pivot);
    const map = (p: StampPoint) => ({ x: lower(p).x + shift.x, y: lower(p).y + shift.y });
    const triangles = paintRigSkinTriangles(mesh, (k) => (k === 1 ? map : (p) => p));
    return { stretch: paintRigBandStretch(triangles, mesh.bands.get(1)!), triangles, map };
  };
  assert.deepEqual(bent(24, 0).stretch, { least: 1, most: 1, flips: 0 });
  // The angle accrues evenly across the blend: 90° on a limb 12 px either side of its bone folds the inside under
  // ~19 px of blend (π/2 × 12), and not well over it.
  assert.ok(bent(16, 90).stretch.flips > 0);
  const { stretch } = bent(28, 90);
  assert.equal(stretch.flips, 0);
  assert.ok(stretch.least > 0.2 && stretch.most < 2.5);
  // A joint that also moves off its pivot (a stretch from IK) still carries the far end exactly by the child's map.
  const { triangles, map } = bent(24, 45, { x: 5, y: 3 }), end = triangles.length - 4, far = map({ x: triangles[end + 2], y: triangles[end + 3] });
  assert.ok(Math.hypot(triangles[end] - far.x, triangles[end + 1] - far.y) < 1e-4);
});

