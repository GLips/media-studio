import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compilePaintingSelection } from '#lib/paint/document/models/painting-document-compile.ts';
import type { Layer, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { paintingPoseText, type PaintingPoses } from '#lib/paint/document/models/painting-pose.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampPointBox, stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampRoundTipStatedProfile } from '#lib/paint/painting/models/stamp-tip-support.ts';
import { compilePaintedShot } from './shot-compile.ts';
import { shotPlanePosesAt, shotPlaneSharesAt, shotRigGroupPivot, shotRigReader } from './shot-frame-plan.ts';
import type { PaintedShotProps, RigPart } from './shot-props.ts';
import { shotRigFound, type ShotRigCel, type ShotRigFound } from './shot-rigs.ts';
import { shotPlaneLayPlan, type ShotCardFilm } from './shot-sheet-lays.ts';

const FPS = 24;

const wash: StampBrush = {
  profile: STAMP_BRUSH_UNMEASURED, name: 'wash', blend: 'normal', media: 'wet', accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'watercolor', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1, stepping: 'spread', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
};
wash.profile = stampRoundTipStatedProfile(wash);
const brushOf = () => wash;

const layer = (key: string): Layer => ({
  key, washes: [{
    key: `${key}-wash`,
    applications: [{
      kind: 'stroke', subpaths: [[{ x: 40, y: 100 }, { x: 200, y: 120 }]], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 20,
      seed: key, charge: { kind: 'paint', mix: { parts: [{ pigment: '#3a4a6b', amount: 1 }], strength: 0.6 } },
    }],
  }],
});

/** A sky, and a heron of a body and a neck; `own`, the heron's group owns its sheet, so a rig draws it as pieces. */
const pond = (own: boolean) => painting({
  default: function pondDocument(): PaintingDocument {
    const heron = { key: 'heron', ...(own && { sheet: { kind: 'own', paper: { color: '#f4f2ed', absorbency: 0.5 } } as const }), children: [layer('body'), layer('neck')] };
    return { widthPx: 320, heightPx: 240, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', layers: [layer('sky'), heron] };
  },
});

const camera: PaintedShotProps['camera'] = { stage: stampStage({ width: 320, height: 240 }, 2), fov: 35, lens: { bloom: 0, shutter: 0 }, plays: [], animationFps: FPS };
const HERON_PARTS: readonly RigPart[] = [
  { id: 'body', z: 0, parent: null, cels: ['body'] },
  { id: 'neck', z: 1, parent: 'body', joint: 'hinge', pivot: { x: 60, y: 100 }, cels: ['neck'] },
];

/** `props`' one plane planned at `at`, its marks solved at the same moment, every film painted over the strokes' box. */
function planAt(props: PaintedShotProps, at: PaintMoment) {
  const { shot, problems } = compilePaintedShot(props, []);
  assert.deepEqual(problems, []);
  const [plane] = shot!.planes;
  assert.ok(plane.kind === 'painted');
  const [{ selection }] = shotPlaneSharesAt(shot!, plane, at), compiled = compilePaintingSelection(selection.painting, brushOf, { layers: selection.layers });
  const films = compiled.sheets.map(({ layers }) => layers.map((_, f) => ({ box: stampPointBox({ x: 30, y: 90, w: 180, h: 40 }), key: `film ${f}` })));
  // Rigs found with unit axes: what the plan reads of them is their parts' poses, not the paint they were found over.
  const found: ShotRigFound[] = [...shot!.rigs.values()].map((rig) => ({ rig, axes: new Map(rig.parts.map(({ id }) => [id, { direction: 0, length: 1 }])), skin: null }));
  const rigs = { found, read: shotRigReader(shot!.motion) }, solved = shotPlanePosesAt(plane, shot!.motion, rigs, at, false);
  return { solved, plan: shotPlaneLayPlan({ shot: shot!, plane, selection, compiled, films, solved, rigs, stage: camera.stage }, { at, shutter: null }) };
}

/** Rest cel `cel`, its pixels keyed `key`, opaque over its box. */
const restCel = (cel: string, key: string, x0: number, y0: number, w: number, h: number): ShotRigCel => ({ cel, key, picture: { x0, y0, w, h, rgba: new Float32Array(w * h * 4).fill(1) } });

const solvedText = (solved: PaintingPoses) => [...solved].map(([key, pose]) => `${key}=${paintingPoseText(pose)}`).join(';');

test("a boil's wobble moves finished paint: marks solve alike across epochs, while the lay and its picture's key move", () => {
  const props: PaintedShotProps = {
    camera, planes: [{ id: 'front', depth: 1, source: layersOf(pond(false), ['sky', 'heron']) }],
    motion: { nodes: [{ id: 'front/heron', marks: { boil: { every: 1 } } }], plays: [] },
  };
  const [first, again, next] = [1.5, 1.5, 2.5].map((frame) => planAt(props, paintMoment(frame / FPS)));
  assert.equal(solvedText(next.solved), solvedText(first.solved));
  assert.equal(again.plan.key, first.plan.key);
  assert.notEqual(next.plan.key, first.plan.key);
});

test("a cel skinned to others solves under its skin's name: ends painted alike to the body, their necks apart, pose the body apart", () => {
  const parts: readonly RigPart[] = [
    { id: 'body', z: 0, parent: null, cels: ['body'] },
    { id: 'neck', z: 1, parent: 'body', joint: 'skin', pivot: { x: 60, y: 100 }, blend: 12, cels: ['neck'] },
  ];
  const { shot } = compilePaintedShot({
    camera, planes: [{ id: 'front', depth: 1, source: layersOf(pond(false), ['sky', 'heron']) }], rigs: { 'front/heron': { parts, pose: { neck: { rotation: 0.3 } } } },
  }, []);
  const [plane] = shot!.planes, rig = shot!.rigs.get('front/heron')!, { motion } = shot!;
  assert.ok(plane.kind === 'painted');
  // An end's rig found over its own rest cels, its neck turned and nothing bent: the meshes part, the parts' maps don't.
  const bodyPose = (neck: ShotRigCel) => {
    const found = shotRigFound(rig, shotRigGroupPivot(rig, motion), [restCel('body', 'body', 30, 95, 60, 20), neck]);
    return paintingPoseText(shotPlanePosesAt(plane, motion, { found: [found], read: shotRigReader(motion) }, paintMoment(0), false).get('body')!);
  };
  const day = restCel('neck', 'day neck', 54, 60, 12, 45), dusk = restCel('neck', 'dusk neck', 50, 56, 18, 49);
  assert.notEqual(bodyPose(day), bodyPose(dusk));
  assert.equal(bodyPose(day), bodyPose(day));
});

test('a layer inside a rig drawn as pieces shows whole or not at all: refused at load as a constant, as it draws as a callback', () => {
  const props = (visibility: number | (() => number)): PaintedShotProps => ({
    camera, planes: [{ id: 'front', depth: 1, source: layersOf(pond(true), ['sky', 'heron']) }],
    rigs: { 'front/heron': { parts: HERON_PARTS, pose: {} } }, visibility: { 'front/neck': visibility },
  });
  assert.deepEqual(compilePaintedShot(props(0.5), []).problems.map(({ message }) => message), ['is 0.5, inside front/heron, drawn as pieces: a layer or group there shows (1) or doesn\'t (0)']);
  assert.deepEqual(planAt(props(0), paintMoment(0)).plan.pieces[0].layers, new Set(['body']));
  assert.throws(() => planAt(props(() => 0.5), paintMoment(0)), /front\/neck's visibility is 0.5 at 0 s, inside front\/heron, drawn as pieces/);
});

const CARD_PAPER = { color: '#e9dfc8', absorbency: 0.5 } as const;

/**
 * A sky; a collage card holding a figure of two cels, `up` and `down`, and a `sitting` view of a `seat`; and a leaf
 * owning a sheet of its own.
 */
const collage = painting({
  default: function collageDocument(): PaintingDocument {
    const figure = { key: 'figure', children: [layer('up'), layer('down')] }, sitting = { key: 'sitting', children: [layer('seat')] };
    return {
      widthPx: 320, heightPx: 240, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour',
      layers: [layer('sky'), { key: 'collage', sheet: { kind: 'own', paper: CARD_PAPER }, children: [figure, sitting] }, { ...layer('leaf'), sheet: { kind: 'own', paper: CARD_PAPER } }],
    };
  },
});

const cardText = (films: readonly ShotCardFilm[]) => `card of ${films.map(({ film, shown }) => `${film} × ${shown}`).join(', ')}`;

test("a card is cut round what shows, a fading layer's share thinned; an own sheet's owner fades card and paint as one", () => {
  const props: PaintedShotProps = {
    camera, planes: [{ id: 'front', depth: 1, source: layersOf(collage, ['sky', 'collage', 'leaf']) }],
    rigs: { 'front/figure': { parts: [{ id: 'figure', z: 0, parent: null, cels: ['up', 'down'] }], pose: {} } },
    visibility: { 'front/leaf': 0.5, 'front/up': 0.5, 'front/sitting': 0 },
  };
  const { plan } = planAt(props, paintMoment(0));
  const laid = plan.steps.map((step) => step && (step.lay.kind === 'film' ? `${step.lay.layer} at ${step.opacity}` : step.lay.kind === 'card' && cardText(step.lay.films)));
  // The hidden cel `down` and the view switched off cut no paper; `up` half shown counts half its coverage.
  assert.deepEqual(laid, ['sky at 1', 'card of 0 × 0.5', 'up at 0.5', null, 'seat at 1', 'card of 0 × 1', 'leaf at 1']);
  assert.deepEqual(plan.fades, [{ node: 'sitting', first: 4, last: 4, visibility: 0 }, { node: 'leaf', first: 5, last: 6, visibility: 0.5 }]);
});

test("a path mask's reveal moves its picture's key, never what it solves; a callback's reveal below 0 is refused at its frame", () => {
  const props: PaintedShotProps = {
    camera, planes: [{
      id: 'front', depth: 1, source: layersOf(pond(false), ['sky', 'heron']),
      masks: [{ kind: 'path', subpaths: [[{ x: 40, y: 100 }, { x: 200, y: 120 }]], widthPx: 30, revealPx: ({ at }) => 80 * at - 40 }],
    }],
  };
  const [early, late] = [1, 2].map((s) => planAt(props, paintMoment(s)));
  assert.equal(solvedText(late.solved), solvedText(early.solved));
  assert.notEqual(late.plan.key, early.plan.key);
  assert.deepEqual(early.plan.masks.map((mask) => mask.kind === 'path' && mask.revealPx), [40]);
  assert.throws(() => planAt(props, paintMoment(0)), /front\.masks\[0\]\.revealPx: -40 at 0 s; a reveal is 0 px or more/);
});
