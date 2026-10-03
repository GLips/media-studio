import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { lensSigmaStepped } from '#lib/picture/lens/models/lens-focus.ts';
import { shotDrawables, shotDrawSteps, shotInstanceProblems, shotInstanceTravel, shotInstancedPlaneProblems } from './shot-instances.ts';
import type { InstancedPlaneProps, PlaneInstance, PlaneProps } from './shot-props.ts';
import { layersOf } from './shot-selection.ts';

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
  const drawables = shotDrawables(planes, new Map([['rain', rain.instances({ at: 0, frame: 0 })], ['mist', mist.instances({ at: 0, frame: 0 })]]));
  assert.deepEqual(drawables.map((drawable) => (drawable.kind === 'plane' ? drawable.plane : `${drawable.plane}:${drawable.item.key}`)), [
    'street', 'rain:c', 'sign', 'rain:a', 'rain:b', 'mist:m', 'rain:d',
  ]);
  const steps = shotDrawSteps(drawables, (depth) => (depth < 1.5 ? 4.1 : 0));
  assert.deepEqual(steps.map((step) => (step.kind === 'plane' ? step.plane : `${step.plane} ${step.variant} σ${step.sigma.toFixed(2)}: ${step.items.map(({ key }) => key).join(' ')}`)), [
    'street', 'rain big σ0.00: c', 'sign', 'rain drop σ0.00: a b', 'mist drop σ0.00: m', `rain drop σ${lensSigmaStepped(4.1).toFixed(2)}: d`,
  ]);
});

test('an item blurs along its own travel only when the shutter sees its key at both ends, and a frame refuses what it can\'t draw', () => {
  const travel = shotInstanceTravel([item('a', 2), item('b', 2)], [item('b', 2, 'drop', 6), item('c', 2)]);
  assert.deepEqual([...travel].map(([key, { open, close }]) => [key, open.lay.placement.x, close.lay.placement.x]), [['b', 0, 6]]);
  const rain = instanced('rain', []);
  assert.deepEqual(shotInstanceProblems(rain, [item('a', 2), item('a', 3, 'hail')], 2.04).map(({ path, message }) => `${path}: ${message}`), [
    'rain: two items are called a at 2.04 s',
    "rain: a at 2.04 s lays hail, which isn't one of rain's variants",
    "rain: a at 2.04 s lies at depth 3, outside rain's depths 1..2.5",
  ]);
  assert.deepEqual(shotInstancedPlaneProblems(rain, { id: 'street', depth: 2 }).map(({ path, message }) => `${path}: ${message}`), [
    "rain.depths.far: 2.5 isn't nearer than the back, street at depth 2",
  ]);
});
