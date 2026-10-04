import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Layer, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { paintCameraPlay, paintPlaneViewAt } from '#lib/paint/animation/models/paint-camera.ts';
import { paintSimilarityApply, paintSimilarityAfter, paintSimilarityInverse, paintSimilarityOf } from '#lib/paint/animation/models/paint-similarity.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { compilePaintedShot } from './shot-compile.ts';
import { shotPlaneClocks, shotPlaneMomentAt, shotPlaneSharesAt } from './shot-frame-plan.ts';
import { shotPinnedPlanes } from './shot-placement.ts';
import type { CoverFrame, PaintedShotProps, RigPart, ScreenPin } from './shot-props.ts';
import { dissolve } from './shot-selection.ts';
import { shotWarmCombinations, shotWarmFrames } from './shot-warm.ts';

const FPS = 24;

const layer = (key: string): Layer => ({
  key, washes: [{
    key: `${key}-wash`,
    applications: [{
      kind: 'stroke', subpaths: [[{ x: 40, y: 100 }, { x: 200, y: 120 }]], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 20,
      seed: key, charge: { kind: 'paint', mix: { parts: [{ pigment: '#3a4a6b', amount: 1 }], strength: 0.6 } },
    }],
  }],
});

/** A sky, and a heron group painting nothing of its own: its body and neck. */
const pond = painting({
  default: function pond(): PaintingDocument {
    return { widthPx: 320, heightPx: 240, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', layers: [layer('sky'), { key: 'heron', children: [layer('body'), layer('neck')] }] };
  },
});

const camera: PaintedShotProps['camera'] = { stage: stampStage({ width: 320, height: 240 }, 2), fov: 35, lens: { bloom: 0, shutter: 0 }, plays: [], animationFps: FPS };
const heronParts: readonly RigPart[] = [
  { id: 'body', z: 0, parent: null, cels: ['body'] },
  { id: 'neck', z: 1, parent: 'body', joint: 'skin', pivot: { x: 60, y: 100 }, blend: 12, cels: ['neck'] },
];
const problemsOf = (props: PaintedShotProps) => compilePaintedShot(props, []).problems.map(({ path, message }) => `${path}: ${message}`);

test('motion hangs each occurrence node from its nearest enclosing node, a paintless group one, and chains their clocks', () => {
  const { shot } = compilePaintedShot({
    camera,
    planes: [{ id: 'front', depth: 1, clock: { hold: 2 }, source: layersOf(pond, ['sky', 'heron']) }],
    motion: { nodes: [{ id: 'front' }, { id: 'front/heron', pivot: { x: 60, y: 100 }, clock: { hold: 3 } }, { id: 'front/neck' }], plays: [] },
  }, []);
  const { nodes, nearest } = shot!.motion;
  assert.deepEqual([...nodes.values()].map(({ id, parent }) => [id, parent]), [['front', null], ['front/heron', 'front'], ['front/neck', 'front/heron']]);
  assert.deepEqual(nodes.get('front/neck')!.clock, [{ kind: 'hold', frames: 2 }, { kind: 'hold', frames: 3 }]);
  assert.deepEqual(Object.fromEntries(nearest), { 'front/sky': 'front', 'front/heron': 'front/heron', 'front/body': 'front/heron', 'front/neck': 'front/neck' });
});

test("a plane's source clock holds what its source reads apart from what its clock holds, each answer checked, and a warm pairs them", () => {
  const { shot } = compilePaintedShot({
    camera,
    planes: [{ id: 'front', depth: 1, clock: { hold: 4 }, sourceClock: { hold: 6 }, source: ({ at }) => layersOf(pond, at < 1 ? ['sky', 'heron'] : ['sky', 'egret'], { at }) }],
    motion: { nodes: [{ id: 'front/heron', clock: { hold: 3 } }], plays: [] },
  }, []);
  const [front] = shot!.planes, frame9 = paintMoment(9 / FPS);
  assert.ok(front.kind === 'painted');
  assert.equal(shotPlaneSharesAt(front, frame9, FPS)[0].selection.at, 6 / FPS);
  assert.equal(shotPlaneMomentAt(shot!.motion, 'front', frame9).at, 8 / FPS);
  assert.throws(() => shotPlaneSharesAt(front, paintMoment(1), FPS), /egret/);
  // Over its first half second it solves where either clock moves on: sixes and fours. The heron's threes run inside
  // the plane's fours, so they split nothing more.
  const warmed = shotWarmCombinations(shotWarmFrames({ from: 0, to: 0.5 }, FPS), shotPlaneClocks(shot!.motion, front), FPS);
  assert.deepEqual(warmed.map(({ at }) => Math.round(at * FPS)), [0, 4, 6, 8, 12]);
});

/** A puddle on a smaller sheet than the pond's. */
const puddle = painting({
  default: function puddle(): PaintingDocument {
    return { widthPx: 160, heightPx: 120, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', layers: [layer('sky')] };
  },
});

test("a dissolving plane shows both its ends' occurrences, weighed by k on its source clock, and refuses a rig, two document sizes and two grounds", () => {
  const sky = layersOf(pond, ['sky']), heron = layersOf(pond, ['heron']);
  const { shot } = compilePaintedShot({
    camera, planes: [{ id: 'front', depth: 1, sourceClock: { hold: 6 }, source: ({ at }) => dissolve(sky, dissolve(heron, sky, 0.5), Math.min(1, at)) }],
  }, []);
  const [front] = shot!.planes;
  assert.ok(front.kind === 'painted');
  assert.deepEqual(front.occurrences.map(({ key }) => key), ['front/sky', 'front/heron', 'front/body', 'front/neck']);
  // At 9/24 s its source reads 6/24 s: k is 0.25, and the inner dissolve gives half of that back to the sky.
  assert.deepEqual(shotPlaneSharesAt(front, paintMoment(9 / FPS), FPS).map(({ selection, weight }) => [selection.layers.join(), weight]), [['sky', 0.875], ['heron', 0.125]]);
  assert.deepEqual(problemsOf({
    camera,
    planes: [
      { id: 'back', depth: 3, source: dissolve(sky, layersOf(puddle, ['sky']), 0.5) }, { id: 'mid', depth: 2, source: dissolve(sky, layersOf(pond, ['sky'], { ground: 'transparent' }), 0.5) },
      { id: 'front', depth: 1, source: dissolve(heron, sky, 0) },
    ],
    rigs: { 'front/heron': { parts: heronParts, pose: {} } },
  }), [
    "back.source: paints a 160 × 120 document, and the plane's is 320 × 240: every selection a plane shows, a dissolve's ends and each frame's, paints one document size",
    "mid.source: lays a transparent ground, and the plane a default one: every selection a plane shows, a dissolve's ends and each frame's, lays one ground",
    "front.source: dissolves, and front/heron on it is rigged: dissolve planes can't be rigged",
  ]);
});

test('a shot refuses motion its rig or lay already writes, and what it does not draw, every problem at once', () => {
  assert.deepEqual(problemsOf({
    camera,
    planes: [{ id: 'front', depth: 1, lay: () => ({ placement: { x: 0, y: 0, rotation: 0, scale: 1 }, pivot: { x: 0, y: 0 } }), source: layersOf(pond, ['sky', 'heron']) }],
    rigs: { 'front/heron': { parts: heronParts, pose: {} } },
    motion: {
      nodes: [{ id: 'front' }, { id: 'front/heron' }, { id: 'front/neck' }],
      plays: [
        { target: 'front/heron', clip: { kind: 'sway', root: { x: 60, y: 100 }, direction: -Math.PI / 2, length: 40, amount: 4, period: 2 }, clock: { at: 0 }, origin: 'heron sways' },
        { target: 'front', clip: { kind: 'place', keys: [{ at: 0, x: 0, y: 0 }, { at: 1, x: 20, y: 0 }] }, clock: { at: 1 }, origin: 'push' },
      ],
    },
    paintedTextures: [{ id: 'mug', source: layersOf(pond, ['sky']), widthPx: 64, heightPx: 64 }],
  }), [
    'front/neck.motion: lies in front/heron, which is rigged: its rig\'s parts pose all it holds, so nothing in it takes a node',
    'heron sways.motion: front/heron is rigged: it takes no pins, sway or flutter',
    'motion: push writes place on front from 1s while front\'s lay callback still does (without end)',
    'shot.paintedTextures: a shot doesn\'t paint textures for three.js objects yet (ENGINE 6.3): paint them apart, or leave them out',
  ]);
});

test('a transparent back is refused unless HTML lies behind the first canvas, over which it is laid clear', () => {
  const props: PaintedShotProps = { camera, planes: [{ id: 'back', depth: 1, source: layersOf(pond, ['sky'], { ground: 'transparent' }) }] };
  assert.deepEqual(problemsOf(props), ['back.source.ground: is the back, laid on its paper wherever the frame shows: its ground is transparent only over HTML before the first canvas']);
  const { shot } = compilePaintedShot(props, [], { htmlBehind: true });
  assert.equal(shot!.clearBack, true);
  assert.equal(shot!.planes[0].kind === 'painted' && shot!.planes[0].back, false);
});

/** A camera panning 60 px at depth 1 over a stage 40 px wider each side: a plane laid far enough right is seen past it. */
const panning: PaintedShotProps['camera'] = {
  ...camera, stage: stampStage({ width: 320, height: 240 }, 40), plays: [paintCameraPlay({ kind: 'move', keys: [{ at: 0 }, { at: 1, pan: { x: 60, y: 0 } }] }, { clock: { at: 0 }, origin: 'pan' })],
};
const laidOnFrame = (lay: ScreenPin | CoverFrame): PaintedShotProps => ({
  camera: panning, planes: [{ id: 'back', depth: 2, source: layersOf(pond, ['sky']) }, { id: 'label', depth: 1, lay, source: layersOf(pond, ['heron']) }],
});

test('a cover holds the frame through the shot\'s own camera at its second, refused where it lays paint past the stage', () => {
  const box = { x0: 0, y0: 0, x1: 320, y1: 240 }, { shot } = compilePaintedShot(laidOnFrame({ kind: 'cover', box, at: 1 }), []);
  const label = shot!.planes[1];
  assert.ok(label.kind === 'painted' && label.lay.kind === 'still' && label.lay.lay);
  const { placement, pivot } = label.lay.lay, toDocument = paintSimilarityInverse(paintSimilarityAfter(paintPlaneViewAt(shot!.camera, 1, paintMoment(1)), paintSimilarityOf(placement, pivot)));
  const corners = [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 240 }, { x: 0, y: 240 }].map((corner) => paintSimilarityApply(toDocument, corner));
  assert.ok(corners.every(({ x, y }) => x > box.x0 - 1e-6 && x < box.x1 + 1e-6 && y > box.y0 - 1e-6 && y < box.y1 + 1e-6), `the frame's corners lie on the box: ${JSON.stringify(corners)}`);
  // A box a tenth the frame's is laid ten times its size, its paint reaching past the stage as the camera pans.
  assert.deepEqual(problemsOf(laidOnFrame({ kind: 'cover', box: { x0: 100, y0: 100, x1: 132, y1: 124 } })), [
    "label.lay: plane label's picture must hold what the camera shows of it, -2..382 × -2..242 pan from key 0 to 1, but the stage holds -40..360 × -40..280; widen the stage's margin",
  ]);
});

test('a pinned plane lies where a frame measures its elements, refused when one is unmounted or its paint passes the stage', () => {
  const pin = { kind: 'pin', points: [{ sourcePx: { x: 40, y: 100 }, element: 'label' }] } as const, { shot } = compilePaintedShot(laidOnFrame(pin), []);
  const pinnedAt = (x: number, y: number) => shotPinnedPlanes(shot!, new Map([['label', [{ x, y }]]]));
  const { planes, problems } = pinnedAt(60, 90), label = planes.get('label')!;
  assert.deepEqual(problems, []);
  assert.ok(label.lay.kind === 'still' && label.lay.lay);
  const { placement, pivot } = label.lay.lay, view = paintPlaneViewAt(shot!.camera, 1, paintMoment(0));
  const centre = paintSimilarityApply(paintSimilarityAfter(view, paintSimilarityOf(placement, pivot)), pin.points[0].sourcePx);
  assert.ok(Math.hypot(centre.x - 60, centre.y - 90) < 1e-6, `its point lies at ${centre.x}, ${centre.y}`);
  const refused = (centres: Map<string, readonly ({ x: number; y: number } | null)[]>) => shotPinnedPlanes(shot!, centres).problems.map(({ path, message }) => `${path}: ${message}`);
  assert.deepEqual(refused(new Map([['label', [null]]])), ["label.lay.points[0].element: isn't mounted: a pin lies on its element's centre once laid out"]);
  assert.deepEqual(refused(new Map([['label', [{ x: 300, y: 90 }]]])), [
    "label.lay: plane label's picture must hold what the camera shows of it, 258..382 × 30..170 pan from key 0 to 1, but the stage holds -40..360 × -40..280; widen the stage's margin",
  ]);
});
