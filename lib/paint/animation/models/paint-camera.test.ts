import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampRoundTipStatedProfile } from '#lib/paint/painting/models/stamp-tip-support.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPlane, StampPlaneExtent } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import {
  paintCameraLensAt, paintCameraPlay, paintPlaneSimilarity, paintStageCentre, type PaintCamera, type PaintCameraMoveKey, type PaintCameraPlay, type PaintCameraPose,
} from './paint-camera.ts';
import { buildPaintCamera, buildPaintingCamera, type PaintCameraBuild, type PaintingCameraBuild } from './paint-camera-build.ts';
import { paintMotionPlay, type PaintMotion, type PaintMotionNode } from './paint-motion-compile.ts';
import { buildPaintMotion, type PaintMotionBuild } from './paint-motion.ts';
import { shotCameraProject } from '#lib/picture/shot-camera/models/shot-camera.ts';
import { paintCameraShotAt, paintCameraWorld, paintPlaneWorldPoint } from './paint-camera-world.ts';
import { paintSimilarityApply } from './paint-similarity.ts';

const brush: StampBrush = {
  name: 'Round', blend: 'normal', accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.25, stepping: 'spread', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
  profile: STAMP_BRUSH_UNMEASURED,
};
brush.profile = stampRoundTipStatedProfile(brush);

/** A painting of one stroke per group, each across `box` corner to corner. */
const paintingOf = (groups: readonly { id: string; box: StampBox }[]) => compileStampPaintRecipe(stampPaintRecipe({ paper: { color: '#ffffff' }, mixing: { kind: 'flat' } }, (paint) => {
  for (const { id, box } of groups) {
    const stroke = { brush, well: { paint: { kind: 'color', color: '#203040' } }, size: 10, path: [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y1 }] } as const;
    paint.group(id, { composite: 'opaque' }, (group) => group.passage('p', {}, (pass) => pass.stroke('s', stroke)));
  }
}));
const stage = stampStage({ width: 800, height: 600 }, 100);
const across = { x0: 0, y0: 0, x1: 800, y1: 600 };
/** A stroke 100 px across at the frame's centre. */
const middle = { x0: 350, y0: 250, x1: 450, y1: 350 };
const painted = (id: string, depth: number, groups: readonly string[]): StampPlane => ({ id, depth, source: { kind: 'painted', groups } });

const close = (a: StampPoint, b: StampPoint, what: string, within = 1e-6) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < within, `${what}: (${a.x}, ${a.y}) is not (${b.x}, ${b.y})`);
const move = (keys: readonly PaintCameraMoveKey[], clock: PaintCameraPlay['clock'] = { at: 0 }, origin = 'move') =>
  paintCameraPlay({ kind: 'move', keys }, { clock, origin });
const problemsOf = (build: PaintCameraBuild | PaintingCameraBuild) => (build.ok ? [] : build.problems);
const motionOf = (build: PaintMotionBuild): PaintMotion => {
  if (!build.ok) assert.fail(build.problems.join('\n'));
  return build.motion;
};

/** A sky on the back plane at depth 2, a frog at depth 1 and a leaf at depth 0.5. */
const threePlanes = paintingOf([{ id: 'sky', box: across }, { id: 'frog', box: across }, { id: 'leaf', box: across }]);
const threePlaneScene = [painted('back', 2, ['sky']), painted('frog', 1, ['frog']), painted('leaf', 0.5, ['leaf'])];

test('the build names a group on no plane or two, and orders the planes farthest first with the groups each shows', () => {
  const painting = paintingOf([{ id: 'sky', box: across }, { id: 'frog', box: across }, { id: 'toad', box: across }, { id: 'leaf', box: across }]);
  const build = (planes: readonly StampPlane[]) => buildPaintingCamera(painting, { stage, fov: 35, lens: { bloom: 0, shutter: 'shut' }, planes, motion: null });
  assert.deepEqual(problemsOf(build([painted('back', 4, ['sky', 'frog']), painted('mid', 1, ['frog']), painted('near', 0.5, ['leaf'])])), [
    'frog is on plane back and plane mid; a group is on one plane',
    'toad is on no plane',
  ]);
  const built = build([painted('near', 0.5, ['leaf']), painted('back', 4, ['sky']), painted('mid', 1, ['frog', 'toad'])]);
  if (!built.ok) assert.fail(built.problems.join('\n'));
  const { camera, planes } = built.camera;
  assert.deepEqual(camera.planes.map(({ id, kind }) => `${id} ${kind}`), ['back picture', 'mid picture', 'near picture']);
  assert.deepEqual([planes.back, ...planes.nearer].map((plane) => plane.kind === 'painted' && [plane.id, plane.groups]), [['back', [0]], ['mid', [1, 2]], ['near', [3]]]);
});

