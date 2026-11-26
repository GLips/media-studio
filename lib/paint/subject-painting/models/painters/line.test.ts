import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnyApplication, LayerNode } from '#lib/paint/document/models/painting-document.ts';
import type { SurfaceEvidence } from '#lib/paint/subject/models/subject-evidence.ts';
import { SUBJECT_HIDDEN, subjectVisible, type SubjectRing } from '#lib/paint/subject/models/subject-geometry.ts';
import { selectFeatureGroup, selectPart } from '#lib/paint/subject/models/subject-selector.ts';
import { defineSubject } from '#lib/paint/subject/models/subject.ts';
import { paintSubject, requireSubjectPainting, type SubjectPainting } from '../paint-subject.ts';
import { subjectIntent, subjectReplace } from '../subject-overrides.ts';
import { lineSubjectPainter } from './line.ts';

/**
 * A box 400 px square: lid above, base below, meeting along y = 160, with eyes and a dark mouth on the base. `stated`
 * adds the lid's edge over the base as a projection states it; `at` moves it all.
 */
const lantern = (surface?: SurfaceEvidence, stated = false, at = { x: 0, y: 0 }) => {
  const box = (x0: number, y0: number, x1: number, y1: number): SubjectRing => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }].map(({ x, y }) => ({ x: x + at.x, y: y + at.y }));
  const run = (points: { x: number; y: number }[]) => ({ runs: [{ points: points.map(({ x, y }) => ({ x: x + at.x, y: y + at.y })), closed: false }] as const });
  return defineSubject({
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
      { kind: 'path', id: 'seam', owner: 'base', line: 'crease', visibility: subjectVisible(run([{ x: 20, y: 380 }, { x: 380, y: 380 }])) },
      { kind: 'path', id: 'lid-edge', owner: 'lid', line: 'occluding-edge', visibility: stated ? subjectVisible(run([{ x: 0, y: 160 }, { x: 400, y: 160 }])) : SUBJECT_HIDDEN },
    ],
    silhouette: subjectVisible({ rings: [box(0, 0, 400, 400)] }),
    ...(surface && { surface }),
  });
};

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
    'contour lantern.contour.part:lid', 'contour lantern.contour.part:base',
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

/** Every stroke point the painting lays, in document order. */
const strokePoints = (layers: readonly LayerNode[]) => applicationsOf(layers).flatMap((application) => (application.kind === 'stroke' ? application.subpaths.flat() : []));

test('a moved figure\'s strokes move with it: each run is seeded by its role and place round its target, not where it lies', () => {
  const still = strokePoints(requireSubjectPainting(paintSubject(lantern(), painter)).layers);
  const moved = strokePoints(requireSubjectPainting(paintSubject(lantern(undefined, false, { x: 37, y: 23 }), painter)).layers);
  assert.equal(moved.length, still.length);
  still.forEach((point, i) => {
    assert.ok(Math.abs(moved[i].x - point.x - 37) < 1e-6 && Math.abs(moved[i].y - point.y - 23) < 1e-6, `point ${i} moved off`);
    assert.ok(Math.abs((moved[i].scale ?? 1) - (point.scale ?? 1)) < 1e-9, `point ${i} rescaled`);
  });
});

test('overshoot runs each stroke on past the line\'s ends, and none stops short of them', () => {
  const seamXs = (overshoot: number) => strokePoints(requireSubjectPainting(paintSubject(lantern(), painter, { overshoot })).layers.filter(({ key }) => key === 'lantern.line.feature:seam'))
    .map(({ x }) => x);
  const plain = seamXs(0), inked = seamXs(3);
  assert.ok(Math.min(...plain) >= 19.5 && Math.max(...plain) <= 380.5);
  // Three widths of a 3.6 px line, each end between 0.6 and 1.2 of it.
  assert.ok(Math.min(...inked) < 20 - 6 && Math.max(...inked) > 380 + 6, `${Math.min(...inked)}..${Math.max(...inked)}`);
});

