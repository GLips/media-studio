import assert from 'node:assert/strict';
import { test } from 'node:test';
import { posedPrimitiveFigure, type PaintFigureView } from '#lib/paint/animation/models/figure/posed-primitive-figure.ts';
import { findSubjectFeature, findSubjectPart, type Subject } from './subject.ts';
import { selectPart, type SubjectSelector } from './subject-selector.ts';
import { definePrimitiveSubject } from './subject-primitive.ts';

// A head with an eye ball on its near side, and a pebble wholly behind the head.
const head = posedPrimitiveFigure({
  joints: { root: { at: [0, 0, 0] } },
  parts: {
    pebble: { primitives: [{ kind: 'ellipsoid', joint: 'root', at: [0, 0, -3], radii: [0.3, 0.3, 0.3] }] },
    skull: { primitives: [{ kind: 'ellipsoid', joint: 'root', radii: [1, 1, 1] }] },
    'eye-ball': { primitives: [{ kind: 'ellipsoid', joint: 'root', at: [0.3, 0.3, 0.85], radii: [0.25, 0.25, 0.25] }] },
  },
  anchors: { pupil: { joint: 'root', at: [0.33, 0.33, 1.05] } },
});
const headSubject = definePrimitiveSubject(head, {
  id: 'head',
  materials: [{ id: 'skin', localColor: '#c08060' }, { id: 'eye', localColor: '#202020' }],
  material: 'skin',
  tags: ['pebble', 'eye'],
  groups: ['face'],
  parts: { pebble: { tags: ['pebble'] } },
  regions: { 'eye-ball': { owner: 'skull', material: 'eye', groups: ['face'], tags: ['eye'] } },
  landmarks: { pupil: { anchor: 'pupil', owner: 'skull', groups: ['face'] } },
});
const view: PaintFigureView = { centre: { x: 200, y: 200 }, scale: 100 };

test('ids come from the figure and the binding, the same in every view, a hidden part and its landmark keeping theirs', () => {
  const near = headSubject({ view }), behind = headSubject({ view: { ...view, yaw: 180 } });
  for (const subject of [near, behind]) {
    assert.deepEqual([...subject.parts.keys()], ['pebble', 'skull']);
    assert.deepEqual([...subject.features.keys()], ['eye-ball', 'pebble-edge', 'skull-edge', 'eye-ball-edge', 'pupil']);
  }
  assert.equal(findSubjectPart(near, 'pebble')?.visibility.kind, 'hidden');
  assert.equal(findSubjectFeature(near, 'pupil')?.visibility.kind, 'visible');
  // From behind, the pebble is in front and the eye is round the far side: its region and its pupil are hidden.
  assert.equal(findSubjectPart(behind, 'pebble')?.visibility.kind, 'visible');
  assert.equal(findSubjectFeature(behind, 'eye-ball')?.visibility.kind, 'hidden');
  assert.equal(findSubjectFeature(behind, 'pupil')?.visibility.kind, 'hidden');
  type HeadIds = typeof near extends Subject<infer I> ? I : never;
  const skull: SubjectSelector<HeadIds> = selectPart('skull');
  // @ts-expect-error the eye ball is a feature of the skull, not a part
  const eyeAsPart: SubjectSelector<HeadIds> = selectPart('eye-ball');
  assert.notEqual(skull.id, eyeAsPart.id);
});

test('surface evidence carries the primitives\' own normals, facing the viewer at the middle and up the page at the top', () => {
  const subject = headSubject({ view, illumination: { convention: 'view-x-right-y-down-z-toward-viewer', key: { direction: { x: 0, y: -0.6, z: 0.8 }, intensity: 1 }, fills: [] } });
  assert.ok(subject.surface && subject.illumination);
  const { layout, normals } = subject.surface;
  const normalAt = (x: number, y: number) => {
    const at = Math.round((y - layout.y0) / layout.cell) * layout.columns + Math.round((x - layout.x0) / layout.cell);
    return [normals[3 * at], normals[3 * at + 1], normals[3 * at + 2]];
  };
  const [mx, my, mz] = normalAt(170, 230);
  assert.ok(Math.abs(mx) < 0.7 && Math.abs(my) < 0.7 && mz > 0.85, `the skull's front faces the viewer: ${[mx, my, mz].join(', ')}`);
  const [, ty] = normalAt(200, 104);
  assert.ok(ty < -0.9, `near the skull's top the normal points up the page: ${ty}`);
});
