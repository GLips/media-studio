import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintRigCelLayer } from './paint-rig-cel-layer.ts';
import { paintRigCutParts, type PaintRigCutLayer, type PaintRigTexelBox } from './paint-rig-cuts.ts';
import { paintRigBandStretch, paintRigSkinGroups, paintRigSkinMesh, paintRigSkinTriangles } from './paint-rig-skin.ts';

/** A limb 24 px wide and 84 tall: `upper` owns rows 0..42, `lower` (skin, `blend` px) the rest, its pivot at (12, 42). */
function limb(blend: number): PaintRigCutLayer {
  const box = { x0: 0, y0: 0, w: 24, h: 84 }, owner = new Int16Array(box.w * box.h), matte = new Float32Array(box.w * box.h).fill(1);
  for (let t = 0; t < owner.length; t++) owner[t] = Math.floor(t / box.w) < 42 ? 0 : 1;
  const parts = paintRigCutParts([{ id: 'upper', parent: null, z: 0 }, { id: 'lower', parent: 'upper', z: 0, joint: 'skin', blend, pivot: { x: 12, y: 42 } }]);
  return { id: 'side.limb', box, parts, owner, matte, overlaps: new Map() };
}
/** An opaque cel over `box`. */
const cel = (box: PaintRigTexelBox) => ({ ...box, rgba: new Float32Array(box.w * box.h * 4).fill(1) });
/** Rotation by `degrees` about `pivot`. */
const turn = (degrees: number, pivot: StampPoint) => {
  const c = Math.cos((degrees * Math.PI) / 180), s = Math.sin((degrees * Math.PI) / 180);
  return ({ x, y }: StampPoint) => ({ x: pivot.x + c * (x - pivot.x) - s * (y - pivot.y), y: pivot.y + s * (x - pivot.x) + c * (y - pivot.y) });
};

/** `limb(blend)` with its lower part turned `degrees` about the pivot: its mesh, posed triangles and the lower's map. */
function bent(blend: number, degrees: number) {
  const layer = limb(blend), [group] = paintRigSkinGroups(layer), mesh = paintRigSkinMesh(layer, group), lower = turn(degrees, { x: 12, y: 42 });
  const triangles = paintRigSkinTriangles(mesh, (k) => (k === 1 ? lower : (p) => p));
  return { mesh, triangles, lower, stretch: paintRigBandStretch(triangles, mesh.bands.get(1)!) };
}

test('a bend curves the band round without folding it or pinching the limb, each part past it going exactly by its map', () => {
  const still = bent(24, 0).stretch;
  assert.ok(Math.abs(still.least - 1) < 1e-9 && Math.abs(still.most - 1) < 1e-9);
  // A right angle about a pivot mid-limb brings the band's pinned inner corners within √2·(blend/2 − 12) px of each
  // other, so a band much narrower than the limb creases its inside; one of 40 px bends cleanly.
  const { triangles, lower, stretch } = bent(40, 90);
  assert.equal(stretch.flips, 0);
  assert.ok(stretch.least > 0.1 && stretch.most < 1.4, JSON.stringify(stretch));
  const posedAt = (x: number, y: number) => {
    for (let v = 0; v < triangles.length; v += 4) if (triangles[v + 2] === x && triangles[v + 3] === y) return { x: triangles[v], y: triangles[v + 1] };
    throw new Error(`no vertex at ${x}, ${y}`);
  };
  // Across the middle of the band the limb keeps most of its 24 px width: the inside of the bend isn't squeezed shut.
  const width = Math.hypot(posedAt(0, 42).x - posedAt(24, 42).x, posedAt(0, 42).y - posedAt(24, 42).y);
  assert.ok(width > 18 && width < 30, `width ${width}`);
  const far = lower({ x: 24, y: 84 }), end = posedAt(24, 84);
  assert.ok(Math.hypot(end.x - far.x, end.y - far.y) < 1e-9);
});

test('a blend under a cell still bends the seam\'s own triangles, and measures them', () => {
  // A band of one cell squeezes hard at 45°, but it gives rather than folds, and the measure sees it.
  const { stretch } = bent(2, 45);
  assert.equal(stretch.flips, 0);
  assert.ok(stretch.least > 0 && stretch.most < 2, JSON.stringify(stretch));
});

test('a part\'s paint away from its seam goes rigidly by its own map, wherever its pivot lies', () => {
  // The pivot well inside the lower part, as a head's sits with its throat and beak painted either side of it.
  const layer = limb(24), parts = paintRigCutParts([{ id: 'upper', parent: null, z: 0 }, { id: 'lower', parent: 'upper', z: 0, joint: 'skin', blend: 24, pivot: { x: 12, y: 66 } }]);
  const [group] = paintRigSkinGroups({ ...layer, parts }), mesh = paintRigSkinMesh({ ...layer, parts }, group), lower = turn(-40, { x: 12, y: 66 });
  const triangles = paintRigSkinTriangles(mesh, (k) => (k === 1 ? lower : (p) => p));
  for (let v = 0; v < triangles.length; v += 4) {
    if (triangles[v + 3] < 42 + 12) continue;
    const want = lower({ x: triangles[v + 2], y: triangles[v + 3] });
    assert.ok(Math.hypot(triangles[v] - want.x, triangles[v + 1] - want.y) < 1e-4);
  }
});

test('a parent painted wide past its joint line keeps its paint far from the child\'s, as cels laid as one layer are', () => {
  // A body 120 px wide, a neck 24 px wide rising from its middle; the body's cel runs past the neck's joint line.
  const body = { x0: 0, y0: 40, w: 120, h: 40 }, neck = { x0: 48, y0: 0, w: 24, h: 60 };
  const { cuts } = paintRigCelLayer('cels.body', [
    { declaration: { id: 'body', parent: null, z: 1 }, picture: cel(body) },
    { declaration: { id: 'neck', parent: 'body', z: 0, joint: 'skin', blend: 20, pivot: { x: 60, y: 50 } }, picture: cel(neck) },
  ]);
  const [group] = paintRigSkinGroups(cuts), mesh = paintRigSkinMesh(cuts, group), neckTurn = turn(-90, { x: 60, y: 50 });
  const triangles = paintRigSkinTriangles(mesh, (k) => (k === 1 ? neckTurn : (p) => p));
  let farthest = 0;
  for (let v = 0; v < triangles.length; v += 4) {
    const rest = { x: triangles[v + 2], y: triangles[v + 3] };
    if (rest.y >= 40 && Math.abs(rest.x - 60) >= 12 + 30) farthest = Math.max(farthest, Math.hypot(triangles[v] - rest.x, triangles[v + 1] - rest.y));
  }
  assert.equal(farthest, 0);
});
