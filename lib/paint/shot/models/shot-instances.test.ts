import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { lensSigmaStepped } from '#lib/picture/lens/models/lens-focus.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { paintCameraDepthLooks } from '#lib/paint/animation/models/paint-camera.ts';
import { paintSimilarityAfter, paintSimilarityApply } from '#lib/paint/animation/models/paint-similarity.ts';
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

/** The street behind the rain: the drop's painting on a document the frame's size, as a back is painted. */
const street = painting({ default: (): PaintingDocument => ({ ...drops.document, widthPx: 48, heightPx: 40 }) });

const item = (key: string, depth: number, variant = 'drop', x = 0): PlaneInstance => ({ key, variant, depth, lay: { placement: { x, y: 0, rotation: 0, scale: 1 }, pivot: { x: 8, y: 16 } } });
const instanced = (id: string, items: readonly PlaneInstance[]): InstancedPlaneProps => ({
  kind: 'instanced', id, depths: { near: 1, far: 2.5 }, variants: { drop: layersOf(drops, ['drop']), big: layersOf(drops, ['drop']) }, instances: () => items,
});
const plane = (id: string, depth: number): PlaneProps => ({ id, depth, source: layersOf(street, ['drop']) });

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

const camera: PaintedShotProps['camera'] = { stage: stampStage({ width: 48, height: 40 }, 2), fov: 35, lens: { bloom: 0, shutter: 0.02 }, animationFps: 24 };
const span: PaintedShotProps['span'] = { from: 0, to: 2, fps: 24 };
const compiled = (planes: PaintedShotProps['planes'], motion?: PaintedShotProps['motion']) => compilePaintedShot({ camera, span, planes, ...(motion && { motion }) }, []);

test("an exposure lays each item by its lay at its depth, blurred along its own travel only while its key spans the shutter", () => {
  const rain: InstancedPlaneProps = { ...instanced('rain', []), instances: ({ at }) => [item('a', 2, 'drop', 100 * at), item(`b${Math.round(at * 1000)}`, 1.5)] };
  const { shot, problems } = compiled([plane('street', 3), rain]);
  assert.deepEqual(problems, []);
  const exposure = { at: paintMoment(1), shutter: { open: paintMoment(0.99, 1), close: paintMoment(1.01, 1) } };
  const { items, lookOf } = shotExposureItems(shot!.instanced, shot!.motion, exposure, paintCameraDepthLooks(shot!.camera, 1));
  const [a, b] = items.get('rain')!, falling = lookOf('rain', a);
  // The drop's pivot, through its variant's picture and its view, lies where its lay puts it, as the camera sees depth 2.
  const pivot = paintSimilarityApply(paintSimilarityAfter(falling.view, shot!.instanced[0].variants.get('drop')!.picture), { x: 8, y: 16 });
  const laid = paintSimilarityApply(paintCameraDepthLooks(shot!.camera, 1).lookAt(2, 'the street').view, { x: 108, y: 16 });
  assert.ok(Math.abs(pivot.x - laid.x) < 1e-9 && Math.abs(pivot.y - laid.y) < 1e-9);
  assert.ok(falling.shutter && Math.abs(falling.shutter.close.kx - falling.shutter.open.kx - 2) < 1e-9);
  assert.equal(lookOf('rain', b).shutter, null);
  const twice = compiled([plane('street', 3), { ...rain, instances: () => [item('a', 2), item('a', 1.5)] }]).shot!;
  assert.throws(() => shotExposureItems(twice.instanced, twice.motion, exposure, paintCameraDepthLooks(twice.camera, 1)), /rain: two items are called a at 1 s/);
});

/** A drop at depth 1 under a camera focused at depth 3, its aperture `aperture`, and its items at rest. */
function focusedDrop(aperture: number) {
  const plays: PaintedShotProps['camera']['plays'] = [{ clip: { kind: 'focus', value: { focus: 3, aperture } }, clock: { at: 0 }, origin: 'the camera focuses on the street' }];
  const shot = compilePaintedShot({ camera: { ...camera, plays }, span, planes: [plane('street', 3), instanced('rain', [item('a', 1)])] }, []).shot!;
  return { shot, items: () => shotExposureItems(shot.instanced, shot.motion, { at: paintMoment(0), shutter: null }, paintCameraDepthLooks(shot.camera, 0)) };
}

test('a variant lies centred on the stage, and an item blurring it past the stage round it is refused', () => {
  const sharp = focusedDrop(0.5);
  // A 16 × 32 document on a 52 × 44 stage: 18 px either side, 6 above and below.
  assert.equal(sharp.shot.instanced[0].variants.get('drop')!.room, 6);
  assert.doesNotThrow(sharp.items);
  assert.throws(focusedDrop(2).items, /rain: a at 0 s blurs drop \d+ px past its document, and the stage leaves it 6/);
});

test("an instanced plane's load refuses what its items can't be drawn by, every problem at once", () => {
  const big = painting({ default: (): PaintingDocument => ({ ...drops.document, widthPx: 64 }) });
  assert.deepEqual(compiled([plane('street', 2), { ...instanced('rain', []), variants: { drop: layersOf(big, ['drop']) } }], { nodes: [{ id: 'rain' }] }).problems.map(({ path, message }) => `${path}: ${message}`), [
    "rain.depths.far: 2.5 isn't nearer than the back, street at depth 2",
    'rain.variants.drop: paints a 64 × 32 document, and the stage is 52 × 44: a variant is laid whole on the stage',
    'rain.motion: is an instanced plane: its items take no nodes; each lies where its instances lay it',
  ]);
});
