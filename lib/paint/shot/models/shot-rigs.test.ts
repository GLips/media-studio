import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Layer, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { paintingPoseMap } from '#lib/paint/document/models/painting-pose.ts';
import type { PaintRigPicture } from '#lib/paint/rig/models/paint-rig-pieces.ts';
import { paintRigPosedPoint } from '#lib/paint/rig/models/paint-rig-pose.ts';
import type { RigPart } from './shot-props.ts';
import { compileShotRig, shotRigCelPoses, shotRigFound, shotRigPosed, shotRigSkin } from './shot-rigs.ts';

const layer = (key: string): Layer => ({
  key, washes: [{
    key: `${key}-wash`,
    applications: [{
      kind: 'stroke', subpaths: [[{ x: 40, y: 100 }, { x: 200, y: 120 }]], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 20,
      seed: key, charge: { kind: 'paint', mix: { parts: [{ pigment: '#3a4a6b', amount: 1 }], strength: 0.6 } },
    }],
  }],
});
const heron = painting({
  default: function heron(): PaintingDocument {
    return { widthPx: 320, heightPx: 240, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', layers: [{ key: 'heron', children: [layer('body'), layer('neck')] }] };
  },
});

/** A cel `w` × `h` at (x0, y0), its paint opaque, or clear with `alpha` 0. */
const cel = (x0: number, y0: number, w: number, h: number, alpha = 1): PaintRigPicture => ({ x0, y0, w, h, rgba: new Float32Array(w * h * 4).fill(alpha) });
const rigOf = (bodyZ: number) => {
  const parts: readonly RigPart[] = [
    { id: 'body', z: bodyZ, parent: null, cels: ['body'] },
    { id: 'neck', z: 1, parent: 'body', joint: 'skin', pivot: { x: 60, y: 100 }, blend: 12, cels: ['neck'] },
  ];
  return compileShotRig('front/heron', 'front', heron, { parts, pose: {} }).rig!;
};
const skinRefusal = (bodyZ: number, [body, neck]: readonly PaintRigPicture[]): string => {
  try {
    shotRigSkin(rigOf(bodyZ), [{ cel: 'body', key: 'body', picture: body }, { cel: 'neck', key: 'neck', picture: neck }]);
  } catch (error) {
    return (error as Error).message;
  }
  return 'skinned';
};

test("a rig's cels that leave a skin joint no paint of its own to bend along are refused at the rig's path, before skinning", () => {
  assert.equal(skinRefusal(0, [cel(0, 0, 0, 0), cel(0, 0, 0, 0)]), [
    "painting shot's rig front/heron has a problem:",
    '  front/heron.parts: lays no paint on the document (0,0 → 320,240): its cels body, neck lie off it, or are clipped or reserved away',
  ].join('\n'));
  assert.match(skinRefusal(0, [cel(40, 80, 40, 40), cel(60, 60, 8, 8, 0)]), /front\/heron\.parts\.neck: its cel neck lays no paint on the document \(0,0 → 320,240\), and a skin joint/);
  // Under the body, or over it too faint to give any texel most of its colour: either way the neck owns nothing.
  const outweighed = /front\/heron\.parts\.neck: its cel neck gives none of the rig's texels most of their colour/;
  assert.match(skinRefusal(2, [cel(40, 80, 40, 40), cel(50, 90, 8, 8)]), outweighed);
  assert.match(skinRefusal(0, [cel(40, 80, 40, 40), cel(50, 90, 8, 8, 0.4)]), outweighed);
  assert.equal(skinRefusal(0, [cel(40, 80, 40, 40), cel(50, 90, 8, 8)]), 'skinned');
});

test("a posed point is where the shot draws its part's paint, skinned, wherever the part's paint moves wholly with it", () => {
  const rig = rigOf(0), groupPivot = { x: 60, y: 120 }, pose = { body: { x: 5, y: -3, rotation: 0.15 }, neck: { rotation: -0.6 } };
  // A body 80 px wide, and a neck rising 60 px from its middle, skinned at (60, 100) over 12 px.
  const found = shotRigFound(rig, groupPivot, [{ cel: 'body', key: 'body', picture: cel(20, 96, 80, 44) }, { cel: 'neck', key: 'neck', picture: cel(54, 40, 12, 62) }]);
  const drawn = shotRigCelPoses(rig, shotRigPosed(rig, pose, groupPivot, found.axes, null), found.skin!);
  for (const [part, point] of [['neck', { x: 60, y: 50 }], ['body', { x: 30, y: 130 }]] as const) {
    const at = paintingPoseMap(drawn.get(part)!)(point), posed = paintRigPosedPoint({ parts: rig.parts, pivot: groupPivot }, pose, part, point);
    // The shot keys a move to a thousandth of a px and a millionth of a radian.
    assert.ok(Math.hypot(at.x - posed.x, at.y - posed.y) < 2e-3, `${part} at (${point.x}, ${point.y})`);
  }
});