test('the build refuses a pan that shows the back past the stage, holds a nearer plane only where it\'s painted, and a wider margin takes it', () => {
  const whip = (margin: number, frog: StampBox) => buildPaintingCamera(paintingOf([{ id: 'sky', box: across }, { id: 'frog', box: frog }]), {
    stage: stampStage(stage.frame, margin), fov: 35, lens: { bloom: 0, shutter: 'shut' }, motion: null,
    planes: [painted('back', 4, ['sky']), painted('frog', 1, ['frog'])],
    plays: [move([{ at: 0 }, { at: 1, pan: { x: 900, y: 0 } }], { at: 0 }, 'whip')],
  });
  // The back at depth 4 moves a quarter of a pan at depth 1: 900 px brings in 225, past a 100 px margin. The frog's
  // plane moves 900 px, far past the stage, but its paint stays within it.
  assert.equal(problemsOf(whip(100, middle)).length, 1);
  assert.match(problemsOf(whip(100, middle))[0], /^plane back's picture must hold what the camera shows of it, .* whip from key 0 to 1, but the stage holds -100\.\.900 × -100\.\.700; widen the stage's margin$/);
  assert.deepEqual(problemsOf(whip(300, middle)), []);
  // Paint running past the stage's edge where the pan looks is refused on a nearer plane too.
  assert.match(problemsOf(whip(300, { ...across, x1: 1200 })).join('\n'), /^plane frog's picture must hold what the camera shows of it/);
});

/** Each three plane's built margin, farthest first. */
const marginOf = ({ planes }: PaintCamera) => planes.flatMap((plane) => (plane.kind === 'three' ? [plane.margin] : []));

test('a camera builds from plane depths and extents alone, holding each picture as far as its extent, and refuses a box that isn\'t one', () => {
  const whip = (extent: StampPlaneExtent) => buildPaintCamera({
    stage, fov: 35, lens: { bloom: 0, shutter: 'shut' },
    planes: [{ id: 'near', depth: 1, kind: 'picture', extent }, { id: 'far', depth: 4, kind: 'picture', extent: { kind: 'everywhere' } }, { id: 'model', depth: 2, kind: 'three' }],
    plays: [move([{ at: 0 }, { at: 1, pan: { x: 300, y: 0 } }], { at: 0 }, 'whip')],
  });
  const built = whip({ kind: 'box', box: middle });
  if (!built.ok) assert.fail(built.problems.join('\n'));
  assert.deepEqual(built.camera.planes.map(({ id }) => id), ['far', 'model', 'near']);
  // Never defocused, the three plane renders the frame alone; defocused, past it by the blur's reach.
  assert.deepEqual(marginOf(built.camera), [0]);
  const focused = buildPaintCamera({
    stage, fov: 35, lens: { bloom: 0, shutter: 'shut' }, planes: [{ id: 'far', depth: 4, kind: 'picture', extent: { kind: 'unchecked', why: 'not this test' } }, { id: 'model', depth: 2, kind: 'three' }],
    plays: [paintCameraPlay({ kind: 'focus', keys: [{ at: 0, focus: 1, aperture: 4 }] }, { clock: { at: 0 }, origin: 'focus' })],
  });
  if (!focused.ok) assert.fail(focused.problems.join('\n'));
  const [margin] = marginOf(focused.camera);
  assert.ok(margin >= 3 * 2, `a sigma of 2 px reaches ${margin} px`);
  assert.deepEqual(problemsOf(whip({ kind: 'empty' })), []);
  assert.deepEqual(problemsOf(whip({ kind: 'unchecked', why: 'its caller holds it' })), []);
  assert.match(problemsOf(whip({ kind: 'everywhere' })).join('\n'), /^plane near's picture must hold what the camera shows of it/);
  for (const box of [{ ...middle, x1: Number.NaN }, { ...middle, y0: Infinity }, { ...middle, x0: 450, x1: 350 }]) {
    assert.match(problemsOf(whip({ kind: 'box', box })).join('\n'), /^plane near's extent is .*; a box's bounds are finite, x0 ≤ x1 and y0 ≤ y1$/);
  }
});

test('a nearer plane holds as far as its groups\' motion can lay their paint: a group the camera follows off the stage is refused', () => {
  const painting = paintingOf([{ id: 'sky', box: across }, { id: 'frog', box: middle }]);
  const frog: PaintMotionNode = { id: 'frog' };
  // The camera pans 300 px right; the frog drifts `to` px right over the same second, followed.
  const drift = (to: number) => motionOf(buildPaintMotion(painting, {
    nodes: [frog], plays: [paintMotionPlay(frog, { kind: 'place', keys: [{ at: 0, x: 0, y: 0 }, { at: 1, x: to, y: 0 }] }, { clock: { at: 0 }, origin: 'drift' })],
  }));
  const follow = (motion: PaintMotion | null) => buildPaintingCamera(painting, {
    stage: stampStage(stage.frame, 300), fov: 35, lens: { bloom: 0, shutter: 'shut' }, motion,
    planes: [painted('back', 4, ['sky']), painted('frog', 1, ['frog'])], plays: [move([{ at: 0 }, { at: 1, pan: { x: 300, y: 0 } }])],
  });
  assert.deepEqual(problemsOf(follow(null)), []);
  assert.deepEqual(problemsOf(follow(drift(300))), []);
  // The pan shows the plane 2 px past the stage's 1100 (its read's reach); still, the frog's paint never comes near
  // there, but drifting 650 px it reaches past it.
  assert.match(problemsOf(follow(drift(650))).join('\n'), /^plane frog's picture must hold what the camera shows of it, -2\.\.1102 × .* move from key 0 to 1, but the stage holds -300\.\.1100/);
});

test('a plane\'s magnification is the most it\'s scaled anywhere in the shot, growing with dolly and zoom, the near plane more', () => {
  const magnified = (plays: readonly PaintCameraPlay[]) => {
    const build = buildPaintingCamera(threePlanes, { stage, fov: 35, lens: { bloom: 0, shutter: 'shut' }, planes: threePlaneScene, plays, motion: null });
    if (!build.ok) assert.fail(build.problems.join('\n'));
    return Object.fromEntries(build.magnification);
  };
  assert.deepEqual(magnified([]), { back: 1, frog: 1, leaf: 1 });
  // Pushed in 0.25 and zoomed 1.2: zoom·d/(d − 0.25).
  const pushed = magnified([move([{ at: 0 }, { at: 1, dolly: 0.25 }, { at: 2, zoom: 1.2 }, { at: 3, dolly: 0.25, zoom: 1.2 }], { at: 0 }, 'push')]);
  for (const [id, depth] of [['back', 2], ['frog', 1], ['leaf', 0.5]] as const) assert.ok(Math.abs(pushed[id] - (1.2 * depth) / (depth - 0.25)) < 1e-9, `${id} magnified ${pushed[id]}`);
});

test('the lens at a time views each plane by its depth (a pan parallaxes), defocuses it by its distance from the focus, and blooms', () => {
  const build = buildPaintingCamera(threePlanes, {
    stage, fov: 35, lens: { bloom: 3, shutter: 'shut' }, planes: threePlaneScene, motion: null,
    plays: [
      move([{ at: 0 }, { at: 1, pan: { x: 100, y: 0 } }]),
      paintCameraPlay({ kind: 'focus', keys: [{ at: 0, focus: 1, aperture: 4 }] }, { clock: { at: 0 }, origin: 'focus' }),
    ],
  });
  if (!build.ok) assert.fail(build.problems.join('\n'));
  const lens = paintCameraLensAt(build.camera.camera, 1), point = { x: 300, y: 200 };
  // A pan of 100 px at depth 1 moves a plane at depth 2 by 50 px and one at 0.5 by 200.
  for (const [id, shift] of [['back', -50], ['frog', -100], ['leaf', -200]] as const) close(paintSimilarityApply(lens.planes.get(id)!.view, point), { x: 300 + shift, y: 200 }, `${id} panned`, 1e-3);
  // Focused at depth 1 with aperture 4: depth 2 blurs 4·|1 − 1/2|, the frog none, depth 0.5 4·|1 − 2|.
  assert.deepEqual(['back', 'frog', 'leaf'].map((id) => lens.planes.get(id)?.defocus), [2, 0, 4]);
  assert.equal(lens.bloom, 3);
});

test("a point on a plane, seen through the pose's shot camera, lands where its plane's view puts it", () => {
  const world = paintCameraWorld(stage, { fov: 35 }), centre = paintStageCentre(stage);
  const poses: PaintCameraPose[] = [
    { pan: { x: 0, y: 0 }, dolly: 0, zoom: 1, roll: 0 },
    { pan: { x: 130, y: -45 }, dolly: 0.3, zoom: 1.4, roll: 0.2 },
    { pan: { x: -60, y: 80 }, dolly: -0.5, zoom: 0.8, roll: -0.7 },
  ];
  for (const pose of poses) {
    const camera = paintCameraShotAt(world, pose);
    for (const depth of [0.6, 1, 3.5]) {
      for (const point of [{ x: 120, y: 90 }, { x: 790, y: 560 }, { x: -80, y: 640 }]) {
        const { x, y, z } = paintPlaneWorldPoint(world, point, depth);
        close(shotCameraProject(camera, [x, y, z])!, paintSimilarityApply(paintPlaneSimilarity(pose, depth, centre), point), `depth ${depth} under ${JSON.stringify(pose)}`, 1e-6);
      }
    }
  }
});
