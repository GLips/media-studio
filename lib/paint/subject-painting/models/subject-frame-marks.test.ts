import assert from 'node:assert/strict';
import { test } from 'node:test';
import { subjectVisible, SUBJECT_HIDDEN } from '#lib/paint/subject/models/subject-geometry.ts';
import { defineSubject, findSubjectFrame, findSubjectPart } from '#lib/paint/subject/models/subject.ts';
import { drawingSchedule } from '#lib/timing/drawings/models/drawing-schedule.ts';
import { subjectFrameMarks } from './subject-frame-marks.ts';
import { subjectPaintKey } from './subject-painter.ts';

const outline = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }];
const hole = [{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 2, y: 6 }];
const visible = subjectVisible({ rings: [outline, hole] as const });
const basis = { origin: { x: 4, y: 4 }, xAxis: { x: 4, y: 0 }, yAxis: { x: 0, y: 4 } };
const card = defineSubject({
  id: 'hero', materials: [{ id: 'paper', localColor: '#ffffff' }], parts: [{ id: 'card', material: 'paper', visibility: visible }],
  silhouette: visible, frames: [{ id: 'front', owner: 'card', from: { kind: 'projected', status: { kind: 'available', basis } } }],
});
const frame = findSubjectFrame(card, 'front')!;
const cardPart = findSubjectPart(card, 'card')!;
const key = subjectPaintKey(card.id, [cardPart.ref, 'fill', 'green']);
const schedule = drawingSchedule({ fps: 2 });
const path = (random: () => number) => [{ x: -1, y: random() }, { x: 1, y: -random() }];

test('a new drawing changes the stroke under the same document key and seeking back restores it', () => {
  const draw = (time: number) => subjectFrameMarks(frame, visible, key, schedule.at(time).token, path)[0];
  const next = draw(0.5), first = draw(0);
  assert.equal(first.key, next.key);
  assert.notDeepEqual(first.subpaths, next.subpaths);
  assert.deepEqual(draw(0.7), next);
});

test('the brush clips to the plane and the owner including holes; absent surfaces drop the application', () => {
  const [stroke] = subjectFrameMarks(frame, visible, key, 'held', path);
  assert.deepEqual(stroke.clips, [{ region: { kind: 'polygon', rings: [outline] } }, { region: { kind: 'polygon', rings: [outline, hole] } }]);
  assert.deepEqual(subjectFrameMarks(frame, SUBJECT_HIDDEN, key, 'held', path), []);
  assert.deepEqual(subjectFrameMarks({ ...frame, status: { kind: 'unavailable', reason: 'edge-on' } }, visible, key, 'held', path), []);
});