/** A band across the page, 400 px wide, from `y0` down to `y1`. */
const band = (y0: number, y1: number) => subjectVisible({ rings: [[{ x: 0, y: y0 }, { x: 400, y: y0 }, { x: 400, y: y1 }, { x: 0, y: y1 }]] as [SubjectRing] });

test('a stated occluding edge takes over only the stretch it covers: the next seam along is still inked', () => {
  const stack = defineSubject({
    id: 'stack',
    materials: [{ id: 'tin', localColor: '#c0a060' }],
    parts: [{ id: 'top', material: 'tin', visibility: band(0, 120) }, { id: 'middle', material: 'tin', visibility: band(120, 240) }, { id: 'bottom', material: 'tin', visibility: band(240, 400) }],
    features: [{ kind: 'path', id: 'top-edge', owner: 'top', line: 'occluding-edge', visibility: subjectVisible({ runs: [{ points: [{ x: 0, y: 120 }, { x: 400, y: 120 }], closed: false }] }) }],
    silhouette: band(0, 400),
  });
  const result = requireSubjectPainting(paintSubject(stack, painter));
  const inking = (seamY: number) => result.report.contributions.filter(({ key }) => applicationsOf(result.layers.filter((layer) => layer.key === key))
    .some((application) => application.kind === 'stroke' && application.subpaths.some((path) => path.some(({ x, y }) => Math.abs(y - seamY) < 3 && x > 60 && x < 340))))
    .map(({ key }) => key);
  assert.deepEqual(inking(120), ['stack.line.feature:top-edge']);
  assert.equal(inking(240).length, 1);
  assert.match(inking(240)[0], /^stack\.contour\.part:(middle|bottom)$/);
});

test('a silhouette facing the key thins but holds; a soft edge intent lets it break, lost and found', () => {
  const lit = { ...lantern(baseInFront()), illumination: { convention: 'view-x-right-y-down-z-toward-viewer' as const, key: { direction: { x: -0.36, y: -0.48, z: 0.8 }, intensity: 1 }, fills: [] } };
  /** The lid's contour strokes along the top edge, which faces the key at 0.8. */
  const topEdge = (result: SubjectPainting) => applicationsOf(result.layers.filter(({ key }) => key === 'lantern.contour.part:lid'))
    .flatMap((application) => (application.kind === 'stroke' ? application.subpaths.flat() : [])).filter(({ x, y }) => Math.abs(y) < 3 && x > 60 && x < 340);
  const plain = topEdge(requireSubjectPainting(paintSubject(lit, painter)));
  assert.ok(plain.length > 0, 'the lit top edge is inked');
  const shadowSide = applicationsOf(requireSubjectPainting(paintSubject(lit, painter)).layers).flatMap((application) => (application.kind === 'stroke' ? application.subpaths.flat() : []))
    .filter(({ x, y }) => Math.abs(y - 400) < 3 && x > 60 && x < 340);
  assert.ok(Math.max(...plain.map(({ scale }) => scale ?? 1)) < Math.max(...shadowSide.map(({ scale }) => scale ?? 1)), 'the lit edge is the thinner');
  assert.equal(topEdge(requireSubjectPainting(paintSubject(lit, painter, {}, [subjectIntent(selectPart('lid'), { edge: 'soft' })]))).length, 0);
});

test('a dark part\'s spot black is its own fill, under the outlines, and a pupil\'s stays with its feature', () => {
  const dark = requireSubjectPainting(paintSubject(lantern(), painter, {}, [subjectIntent(selectPart('lid'), { localColor: '#101010' })]));
  assert.deepEqual(dark.report.contributions.map(({ slot, key }) => `${slot} ${key}`).slice(0, 3), [
    'fill lantern.fill.part:lid', 'contour lantern.contour.part:lid', 'contour lantern.contour.part:base',
  ]);
  assert.deepEqual(applicationsOf(dark.layers.filter(({ key }) => key === 'lantern.fill.part:lid')).map(({ kind }) => kind), ['fill']);
  assert.ok(applicationsOf(dark.layers.filter(({ key }) => key === 'lantern.contour.part:lid')).every(({ kind }) => kind === 'stroke'));
});
