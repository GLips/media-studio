import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Application, DirectApplication, Layer, PaintingDocument } from './painting-document.ts';
import { paintingSheetOrders } from './painting-sheet-program.ts';
import { painting } from './painting-source.ts';

/** A dab of paint, which a wet wash and a direct one alike may lay. */
const touch = (seed: string): Application & DirectApplication => ({
  kind: 'stamps', placements: [{ x: 60, y: 60 }], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 30, seed,
  charge: { kind: 'paint', mix: { parts: [{ pigment: '#4a5a7b', amount: 1 }], strength: 0.5 } },
});
const DRYING = 0.025;

/** Shallows (a dry ground, a clocked pool, a glaze once the pool has set) and, in a group, a heron's foot charging into them. */
const shallows: Layer = {
  key: 'shallows', washes: [
    { key: 'ground', applications: [touch('ground')] },
    { key: 'pool', clock: { origin: 0, dryingScale: DRYING }, applications: [touch('pool'), { ...touch('ripple'), at: 2 }] },
    { key: 'pool-glaze', clock: { origin: 'set', dryingScale: DRYING }, applications: [touch('glaze')] },
  ],
};
const foot: Layer = { key: 'foot', washes: [{ key: 'foot-wash', clock: { origin: 0.5, dryingScale: DRYING }, applications: [touch('charge'), { ...touch('step'), at: 2 }] }] };

test("a sheet's order: the unclocked run, then every layer's clocked applications by order time, ties in document order", () => {
  const pond = painting({
    default: function pond(): PaintingDocument {
      return { widthPx: 200, heightPx: 200, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', layers: [shallows, { key: 'heron', children: [foot] }] };
    },
  });
  const [root] = paintingSheetOrders(pond.tree);
  assert.deepEqual(root.clock, { kind: 'scale', scale: DRYING, origin: 0 });
  const slots = { palette: ['color:#4a5a7b'], paintLayers: 1, open: 3 };
  assert.deepEqual(root.layers, [{ layer: 0, medium: 'watercolour', slots }, { layer: 1, medium: 'watercolour', slots }]);
  assert.deepEqual(root.entries.map(({ layer, wash, application, chain, orderTime }) => [layer, wash, application, chain, orderTime]), [
    [0, 0, 0, [0], null],
    [0, 1, 0, [0], 0],
    [1, 0, 0, [1, 2], 0.5],
    [0, 1, 1, [0], 2],
    [0, 2, 0, [0], 2],
    [1, 0, 1, [1, 2], 2],
  ]);
});

test("a sheet's clock runs from its earliest clocked start, a direct wash's too; `'set'` waits for an empty clocked wash", () => {
  const study = painting({
    default: function study(): PaintingDocument {
      return {
        widthPx: 200, heightPx: 200, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', layers: [{
          key: 'study', washes: [
            { key: 'sketch', wetHistory: false, clock: { origin: 1, dryingScale: 'instant' }, applications: [touch('sketch')] },
            { key: 'hold', clock: { origin: 3, dryingScale: DRYING }, applications: [] },
            { key: 'flood', clock: { origin: 'set', dryingScale: DRYING }, applications: [touch('flood')] },
          ],
        }],
      };
    },
  });
  const [root] = paintingSheetOrders(study.tree);
  assert.deepEqual(root.clock, { kind: 'scale', scale: DRYING, origin: 1 });
  assert.deepEqual(root.entries.map(({ wash, orderTime }) => [wash, orderTime]), [[0, 1], [2, 3]]);
});
