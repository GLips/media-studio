import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintKeyed } from '#lib/paint/animation/models/paint-keyed.ts';
import type { Layer, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import type { PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { compilePaintedShot, type CompiledShotPaintedPlane } from './shot-compile.ts';
import { shotPlaneSharesAt } from './shot-frame-plan.ts';
import { paintingInTime, shotPlanesKeyDrawingsText, type PaintingInTimeValues } from './shot-painting-in-time.ts';
import type { PaintedShotProps } from './shot-props.ts';

const FPS = 24;

/** A layer of one stroke across the document at `y`. */
const stroke = (key: string, y: number, pigment: `#${string}`): Layer => ({
  key, washes: [{
    key: `${key}-wash`,
    applications: [{
      kind: 'stroke', subpaths: [[{ x: 40, y }, { x: 280, y: y + 10 }]], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 20,
      seed: key, charge: { kind: 'paint', mix: { parts: [{ pigment, amount: 1 }], strength: 0.6 } },
    }],
  }],
});

const ridgeProperties = {
  ridgePx: { type: 'number', min: 0, max: 100, step: 5, default: 50 }, dusk: { type: 'boolean', default: false },
} as const satisfies PropertySchema;

/** A sky, its colour by `dusk`, over a ridge `ridgePx` below the middle. */
const ridgeSource: PaintingSourceModule<typeof ridgeProperties> = {
  properties: ridgeProperties,
  default: function gateRidge({ ridgePx, dusk }: PropertyValues<typeof ridgeProperties>): PaintingDocument {
    return {
      widthPx: 320, heightPx: 240, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour',
      layers: [stroke('sky', 40, dusk ? '#2a2a4b' : '#8aa4c8'), stroke('ridge', 120 + ridgePx, '#3a4a6b')],
    };
  },
};

/** A shot of the ridge on one plane over 0..2 s, its values `values`, at most `drawings` drawings. */
const ridgeShot = (values: PaintingInTimeValues<typeof ridgeProperties>, drawings: number): PaintedShotProps => ({
  camera: { stage: stampStage({ width: 320, height: 240 }, 2), fov: 35, lens: { bloom: 0, shutter: 'shut' }, animationFps: FPS },
  span: { from: 0, to: 2 + 1 / FPS, fps: FPS },
  planes: [{ id: 'ridge', depth: 1, source: paintingInTime(ridgeSource, { values, layers: ['sky', 'ridge'], drawings }) }],
});

const compiled = (props: PaintedShotProps) => compilePaintedShot(props, []);
const messages = (props: PaintedShotProps) => compiled(props).problems.map(({ path, message }) => `${path}: ${message}`);

/** What the plane shows at `t`: each drawing's ridge and dusk, and its weight to 4 places. */
function sharesAt(props: PaintedShotProps, t: number) {
  const { shot } = compiled(props), plane = shot!.planes[0] as CompiledShotPaintedPlane;
  return shotPlaneSharesAt(shot!, plane, paintMoment(t)).map(({ selection: { painting: { values } }, weight }) => [values.ridgePx, values.dusk, Number(weight.toFixed(4))]);
}

test('a painting in time keys its first and last moments, where it turns and halfway along a change, within its budget, and a frame dissolves the stretch its values lie on', () => {
  const sweep = ridgeShot({ ridgePx: paintKeyed([{ at: 0, value: 100 }, { at: 1, value: 50 }, { at: 2, value: 70 }]) }, 4);
  assert.deepEqual(shotPlanesKeyDrawingsText(compiled(sweep).shot!.planes), [
    'ridge: gateRidge in time, 4 drawings (at most 4) solved at 5 keys of the 49 moments it reads',
    'ridge: key at 0 s (ridgePx 100): the first moment',
    'ridge: key at 0.5 s (ridgePx 75): halfway along a change',
    'ridge: key at 0.625 s (ridgePx 70): halfway along a change',
    'ridge: key at 1 s (ridgePx 50): where its values turn',
    'ridge: key at 2 s (ridgePx 70): the last moment',
  ]);
  // On a drawing's own value it's that drawing alone; between, the stretch's ends weighed by how far it has come.
  assert.deepEqual(sharesAt(sweep, 0.5), [[75, false, 1]]);
  assert.deepEqual(sharesAt(sweep, 0.75), [[70, false, 0.625], [50, false, 0.375]]);
  // At a key's moment its values have passed its drawing's: it reads the stretch they lie on, not a jump to the key.
  assert.deepEqual(sharesAt(sweep, 0.625), [[70, false, 0.9375], [50, false, 0.0625]]);
});

test('a change of a boolean is a cut, held either side; a budget its cuts outrun is refused, and a turn it leaves undrawn is warned of', () => {
  const night = ridgeShot({ dusk: ({ at }) => at >= 1 }, 2);
  assert.deepEqual(sharesAt(night, 0.5), [[50, false, 1]]);
  assert.deepEqual(sharesAt(night, 1), [[50, true, 1]]);
  assert.deepEqual(messages(ridgeShot({ dusk: ({ at }) => at >= 1 }, 1)), [
    'ridge.source.drawings: is 1, and its first and last moments and either side of each cut draw 2: 0 s (dusk false), 0.958 s (dusk false), 1 s (dusk true), 2 s (dusk true)',
  ]);
  const pulse = ridgeShot({ ridgePx: paintKeyed([{ at: 0, value: 0 }, { at: 1, value: 100 }, { at: 2, value: 0 }]) }, 1);
  assert.deepEqual(messages(pulse), [
    'ridge.source.drawings: ridgePx strays 100 from the dissolve between its key drawings at 0 s and 2 s at 1 s (its step, 5, allowed): at most 1 drawing, it leaves a turn undrawn; allow more',
  ]);
});

test("a painting in time's values are held to its schema at every moment it reads, naming the first that isn't", () => {
  assert.deepEqual(messages(ridgeShot({ ridgePx: ({ at }) => 60 * at }, 4)), ['ridge.source.values.ridgePx: ridgePx = 102.5 is outside 0..100 at 1.708 s']);
  // SAFETY: a JS source can name any property; the type refuses it in TypeScript.
  assert.deepEqual(messages(ridgeShot({ heightPx: 3 } as PaintingInTimeValues<typeof ridgeProperties>, 4)), ["ridge.source.values.heightPx: names heightPx, which isn't a property of gateRidge"]);
});
