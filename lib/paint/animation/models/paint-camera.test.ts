import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampGroupSceneFromLayer } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { StampGroupFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintCameraFrameStateAt, paintCameraPlay, paintPlaneSimilarity, paintStageCentre, type PaintCameraMoveKey, type PaintCameraPlay, type PaintCameraPose } from './paint-camera.ts';
import { buildPaintCamera } from './paint-camera-build.ts';
import { paintCameraPerspectiveAt, paintCameraWorld, paintPlaneWorldPoint } from './paint-camera-world.ts';
import { paintMotionPlay, type PaintMotion, type PaintMotionNode } from './paint-motion-compile.ts';
import { paintMotionFrameAt } from './paint-motion-frame.ts';
import { buildPaintMotion, type PaintMotionBuild } from './paint-motion.ts';
import { paintSimilarityApply } from './paint-similarity.ts';

const brush: StampBrush = {
  name: 'Round', blend: 'normal', accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.25, stepping: 'spread', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
};

/** A painting of one stroke per group, each across `box` corner to corner. */
const paintingOf = (groups: readonly { id: string; box: StampBox }[]) => compileStampPaintRecipe(stampPaintRecipe((paint) => {
  for (const { id, box } of groups) {
    const stroke = { brush, material: { kind: 'color', color: '#203040' }, diameter: 10, path: [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y1 }] } as const;
    paint.group(id, { composite: 'opaque' }, (group) => group.pass('p', {}, (pass) => pass.stroke('s', stroke)));
  }
}));
const stage = stampStage({ width: 800, height: 600 }, 100);
const across = { x0: 0, y0: 0, x1: 800, y1: 600 };

const built = (build: PaintMotionBuild): PaintMotion => {
  if (!build.ok) assert.fail(build.problems.join('\n'));
  return build.motion;
};
const close = (a: StampPoint, b: StampPoint, what: string, within = 1e-6) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < within, `${what}: (${a.x}, ${a.y}) is not (${b.x}, ${b.y})`);
const laidAt = (state: StampGroupFrameState | undefined, rest: StampPoint) => (state?.lay ? stampGroupSceneFromLayer(state.lay.placement, rest, state.lay.pivot) : rest);
const move = (keys: readonly PaintCameraMoveKey[], clock: PaintCameraPlay['clock'] = { at: 0 }, origin = 'move') =>
  paintCameraPlay({ kind: 'move', keys }, { clock, origin });

test('a pan parallaxes planes by depth, a dolly grows the near more, and a focus blurs each plane by its distance', () => {
  const planes = [['far', 2], ['mid', 1], ['near', 0.5]] as const;
  const motion = built(buildPaintMotion(paintingOf(planes.map(([id]) => ({ id, box: across }))), {
    nodes: planes.map(([id, plane]) => ({ id, anchor: { plane }, ...(id === 'near' && { glow: { amount: 0.5, radius: 10, threshold: 0.6 } }) })), plays: [],
    camera: {
      stage,
      plays: [
        move([{ at: 0 }, { at: 1, pan: { x: 100, y: 0 } }, { at: 2, dolly: 0.25 }]),
        paintCameraPlay({ kind: 'focus', keys: [{ at: 0, focus: 1, aperture: 4 }] }, { clock: { at: 0 }, origin: 'focus' }),
      ],
    },
  }));
  const at1 = paintMotionFrameAt(motion, 1), point = { x: 300, y: 200 };
  // A pan of 100 px at depth 1 moves a plane at depth 2 by 50 px and one at 0.5 by 200: parallax.
  for (const [id, shift] of [['far', -50], ['mid', -100], ['near', -200]] as const) close(laidAt(at1.get(id), point), { x: 300 + shift, y: 200 }, `${id} panned`, 1e-3);
  // Dollied 0.25 toward the planes, each grows d/(d − 0.25) about the frame's centre.
  const centre = paintStageCentre(stage), at2 = paintMotionFrameAt(motion, 2);
  for (const [id, depth] of planes) close(laidAt(at2.get(id), { x: centre.x + 100, y: centre.y }), { x: centre.x + 100 * depth / (depth - 0.25), y: centre.y }, `${id} dollied`, 1e-3);
  // Focused at depth 1 with aperture 4: depth 2 blurs 4·|1 − 1/2|, depth 0.5 4·|1 − 2|; dollied, distances shrink alike.
  assert.deepEqual(planes.map(([id]) => at1.get(id)?.blur), [2, undefined, 4]);
  assert.equal(at2.get('near')?.glow?.radius, 20, 'a glow grows with its plane, its radius in rest px');
  assert.deepEqual(planes.map(([id]) => at2.get(id)?.blur), [Math.round(4000 * (1 - 0.75 / 1.75)) / 1000, undefined, 8]);
});

