import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { shotMaskCheck } from './shot-masks.ts';
import { paintedSourceNodeKeys, shotOccurrenceKey } from './shot-occurrences.ts';
import type { InstancedPlaneProps, PlaneMask, PlaneProps } from './shot-props.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';

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

const reads = (drawable: string): PlaneMask => ({ kind: 'alphaOf', drawable });
const plane = (id: string, depth: number, masks: readonly PlaneMask[], keys = ['sky']): PlaneProps => ({ id, depth, masks, source: layersOf(pond, keys) });
const rain: InstancedPlaneProps = { kind: 'instanced', id: 'rain', depths: { near: 1, far: 1.5 }, variants: { drop: layersOf(pond, ['sky']) }, instances: () => [] };
const photo = (masks: readonly PlaneMask[]): PlaneProps => ({ id: 'photo', depth: 3, masks, source: { kind: 'picture', extent: { kind: 'everywhere' }, pictureAt: async () => null } });

/** Each painted plane's occurrences, as the shot's load finds them. */
const occurrencesOf = (planes: readonly (PlaneProps | InstancedPlaneProps)[]) => new Map(planes.flatMap((at): [string, string[]][] => {
  if (at.kind === 'instanced' || typeof at.source === 'function' || at.source.kind !== 'layers') return [];
  return [[at.id, paintedSourceNodeKeys(at.source).map((key) => shotOccurrenceKey(at.id, key))]];
}));

test('an alphaOf reads a plane or an occurrence of its shot', () => {
  const planes = [plane('back', 4, [reads('front/neck')]), plane('front', 2, [reads('rain'), reads('photo')], ['heron']), rain, photo([])];
  const { graph, problems } = shotMaskCheck(planes, occurrencesOf(planes));
  assert.deepEqual(problems, []);
  assert.deepEqual([...graph?.read ?? []], ['front/neck', 'rain', 'photo']);
});

test('a shot refuses an instanced item, a mask off painted films and any chain of reads back to itself', () => {
  const planes = [
    plane('front', 2, [reads('rain/drop'), reads('nowhere')], ['heron']),
    rain,
    photo([reads('front')]),
    plane('loop-a', 3, [reads('loop-b')]),
    plane('loop-b', 3, [reads('loop-a/sky')]),
    plane('self', 3, [reads('self/sky')]),
  ];
  const { graph, problems } = shotMaskCheck(planes, occurrencesOf(planes));
  assert.deepEqual(problems.map(({ path, message }) => `${path}: ${message}`), [
    "front.masks[0].drawable: names rain/drop, but rain's items aren't occurrences: read rain",
    'front.masks[1].drawable: names nowhere, which is no plane or occurrence of this shot',
    'photo.masks: masks cut painted films, and a picture plane has none',
    'loop-a.masks[0].drawable: reads loop-b, whose mask reads loop-a/sky',
    'self.masks[0].drawable: reads self/sky, on self itself',
  ]);
  assert.equal(graph, null);
});
