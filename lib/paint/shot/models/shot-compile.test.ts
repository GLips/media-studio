import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Layer, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { compilePaintedShot } from './shot-compile.ts';
import { shotPlaneMomentAt, shotPlaneSelectionAt } from './shot-frame-plan.ts';
import type { PaintedShotProps, RigPart } from './shot-props.ts';

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

test("a plane's source clock holds what its source reads apart from what its clock holds, each answer checked", () => {
  const { shot } = compilePaintedShot({
    camera,
    planes: [{ id: 'front', depth: 1, clock: { hold: 2 }, sourceClock: { hold: 6 }, source: ({ at }) => layersOf(pond, at < 1 ? ['sky', 'heron'] : ['sky', 'egret'], { at }) }],
  }, []);
  const [front] = shot!.planes, frame9 = paintMoment(9 / FPS);
  assert.ok(front.kind === 'painted');
  assert.equal(shotPlaneSelectionAt(front, frame9, FPS).at, 6 / FPS);
  assert.equal(shotPlaneMomentAt(shot!.motion, 'front', frame9).at, 8 / FPS);
  assert.throws(() => shotPlaneSelectionAt(front, paintMoment(1), FPS), /egret/);
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
