import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Layer, PaintingDocument, Region } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';
import { compilePaintedShot, type CompiledShotPaintedPlane } from './shot-compile.ts';
import { shotFigure, shotFigureInTime, shotFigureSilhouetteAt, shotPlace } from './shot-figure.ts';
import { shotPlaneSharesAt } from './shot-frame-plan.ts';
import type { PaintedShotProps, PlaneProps } from './shot-props.ts';

const FPS = 24;
const SPAN: SceneShownSpan = { from: 0, to: 1 + 1 / FPS, fps: FPS };
const camera: PaintedShotProps['camera'] = { stage: stampStage({ width: 160, height: 120 }, 2), fov: 35, lens: { bloom: 0, shutter: 'shut' }, animationFps: FPS };

const layer = (key: string): Layer => ({
  key, washes: [{ key: `${key}-wash`, applications: [{
    kind: 'stroke', subpaths: [[{ x: 40, y: 60 }, { x: 100, y: 60 }]], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 12,
    seed: key, charge: { kind: 'paint', mix: { parts: [{ pigment: '#3a4a6b', amount: 1 }], strength: 0.6 } },
  }] }],
});
const square = (x: number): Region => ({ kind: 'polygon', rings: [[{ x, y: 20 }, { x: x + 40, y: 20 }, { x: x + 40, y: 100 }, { x, y: 100 }]] });
const paper = { color: '#f4f2ed', absorbency: 0.5 } as const;

const figureProperties = { x: { type: 'number', min: 0, max: 80, default: 20 }, hidden: { type: 'boolean', default: false } } as const;
/** subjectFigureCard's shape: a shadow on the ground, then the figure's card at `x`, a nested card in it; hidden, the figure's group on no card. */
const walker = {
  properties: figureProperties,
  default: ({ x, hidden }: { x: number; hidden: boolean }): PaintingDocument => ({
    widthPx: 160, heightPx: 120, paper, medium: 'watercolour', layers: [
      layer('shadow'),
      { key: 'walker', ...(!hidden && { sheet: { kind: 'own', paper, card: { figure: square(x), fadePx: 2 } } }), children: [layer('body'), { key: 'badge', sheet: { kind: 'own', paper }, children: [layer('star')] }] },
    ],
  }),
};

const back: PlaneProps = { id: 'street', depth: 2, source: layersOf(painting(walker), ['shadow']) };
const compiled = (near: PlaneProps) => compilePaintedShot({ camera, span: SPAN, planes: [back, near] }, []);
const nearPlane = (near: PlaneProps) => {
  const { shot, problems } = compiled(near);
  assert.deepEqual(problems, []);
  return { shot: shot!, plane: shot!.planes.find(({ id }) => id === near.id) as CompiledShotPaintedPlane & { figure: string } };
};

test("a placed figure is the plane selecting its card on no ground: its paint and nested card, never the ground's shadow", () => {
  const evaluation = painting(walker);
  const placed = nearPlane(shotPlace(shotFigure(evaluation, 'walker'), { id: 'walker', depth: 1 }));
  const direct = nearPlane({ id: 'walker', depth: 1, source: layersOf(evaluation, ['walker'], { ground: 'transparent' }) });
  assert.equal(placed.plane.figure, 'walker');
  assert.equal(direct.plane.figure, null);
  assert.deepEqual(placed.plane.occurrences, direct.plane.occurrences);
  assert.deepEqual(placed.plane.occurrences.map(({ key }) => key), ['walker/walker', 'walker/body', 'walker/badge', 'walker/star']);
  assert.deepEqual(shotPlaneSharesAt(placed.shot, placed.plane, paintMoment(0)), shotPlaneSharesAt(direct.shot, direct.plane, paintMoment(0)));
  assert.equal(placed.plane.opaqueBack, false);
});

test("a figure's silhouette is read at each moment as its painting is rebuilt then: its card's figure, none while hidden", () => {
  const moving = shotFigure(({ at }) => painting(walker, { x: Math.round(at * 40), hidden: at > 0.75 }), 'walker');
  const { shot, plane } = nearPlane(shotPlace(moving, { id: 'walker', depth: 1 }));
  assert.deepEqual(shotFigureSilhouetteAt(shot, plane, paintMoment(0)), [{ region: square(0), weight: 1 }]);
  assert.deepEqual(shotFigureSilhouetteAt(shot, plane, paintMoment(0.5)), [{ region: square(20), weight: 1 }]);
  assert.deepEqual(shotFigureSilhouetteAt(shot, plane, paintMoment(1)), [{ region: null, weight: 1 }]);
});

test("a figure in time solves key drawings of its card alone, each with its own silhouette, blended between", () => {
  const { shot, plane } = nearPlane(shotPlace(shotFigureInTime(walker, 'walker', { values: { x: ({ at }) => at * 40 }, drawings: 2 }), { id: 'walker', depth: 1 }));
  assert.deepEqual(plane.ends.map(({ selection: { layers, ground } }) => [layers, ground]), [[['walker'], 'transparent'], [['walker'], 'transparent']]);
  const between = shotFigureSilhouetteAt(shot, plane, paintMoment(0.5));
  assert.deepEqual(between.map(({ region }) => region), [square(0), square(40)]);
  assert.ok(between.every(({ weight }) => weight > 0 && weight < 1));
});

test("a figure naming a layer, or a group on a cut-paper card, is refused: a figure is a figure card's group", () => {
  const refused = (card: string) => compiled(shotPlace(shotFigure(painting(walker), card), { id: 'walker', depth: 1 })).problems.map(({ message }) => message).join('\n');
  assert.match(refused('body'), /names body as its figure, which is a layer/);
  assert.match(refused('badge'), /names badge as its figure, which is a group on an own sheet with no figure card/);
});
