import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { shotOccurrenceKey } from './shot-occurrences.ts';
import type { InstancedPlaneProps, PlaneProps } from './shot-props.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { paintedSourceNodeKeys } from './shot-selection.ts';
import { shotIsolatedGroups, shotVisibilityProblem, shotVisibilityProblems } from './shot-visibility.ts';

/** A layer of one stroke, keyed `key`. */
const stroke = (key: string) => ({
  key, washes: [{
    key: `${key}-wash`, applications: [{
      kind: 'stroke', subpaths: [[{ x: 10, y: 10 }, { x: 90, y: 40 }]], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 12, seed: key,
      charge: { kind: 'paint', mix: { parts: [{ pigment: '#3a4a6b', amount: 1 }], strength: 0.5 } },
    }],
  }],
} as const);

/** A sky behind a heron of body and neck. */
const pond = painting({
  default: function pond(): PaintingDocument {
    return { widthPx: 120, heightPx: 80, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', layers: [stroke('sky'), { key: 'heron', children: [stroke('body'), stroke('neck')] }] };
  },
});

test('visibility names planes and occurrences, never an item, within 0..1; a faded, read or rigged group draws on its own', () => {
  const source = layersOf(pond, ['sky', 'heron']), meadow: PlaneProps = { id: 'meadow', depth: 3, source };
  const rain: InstancedPlaneProps = { kind: 'instanced', id: 'rain', depths: { near: 1, far: 2 }, variants: { drop: layersOf(pond, ['sky']) }, instances: () => [] };
  const occurrences = new Map([['meadow', paintedSourceNodeKeys(source).map((key) => shotOccurrenceKey('meadow', key))]]);
  const visibility = { 'meadow/heron': 0.5, 'meadow/sky': () => 1, rain: 0.8, 'rain/drop-3': 1, 'meadow/hil': 1, meadow: 1.5 };
  assert.deepEqual(shotVisibilityProblems(visibility, [meadow, rain], occurrences).map(({ path, message }) => `${path}: ${message}`), [
    "rain/drop-3.visibility: fades an item of rain, which isn't an occurrence: set the item's own visibility in rain's instances",
    'meadow/hil.visibility: names no plane or occurrence of this shot',
    'meadow.visibility: 1.5; visibility is within 0..1',
  ]);
  assert.equal(shotVisibilityProblem('meadow/sky', -0.2, 2.5)?.message, '-0.2 at 2.5 s; visibility is within 0..1');
  const groups = ['meadow/heron', 'back/heron', 'front/heron', 'side/heron'];
  assert.deepEqual(shotIsolatedGroups(groups, new Map([['meadow/heron', 0.5], ['back/heron', 1]]), new Set(['front/heron']), new Set(['side/heron'])), [
    'meadow/heron', 'front/heron', 'side/heron',
  ]);
});
