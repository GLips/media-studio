import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { lensSigmaStepped } from '#lib/picture/lens/models/lens-focus.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { paintCameraDepthLooks } from '#lib/paint/animation/models/paint-camera.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { compilePaintedShot } from './shot-compile.ts';
import { shotDrawSteps, shotExposureItems } from './shot-instances.ts';
import { shotDrawableOrder } from './shot-plan.ts';
import type { InstancedPlaneProps, PaintedShotProps, PlaneInstance, PlaneProps } from './shot-props.ts';

/** One drop of rain. */
const drops = painting({
  default: function drops(): PaintingDocument {
    return {
      widthPx: 16, heightPx: 32, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', layers: [{
        key: 'drop', washes: [{
          key: 'drop-wash', applications: [{
            kind: 'stroke', subpaths: [[{ x: 8, y: 4 }, { x: 8, y: 28 }]], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 6, seed: 'drop',
            charge: { kind: 'paint', mix: { parts: [{ pigment: '#3a4a6b', amount: 1 }], strength: 0.4 } },
          }],
        }],
      }],
    };
  },
});

const item = (key: string, depth: number, variant = 'drop', x = 0): PlaneInstance => ({ key, variant, depth, lay: { placement: { x, y: 0, rotation: 0, scale: 1 }, pivot: { x: 8, y: 16 } } });
const instanced = (id: string, items: readonly PlaneInstance[]): InstancedPlaneProps => ({
  kind: 'instanced', id, depths: { near: 1, far: 2.5 }, variants: { drop: layersOf(drops, ['drop']), big: layersOf(drops, ['drop']) }, instances: () => items,
});
const plane = (id: string, depth: number): PlaneProps => ({ id, depth, source: layersOf(drops, ['drop']) });

test('items sort with the planes far to near, planes first on a tie, and batch by plane, variant and stepped blur', () => {
  const rain = instanced('rain', [item('a', 2), item('b', 2), item('c', 2.5, 'big'), item('d', 1)]), mist = instanced('mist', [item('m', 2)]);
  const planes = [plane('street', 3), rain, plane('sign', 2), mist];
  const drawables = shotDrawableOrder(planes, new Map([['rain', rain.instances({ at: 0, frame: 0 })], ['mist', mist.instances({ at: 0, frame: 0 })]]));
  assert.deepEqual(drawables.map((drawable) => (drawable.kind === 'plane' ? drawable.plane : `${drawable.plane}:${drawable.item.key}`)), [
    'street', 'rain:c', 'sign', 'rain:a', 'rain:b', 'mist:m', 'rain:d',
  ]);
  const steps = shotDrawSteps(drawables, (_plane, { depth }) => (depth < 1.5 ? 4.1 : 0));
  assert.deepEqual(steps.map((step) => (step.kind === 'plane' ? step.plane : `${step.plane} ${step.variant} σ${step.sigma.toFixed(2)}: ${step.items.map(({ key }) => key).join(' ')}`)), [
    'street', 'rain big σ0.00: c', 'sign', 'rain drop σ0.00: a b', 'mist drop σ0.00: m', `rain drop σ${lensSigmaStepped(4.1).toFixed(2)}: d`,
  ]);
});

const camera: PaintedShotProps['camera'] = { stage: stampStage({ width: 48, height: 40 }, 2), fov: 35, lens: { bloom: 0, shutter: 0.02 }, plays: [], animationFps: 24 };
const compiled = (planes: PaintedShotProps['planes'], motion?: PaintedShotProps['motion']) => compilePaintedShot({ camera, planes, ...(motion && { motion }) }, []);

test("an exposure lays each item by its lay at its depth, blurred along its own travel only while its key spans the shutter", () => {
  const rain: InstancedPlaneProps = { ...instanced('rain', []), instances: ({ at }) => [item('a', 2, 'drop', 100 * at), item(`b${Math.round(at * 1000)}`, 1.5)] };
  const { shot, problems } = compiled([plane('street', 3), rain]);
  assert.deepEqual(problems, []);
  const exposure = { at: paintMoment(1), shutter: { open: paintMoment(0.99, 1), close: paintMoment(1.01, 1) } };
  const { items, lookOf } = shotExposureItems(shot!.instanced, shot!.motion, exposure, paintCameraDepthLooks(shot!.camera, 1));
  const [a, b] = items.get('rain')!, falling = lookOf('rain', a);
  // Its variant's picture starts at the stage's corner, the margin past the frame's; the camera's at rest.
  assert.ok(Math.abs(falling.view.kx - 102) < 1e-9 && falling.view.ky === 2);
  assert.ok(falling.shutter && Math.abs(falling.shutter.close.kx - falling.shutter.open.kx - 2) < 1e-9);
  assert.equal(lookOf('rain', b).shutter, null);
  const twice = compiled([plane('street', 3), { ...rain, instances: () => [item('a', 2), item('a', 1.5)] }]).shot!;
  assert.throws(() => shotExposureItems(twice.instanced, twice.motion, exposure, paintCameraDepthLooks(twice.camera, 1)), /rain: two items are called a at 1 s/);
});

test("an instanced plane's load refuses what its items can't be drawn by, every problem at once", () => {
  const big = painting({ default: (): PaintingDocument => ({ ...drops.document, widthPx: 64 }) });
  assert.deepEqual(compiled([plane('street', 2), { ...instanced('rain', []), variants: { drop: layersOf(big, ['drop']) } }], { nodes: [{ id: 'rain' }], plays: [] }).problems.map(({ path, message }) => `${path}: ${message}`), [
    "rain.depths.far: 2.5 isn't nearer than the back, street at depth 2",
    'rain.variants.drop: paints a 64 × 32 document, and the stage is 52 × 44: a variant is laid whole on the stage',
    'rain.motion: is an instanced plane: its items take no nodes; each lies where its instances lay it',
  ]);
});
