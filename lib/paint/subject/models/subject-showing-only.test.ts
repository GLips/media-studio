import assert from 'node:assert/strict';
import { test } from 'node:test';
import { subjectAreaBox, subjectVisible, type SubjectArea } from './subject-geometry.ts';
import { selectTag } from './subject-selector.ts';
import { subjectShowingOnly } from './subject-showing-only.ts';
import { defineSubject } from './subject.ts';

const box = (x0: number, y0: number, x1: number, y1: number) => subjectVisible<SubjectArea>({ rings: [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]] });

/** The ids in `map` that show. */
const shown = (map: ReadonlyMap<string, { readonly visibility: { readonly kind: string } }>) => [...map].filter(([, { visibility }]) => visibility.kind === 'visible').map(([id]) => id);

test('a subject showing only its hand hides the body, its features and its frames, and outlines the hand alone', () => {
  const figure = defineSubject({
    id: 'waver',
    materials: [{ id: 'skin', localColor: '#c08060' }],
    parts: [
      { id: 'body', material: 'skin', visibility: box(0, 0, 40, 60) },
      { id: 'arm', material: 'skin', tags: ['hand'], visibility: box(40, 10, 70, 18) },
      { id: 'glove', material: 'skin', tags: ['hand'], visibility: box(70, 4, 84, 22) },
    ],
    features: [
      { kind: 'landmark', id: 'eye-left', owner: 'body', visibility: subjectVisible({ at: { x: 10, y: 10 } }) },
      { kind: 'landmark', id: 'eye-right', owner: 'body', visibility: subjectVisible({ at: { x: 30, y: 10 } }) },
      { kind: 'path', id: 'curls', owner: 'glove', line: 'authored', visibility: subjectVisible({ runs: [{ points: [{ x: 72, y: 8 }, { x: 80, y: 8 }], closed: false }] }) },
    ],
    frames: [{ id: 'face', owner: 'body', from: { kind: 'landmarks', left: 'eye-left', right: 'eye-right' } }],
    silhouette: box(0, 0, 84, 60),
  });
  const result = subjectShowingOnly(figure, [selectTag('hand')]);
  assert.ok(result.ok);
  const hand = result.value;
  assert.deepEqual(shown(hand.parts), ['arm', 'glove']);
  assert.deepEqual(shown(hand.features), ['curls']);
  assert.equal([...hand.frames.values()][0].status.kind, 'unavailable');
  assert.ok(hand.silhouette.kind === 'visible');
  const { x0, y0, x1, y1 } = subjectAreaBox(hand.silhouette.geometry);
  assert.ok(Math.abs(x0 - 40) <= 1 && Math.abs(x1 - 84) <= 1 && Math.abs(y0 - 4) <= 1 && Math.abs(y1 - 22) <= 1, `the silhouette spans ${x0}..${x1} × ${y0}..${y1}`);
});