test('the camera composes after a swaying tuft\'s own warp and placement, and laying flat motion after the fact is the same step', () => {
  const tuft = { id: 'tuft', pivot: { x: 400, y: 500 }, clock: { hold: 2 } } satisfies PaintMotionNode;
  const plays = [
    paintMotionPlay(tuft, { kind: 'sway', root: { x: 400, y: 500 }, direction: -Math.PI / 2, length: 100, amount: 20, period: 1 }, { clock: { at: 0 }, origin: 'sway' }),
    paintMotionPlay(tuft, { kind: 'place', keys: [{ at: 0, x: 0, y: 0 }, { at: 1, x: 40, y: 0, rotation: 0.1 }] }, { clock: { at: 0 }, origin: 'drift' }),
  ];
  const painting = paintingOf([{ id: 'tuft', box: { x0: 380, y0: 400, x1: 420, y1: 500 } }]);
  const camera = { stage, plays: [move([{ at: 0 }, { at: 1, pan: { x: 60, y: -20 }, zoom: 1.2, roll: 0.05 }])] };
  const flat = built(buildPaintMotion(painting, { nodes: [tuft], plays }));
  const planed = built(buildPaintMotion(painting, { nodes: [{ ...tuft, anchor: { plane: 1.5 } }], plays, camera }));
  const t = 0.75, bare = paintMotionFrameAt(flat, t).get('tuft')!, viewed = paintMotionFrameAt(planed, t).get('tuft')!;
  assert.equal(viewed.warp?.key, bare.warp?.key, 'its sway stays a warp, untouched by the camera');
  const pose: PaintCameraPose = { pan: { x: 45, y: -15 }, dolly: 0, zoom: 1.15, roll: 0.0375 };
  const view = paintPlaneSimilarity(pose, 1.5, paintStageCentre(stage)), rest = { x: 410, y: 450 };
  close(laidAt(viewed, rest), paintSimilarityApply(view, laidAt(bare, rest)), 'its lay is the camera after its placement', 1e-6);
  // The same camera built alone over the flat motion's frame state gives the same state: one camera step.
  const alone = buildPaintCamera(painting, { stage, anchors: new Map([['tuft', { plane: 1.5 }]]), plays: camera.plays });
  assert.ok(alone.ok);
  const after = paintCameraFrameStateAt(alone.camera, paintMotionFrameAt(flat, t), t).get('tuft');
  assert.deepEqual([after?.lay, after?.warp?.key], [viewed.lay, viewed.warp?.key]);
});

test('the camera runs on its own clock, on ones, while a held plane\'s drawing holds; a held camera steps on the grid', () => {
  const sway = { kind: 'sway', root: { x: 400, y: 500 }, direction: -Math.PI / 2, length: 100, amount: 20, period: 1 } as const;
  const tuft = { id: 'tuft', clock: { hold: 2 }, anchor: { plane: 1 } } satisfies PaintMotionNode;
  const motionWith = (clock: PaintCameraPlay['clock']) => built(buildPaintMotion(paintingOf([{ id: 'tuft', box: { x0: 380, y0: 400, x1: 420, y1: 500 } }]), {
    nodes: [tuft], plays: [paintMotionPlay(tuft, sway, { clock: { at: 0 }, origin: 'sway' })],
    camera: { stage, plays: [move([{ at: 0 }, { at: 2, pan: { x: 200, y: 0 } }], clock)] },
  }));
  const onOnes = motionWith({ at: 0 }), held = motionWith({ at: 0, hold: 2 });
  // At 30 fps, 0.8 s and 0.81 s fall in one hold step on twos (animation frames 19 and 19, held to 18).
  const [a, b] = [0.8, 0.81].map((t) => paintMotionFrameAt(onOnes, t).get('tuft')!);
  assert.equal(a.warp?.key, b.warp?.key, 'the sway holds its drawing');
  assert.notDeepEqual(a.lay, b.lay, 'the camera moves on');
  assert.deepEqual(paintMotionFrameAt(held, 0.8).get('tuft')?.lay, paintMotionFrameAt(held, 0.81).get('tuft')?.lay, 'held on twos, the camera holds too');
  // Any order: a fresh motion read backwards gives what forwards did.
  const times = Array.from({ length: 30 }, (_, i) => i / 15), forwards = times.map((t) => JSON.stringify(paintMotionFrameAt(onOnes, t).get('tuft')?.lay));
  const fresh = motionWith({ at: 0 });
  times.toReversed().forEach((t, i) => assert.equal(JSON.stringify(paintMotionFrameAt(fresh, t).get('tuft')?.lay), forwards[times.length - 1 - i]));
});

