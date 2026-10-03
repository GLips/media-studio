import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { shotMaskCheck, shotPathInkedLength, shotPathMaskCapsules, shotPathMaskCover } from './shot-masks.ts';
import { shotOccurrenceKey } from './shot-occurrences.ts';
import type { InstancedPlaneProps, PlaneMask, PlaneProps } from './shot-props.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { paintedSourceNodeKeys } from './shot-selection.ts';

test('a path mask reveals inked length: a pen-up adds none, a dot shows once reached, the band keeps its width to where the reveal ends', () => {
  const subpaths = [[{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 100, y: 0 }], [{ x: 20, y: 0 }, { x: 20, y: 10 }, { x: 20, y: 30 }], [{ x: 24, y: 32 }]];
  const runs = (revealPx: number) => shotPathMaskCapsules(subpaths, revealPx).map(({ a, b }) => `${a.x},${a.y}→${b.x},${b.y}`);
  assert.equal(shotPathInkedLength(subpaths), 40);
  assert.deepEqual(runs(0), []);
  assert.deepEqual(runs(5), ['0,0→5,0']);
  assert.deepEqual(runs(10), ['0,0→10,0', '100,0→100,0']);
  assert.deepEqual(runs(15), ['0,0→10,0', '100,0→100,0', '20,0→20,5']);
  // The whole inked length shows the closing full stop as well.
  assert.deepEqual(runs(shotPathInkedLength(subpaths)), ['0,0→10,0', '100,0→100,0', '20,0→20,10', '20,10→20,30', '24,32→24,32']);
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
const plane = (id: string, depth: number, masks: readonly PlaneMask[], keys = ['sky']): PlaneProps => ({ id, depth, masks, source: layersOf(pond, keys) });
const rain: InstancedPlaneProps = { kind: 'instanced', id: 'rain', depths: { near: 1, far: 1.5 }, variants: { drop: layersOf(pond, ['sky']) }, instances: () => [] };
const photo = (masks: readonly PlaneMask[]): PlaneProps => ({ id: 'photo', depth: 3, masks, source: { kind: 'picture', extent: { kind: 'everywhere' }, pictureAt: async () => null } });

/** Each painted plane's occurrences, as the shot's load finds them. */
const occurrencesOf = (planes: readonly (PlaneProps | InstancedPlaneProps)[]) => new Map(planes.flatMap((at): [string, string[]][] => {
  if (at.kind === 'instanced' || typeof at.source === 'function' || at.source.kind !== 'layers') return [];
  return [[at.id, paintedSourceNodeKeys(at.source).map((key) => shotOccurrenceKey(at.id, key))]];
}));

test('an alphaOf reads a plane or an occurrence of its shot, each read plane composited first', () => {
  const planes = [plane('back', 4, [reads('front/neck')]), plane('front', 2, [reads('rain'), reads('photo')], ['heron']), rain, photo([])];
  const { graph, problems } = shotMaskCheck(planes, occurrencesOf(planes));
  assert.deepEqual(problems, []);
  assert.deepEqual(graph?.order, ['rain', 'photo', 'front', 'back']);
  assert.deepEqual([...graph?.read ?? []], ['front/neck', 'rain', 'photo']);
});

test('a shot refuses an instanced item, a mask off painted films, a bad path and any chain of reads back to itself', () => {
  const planes = [
    plane('front', 2, [reads('rain/drop'), reads('nowhere')], ['heron']),
    rain,
    photo([reads('front')]),
    plane('loop-a', 3, [reads('loop-b')]),
    plane('loop-b', 3, [reads('loop-a/sky')]),
    plane('self', 3, [reads('self/sky'), { kind: 'path', subpaths: [], widthPx: 0, revealPx: -1 }]),
  ];
  const { graph, problems } = shotMaskCheck(planes, occurrencesOf(planes));
  assert.deepEqual(problems.map(({ path, message }) => `${path}: ${message}`), [
    "front.masks[0].drawable: names rain/drop, but rain's items aren't occurrences: read rain",
    'front.masks[1].drawable: names nowhere, which is no plane or occurrence of this shot',
    'photo.masks: masks cut painted films, and a picture plane has none',
    'self.masks[1].subpaths: a path mask needs a subpath',
    "self.masks[1].widthPx: 0; a band's width is above 0",
    'self.masks[1].revealPx: -1; a reveal is 0 px or more',
    'loop-a.masks[0].drawable: reads loop-b, whose mask reads loop-a/sky',
    'self.masks[0].drawable: reads self/sky, on self itself',
  ]);
  assert.equal(graph, null);
});
