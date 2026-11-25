import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SUBJECT_HIDDEN, subjectVisible } from './subject-geometry.ts';
import { checkSubject, defineSubject } from './subject.ts';

const square = (x: number, size: number, y = 0) => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];

test('a subject with an unknown material, a repeated part, crossing rings and a visible feature on a hidden part is refused, each by its code', () => {
  const result = checkSubject({
    id: 'clapper',
    materials: [{ id: 'slate', localColor: '#202020' }],
    parts: [
      { id: 'slate', material: 'slate', visibility: subjectVisible({ rings: [square(0, 20), square(10, 20, 5)] }) },
      { id: 'slate', material: 'slate', visibility: SUBJECT_HIDDEN },
      // @ts-expect-error: no material 'stripe' is declared.
      { id: 'arm', material: 'stripe', visibility: SUBJECT_HIDDEN },
    ],
    features: [{ kind: 'landmark', id: 'eye', owner: 'arm', visibility: subjectVisible({ at: { x: 1, y: 1 } }) }],
    silhouette: subjectVisible({ rings: [square(0, 30)] }),
  });
  assert.ok(!result.ok);
  assert.deepEqual(result.diagnostics.map(({ code, address }) => [code, address]), [
    ['duplicate-id', 'parts[1]'],
    ['invalid-geometry', 'part:slate.visibility.geometry.rings[0]'],
    ['unknown-ref', 'part:arm.material'],
    ['invalid-ownership', 'feature:eye'],
  ]);
});

test('a face frame follows its landmarks, and is unavailable, with its reason, when one is hidden', () => {
  const faceWith = (rightEye: boolean) => defineSubject({
    id: 'frog',
    materials: [{ id: 'skin', localColor: '#5a8f3c' }],
    parts: [{ id: 'head', material: 'skin', visibility: subjectVisible({ rings: [square(0, 40)] }) }],
    features: [
      { kind: 'landmark', id: 'eye-left', owner: 'head', visibility: subjectVisible({ at: { x: 10, y: 10 } }) },
      { kind: 'landmark', id: 'eye-right', owner: 'head', visibility: rightEye ? subjectVisible({ at: { x: 30, y: 10 } }) : SUBJECT_HIDDEN },
    ],
    frames: [{ id: 'face', owner: 'head', from: { kind: 'landmarks', left: 'eye-left', right: 'eye-right' } }],
    silhouette: subjectVisible({ rings: [square(0, 40)] }),
  }).frames.values().next().value?.status;
  assert.deepEqual(faceWith(true), { kind: 'available', basis: { origin: { x: 20, y: 10 }, xAxis: { x: 10, y: 0 }, yAxis: { x: -0, y: 10 } } });
  assert.deepEqual(faceWith(false), { kind: 'unavailable', reason: 'landmark eye-right is hidden' });
});