test('a point on a plane, rendered through the perspective camera three.js is given, lands where the plane step lays it', () => {
  const world = paintCameraWorld(stage, { fov: 35 }), centre = paintStageCentre(stage);
  const poses: PaintCameraPose[] = [
    { pan: { x: 0, y: 0 }, dolly: 0, zoom: 1, roll: 0 },
    { pan: { x: 130, y: -45 }, dolly: 0.3, zoom: 1.4, roll: 0.2 },
    { pan: { x: -60, y: 80 }, dolly: -0.5, zoom: 0.8, roll: -0.7 },
  ];
  for (const pose of poses) {
    const camera = paintCameraPerspectiveAt(world, pose), focal = 1 / Math.tan((camera.fov * Math.PI) / 360);
    const targetHeight = stage.height;
    for (const depth of [0.6, 1, 3.5]) {
      for (const point of [{ x: 120, y: 90 }, { x: 790, y: 560 }, { x: -80, y: 640 }]) {
        // three: the view is the camera's inverse (a turn about z by rotationZ after its position), then its projection.
        const p = paintPlaneWorldPoint(world, point, depth), dx = p.x - camera.position.x, dy = p.y - camera.position.y, dz = p.z - camera.position.z;
        const c = Math.cos(-camera.rotationZ), s = Math.sin(-camera.rotationZ), vx = c * dx - s * dy, vy = s * dx + c * dy;
        const ndc = { x: (focal / camera.aspect) * (vx / -dz), y: focal * (vy / -dz) };
        const onTarget = { x: ((ndc.x + 1) / 2) * targetHeight * camera.aspect, y: ((1 - ndc.y) / 2) * targetHeight };
        const onStage = { x: onTarget.x - stage.margin, y: onTarget.y - stage.margin };
        close(onStage, paintSimilarityApply(paintPlaneSimilarity(pose, depth, centre), point), `depth ${depth} under ${JSON.stringify(pose)}`, 1e-9);
      }
    }
  }
});

test('the build names a plane behind the camera, an anchor on a child, a lens that can\'t zoom, a backdrop shown past the stage, and two camera writers', () => {
  const painting = paintingOf([{ id: 'sky', box: { x0: -100, y0: -100, x1: 900, y1: 700 } }, { id: 'frog', box: across }, { id: 'ink', box: across }]);
  const nodes: PaintMotionNode[] = [
    { id: 'sky', anchor: { plane: 4 }, backdrop: true }, { id: 'frog', anchor: { plane: 1 } }, { id: 'ink', parent: 'frog', anchor: { plane: 1 } },
  ];
  const problems = (camera: readonly PaintCameraPlay[]) => {
    const build = buildPaintMotion(painting, { nodes, plays: [], camera: { stage, plays: camera } });
    return build.ok ? [] : build.problems;
  };
  assert.deepEqual(problems([move([{ at: 0 }, { at: 2, dolly: 1, zoom: 0 }], { at: 0 }, 'push'), move([{ at: 1, pan: { x: 10, y: 0 } }], { at: 1 }, 'drift')]), [
    'ink sets its anchor, but it hangs from frog, whose tree\'s anchor it takes; anchor its root',
    'push: key 1 zooms to 0; a zoom must be above 0 (1 at rest)',
  ]);
  const flat = buildPaintMotion(painting, { nodes: nodes.slice(0, 2), plays: [] });
  assert.deepEqual(flat.ok ? [] : flat.problems, ['sky, frog are on a plane or a backdrop, but the motion has no camera; give it one with the stage']);
  const camera = (plays: readonly PaintCameraPlay[]) => {
    const build = buildPaintCamera(painting, { stage, anchors: new Map([['sky', { plane: 4 }], ['frog', { plane: 1 }], ['toad', { plane: 2 }]]), backdrops: ['sky'], plays });
    return build.ok ? [] : build.problems;
  };
  assert.deepEqual(camera([move([{ at: 0 }, { at: 2, dolly: 1 }], { at: 0 }, 'push'), move([{ at: 1, pan: { x: 10, y: 0 } }], { at: 1 }, 'drift')]), [
    'toad is anchored, but isn\'t a group of the painting',
    'drift writes camera on the camera\'s move from 1s while push still does (until 2s)',
    'push dollies the camera 1 at key 1, at or past frog\'s plane at depth 1; a plane stays in front of the camera',
  ]);
  // The sky at depth 4 moves a quarter of a pan at depth 1: 900 px brings in 225, past its 100 px margin and its paint.
  const panned = buildPaintCamera(painting, { stage, anchors: new Map([['sky', { plane: 4 }]]), backdrops: ['sky'], plays: [move([{ at: 0 }, { at: 1, pan: { x: 900, y: 0 } }], { at: 0 }, 'whip')] });
  assert.match(panned.ok ? '' : panned.problems.join('\n'), /^sky must fill the frame, but at 0\.\d+s the frame's corner shows \(9\d\d, 0\) of its plane, past the stage's 100 px margin$/);
});
