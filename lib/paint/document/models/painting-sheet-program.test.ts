import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Application, Layer, PaintingDocument } from './painting-document.ts';
import { paintingSheetOrders } from './painting-sheet-program.ts';
import { painting } from './painting-source.ts';

const touch = (seed: string): Application => ({
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
  const [root] = paintingSheetOrders(pond.sheets);
  assert.deepEqual(root.clock, { kind: 'scale', scale: DRYING, origin: 0 });
  assert.deepEqual(root.entries.map(({ layer, wash, application, chain, orderTime }) => [layer, wash, application, chain, orderTime]), [
    [0, 0, 0, [], null],
    [0, 1, 0, [], 0],
    [1, 0, 0, [0], 0.5],
    [0, 1, 1, [], 2],
    [0, 2, 0, [], 2],
    [1, 0, 1, [0], 2],
  ]);
});
