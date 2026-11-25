import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnyApplication, LayerNode } from '#lib/paint/document/models/painting-document.ts';
import type { SurfaceEvidence } from '#lib/paint/subject/models/subject-evidence.ts';
import { SUBJECT_HIDDEN, subjectVisible, type SubjectRing } from '#lib/paint/subject/models/subject-geometry.ts';
import { selectFeatureGroup } from '#lib/paint/subject/models/subject-selector.ts';
import { defineSubject } from '#lib/paint/subject/models/subject.ts';
import { paintSubject, requireSubjectPainting, type SubjectPainting } from '../paint-subject.ts';
import { subjectReplace } from '../subject-overrides.ts';
import { lineSubjectPainter } from './line.ts';

const box = (x0: number, y0: number, x1: number, y1: number): SubjectRing => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/**
 * A box 400 px square: lid above, base below, meeting along y = 160, with eyes and a dark mouth on the base. `stated`
 * adds the lid's edge over the base as a projection states it.
 */
const lantern = (surface?: SurfaceEvidence, stated = false) => defineSubject({
  id: 'lantern',
  materials: [{ id: 'tin', localColor: '#c0a060' }, { id: 'white', localColor: '#f4f0e8' }, { id: 'ink', localColor: '#201810', preserveLocalColor: true }],
  parts: [
    { id: 'lid', material: 'tin', visibility: subjectVisible({ rings: [box(0, 0, 400, 160)] }) },
    { id: 'base', material: 'tin', visibility: subjectVisible({ rings: [box(0, 160, 400, 400)] }) },
  ],
  features: [
    { kind: 'region', id: 'eye-left', owner: 'base', material: 'white', groups: ['face'], visibility: subjectVisible({ rings: [box(100, 200, 160, 260)] }) },
    { kind: 'region', id: 'eye-right', owner: 'base', material: 'white', groups: ['face'], visibility: subjectVisible({ rings: [box(240, 200, 300, 260)] }) },
    { kind: 'region', id: 'mouth', owner: 'base', material: 'ink', groups: ['face'], visibility: subjectVisible({ rings: [box(160, 300, 240, 340)] }) },
    { kind: 'path', id: 'seam', owner: 'base', line: 'crease', visibility: subjectVisible({ runs: [{ points: [{ x: 20, y: 380 }, { x: 380, y: 380 }], closed: false }] }) },
    { kind: 'path', id: 'lid-edge', owner: 'lid', line: 'occluding-edge', visibility: stated ? subjectVisible({ runs: [{ points: [{ x: 0, y: 160 }, { x: 400, y: 160 }], closed: false }] }) : SUBJECT_HIDDEN },
  ],
  silhouette: subjectVisible({ rings: [box(0, 0, 400, 400)] }),
  ...(surface && { surface }),
});

/** The base sits 100 px nearer the eye than the lid, as if it leant forward over the lid's lower edge. */
const baseInFront = (): SurfaceEvidence => {
  const cell = 10, columns = 41, rows = 41;
  const depth = new Float32Array(columns * rows), normals = new Float32Array(columns * rows * 3);
  for (let k = 0; k < columns * rows; k++) {
    depth[k] = Math.floor(k / columns) * cell < 160 ? 300 : 200;
    normals[k * 3 + 2] = 1;
  }
  return { convention: 'view-x-right-y-down-z-toward-viewer', layout: { x0: 0, y0: 0, cell, columns, rows }, coverage: new Float32Array(columns * rows).fill(1), normals, depth };
};

const painter = lineSubjectPainter({ ink: { style: 'watercolor', brush: 'ink' }, pencil: { style: 'watercolor', brush: 'pencil' } });

const applicationsOf = (layers: readonly LayerNode[]): AnyApplication[] =>
  layers.flatMap((node) => ('children' in node && node.children ? applicationsOf(node.children) : (node.washes ?? []).flatMap(({ applications }) => applications)));

/** The keys of contributions whose strokes pass along the lid's lower edge, between the outline's corners. */
const inkingTheSeam = ({ report, layers }: SubjectPainting) => report.contributions.filter(({ key }) => applicationsOf(layers.filter((layer) => layer.key === key))
  .some((application) => application.kind === 'stroke' && application.subpaths.some((path) => path.some(({ x, y }) => Math.abs(y - 160) < 3 && x > 60 && x < 340))))
  .map(({ key }) => key);

test('it draws lines alone, inks a shared edge once, and spots only the dark mouth solid', () => {
  const result = requireSubjectPainting(paintSubject(lantern(), painter));
  const applications = applicationsOf(result.layers);
  assert.deepEqual(applications.filter(({ kind }) => kind !== 'stroke').map(({ key }) => key), ['lantern.line.feature:mouth.spot-black']);
  // Without depth the smaller part is taken to sit on the larger, so the lid inks the edge they share.
  assert.deepEqual(inkingTheSeam(result), ['lantern.contour.part:lid']);
  assert.deepEqual(result.report.contributions.map(({ slot, key }) => `${slot} ${key}`), [
    'contours lantern.contour.part:lid', 'contours lantern.contour.part:base',
    'features lantern.line.feature:eye-left', 'features lantern.line.feature:eye-right', 'features lantern.line.feature:mouth', 'features lantern.line.feature:seam',
  ]);
});

test('surface depth decides which part inks a shared edge, and an edge the subject states is inked from it alone', () => {
  assert.deepEqual(inkingTheSeam(requireSubjectPainting(paintSubject(lantern(baseInFront()), painter))), ['lantern.contour.part:base']);
  assert.deepEqual(inkingTheSeam(requireSubjectPainting(paintSubject(lantern(baseInFront(), true), painter))), ['lantern.line.feature:lid-edge']);
});

test('a face replaced in the features slot takes the face\'s lines and leaves the outlines and the crease', () => {
  const result = requireSubjectPainting(paintSubject(lantern(), painter, { tool: 'pencil' }, [subjectReplace(selectFeatureGroup('face'), {
    slot: 'features', paint: ({ paintKey }) => [{ key: paintKey('hand-face'), washes: [] }],
  })]));
  assert.deepEqual(result.layers.map(({ key }) => key), [
    'lantern.contour.part:lid', 'lantern.contour.part:base', 'lantern.line.feature:seam', 'lantern.replace.feature-group-face.features.hand-face',
  ]);
});
