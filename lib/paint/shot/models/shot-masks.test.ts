import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { shotMaskGraph, shotPathInkedLength, shotPathMaskCapsules, shotPathMaskCover } from './shot-masks.ts';
import type { InstancedPlaneProps, PlaneMask, PlaneProps } from './shot-props.ts';
import { layersOf, paintedSourceNodeKeys } from './shot-selection.ts';

test('a path mask reveals inked length: a pen-up adds none, the band keeps its width to where the reveal ends', () => {
  const subpaths = [[{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 100, y: 0 }], [{ x: 20, y: 0 }, { x: 20, y: 10 }, { x: 20, y: 30 }]];
  const runs = (revealPx: number) => shotPathMaskCapsules(subpaths, revealPx).map(({ a, b }) => `${a.x},${a.y}→${b.x},${b.y}`);
  assert.equal(shotPathInkedLength(subpaths), 40);
  assert.deepEqual(runs(0), []);
  assert.deepEqual(runs(5), ['0,0→5,0']);
  assert.deepEqual(runs(10), ['0,0→10,0']);
  assert.deepEqual(runs(15), ['0,0→10,0', '100,0→100,0', '20,0→20,5']);
  assert.deepEqual(runs(Infinity), ['0,0→10,0', '100,0→100,0', '20,0→20,10', '20,10→20,30']);
  assert.deepEqual([3, 4.5, 5.5].map((distance) => shotPathMaskCover(distance, 10, 1)), [1, 0.5, 0]);
});

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

test('an alphaOf reads a plane or an occurrence of its shot, and no mask reads itself through any chain', () => {
  const plane = (id: string, depth: number, masks: readonly PlaneMask[], keys = ['sky']): PlaneProps => ({ id, depth, masks, source: layersOf(pond, keys) });
  const rain: InstancedPlaneProps = { kind: 'instanced', id: 'rain', depths: { near: 1, far: 1.5 }, variants: { drop: layersOf(pond, ['sky']) }, instances: () => [] };
  const planes = [
    plane('back', 4, [reads('front/neck')]),
    plane('front', 2, [reads('rain'), reads('rain/drop'), reads('nowhere')], ['heron']),
    rain,
    { id: 'photo', depth: 3, masks: [reads('back')], source: { kind: 'picture', extent: { kind: 'everywhere' }, pictureAt: async () => null } } satisfies PlaneProps,
    plane('loop-a', 3, [reads('loop-b')]),
    plane('loop-b', 3, [reads('loop-a/sky')]),
    plane('self', 3, [reads('self/sky'), { kind: 'path', subpaths: [], widthPx: 0, revealPx: -1 }]),
  ];
  const occurrences = new Map(planes.flatMap((at): [string, string[]][] => {
    if (at.kind === 'instanced' || typeof at.source === 'function' || at.source.kind !== 'layers') return [];
    return [[at.id, paintedSourceNodeKeys(at.source).map((key) => `${at.id}/${key}`)]];
  }));
  const { order, read, problems } = shotMaskGraph(planes, occurrences);
  assert.deepEqual(problems.map(({ path, message }) => `${path}: ${message}`), [
    "front.masks[1].drawable: names rain/drop, but rain's items aren't occurrences: read rain",
    'front.masks[2].drawable: names nowhere, which is no plane or occurrence of this shot',
    'photo.masks: masks cut painted films, and a picture plane has none',
    'self.masks[1].subpaths: a path mask needs a subpath',
    "self.masks[1].widthPx: 0; a band's width is above 0",
    'self.masks[1].revealPx: -1; a reveal is 0 px or more',
    'loop-a.masks[0].drawable: reads loop-b, whose mask reads loop-a/sky',
    'self.masks[0].drawable: reads self/sky, on self itself',
  ]);
  assert.deepEqual(order, ['rain', 'front', 'back', 'photo', 'loop-b', 'loop-a', 'self']);
  assert.deepEqual([...read], ['front/neck', 'rain', 'loop-b', 'loop-a/sky', 'self/sky']);
});
