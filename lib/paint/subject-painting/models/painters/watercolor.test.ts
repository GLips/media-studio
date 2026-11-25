import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LayerNode } from '#lib/paint/document/models/painting-document.ts';
import type { SurfaceEvidence } from '#lib/paint/subject/models/subject-evidence.ts';
import { SUBJECT_HIDDEN, subjectVisible, type SubjectArea } from '#lib/paint/subject/models/subject-geometry.ts';
import { selectFeatureGroup, selectPart } from '#lib/paint/subject/models/subject-selector.ts';
import { defineSubject } from '#lib/paint/subject/models/subject.ts';
import { paintSubject, requireSubjectPainting, type SubjectOverridesFor, type SubjectPainting } from '../paint-subject.ts';
import { subjectReplace, subjectTune } from '../subject-overrides.ts';
import { subjectLayerDocumentKeys } from '../subject-painting-report.ts';
import { gouacheSubjectPainter } from './gouache.ts';
import { watercolorSubjectPainter } from './watercolor.ts';

const rect = (x0: number, y0: number, x1: number, y1: number): SubjectArea => ({ rings: [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]] });

/** A ball's surface over 160 px square, as a projection would sample it: every area below lies on it. */
function ballSurface(): SurfaceEvidence {
  const cell = 4, columns = 41, rows = 41, size = columns * rows;
  const coverage = new Float32Array(size), normals = new Float32Array(3 * size), depth = new Float32Array(size);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const at = j * columns + i, x = (i * cell - 80) / 100, y = (j * cell - 80) / 100, r = Math.hypot(x, y);
      coverage[at] = 100 * (1 - r);
      if (r >= 1) continue;
      const z = Math.sqrt(1 - r * r);
      normals.set([x, y, z], 3 * at);
      depth[at] = 200 - 100 * z;
    }
  }
  return { convention: 'view-x-right-y-down-z-toward-viewer', layout: { x0: 0, y0: 0, cell, columns, rows }, coverage, normals, depth };
}

const keyLight = { x: -0.5, y: -0.6, z: 0.62 }, keyLength = Math.hypot(keyLight.x, keyLight.y, keyLight.z);

/** A frog of rectangles on a ball's surface, lit from the top left; its arm is on the far side, or hidden; `spot` adds a pale face marking. */
const frog = (armShows = true, spot = false) => defineSubject({
  id: 'frog',
  materials: [{ id: 'skin', localColor: '#5e9b3c' }, { id: 'ink', localColor: '#1a1a1a', preserveLocalColor: true }, { id: 'cream', localColor: '#f4ecd0' }],
  parts: [
    { id: 'body', material: 'skin', visibility: subjectVisible(rect(20, 60, 140, 110)) },
    { id: 'belly', material: 'skin', tags: ['belly'], visibility: subjectVisible(rect(40, 110, 120, 140)) },
    { id: 'head', material: 'skin', visibility: subjectVisible(rect(40, 15, 120, 60)) },
    { id: 'arm', material: 'skin', side: 'far', visibility: armShows ? subjectVisible(rect(140, 70, 152, 100)) : SUBJECT_HIDDEN },
  ],
  features: [
    { kind: 'landmark', id: 'eye-left', owner: 'head', groups: ['face'], tags: ['eye'], visibility: subjectVisible({ at: { x: 60, y: 30 } }) },
    { kind: 'landmark', id: 'eye-right', owner: 'head', groups: ['face'], tags: ['eye'], visibility: subjectVisible({ at: { x: 100, y: 30 } }) },
    { kind: 'region', id: 'mouth', owner: 'head', material: 'ink', groups: ['face'], visibility: subjectVisible(rect(70, 45, 90, 52)) },
    { kind: 'region', id: 'spot', owner: 'head', material: 'cream', groups: ['face'], visibility: spot ? subjectVisible(rect(50, 36, 62, 44)) : SUBJECT_HIDDEN },
    { kind: 'path', id: 'brow', owner: 'head', groups: ['face'], line: 'authored', visibility: subjectVisible({ runs: [{ points: [{ x: 55, y: 22 }, { x: 65, y: 20 }], closed: false }] }) },
  ],
  frames: [{ id: 'face', owner: 'head', from: { kind: 'landmarks', left: 'eye-left', right: 'eye-right' } }],
  silhouette: subjectVisible({ rings: [[{ x: 20, y: 15 }, { x: 152, y: 15 }, { x: 152, y: 140 }, { x: 20, y: 140 }]] }),
  surface: ballSurface(),
  illumination: { convention: 'view-x-right-y-down-z-toward-viewer', key: { direction: { x: keyLight.x / keyLength, y: keyLight.y / keyLength, z: keyLight.z / keyLength }, intensity: 1 }, fills: [] },
});

const brush = (name: string) => ({ style: 'test', brush: name });
const watercolor = watercolorSubjectPainter({
  brushes: { wash: brush('wash'), wet: brush('wet'), mark: brush('mark'), texture: brush('texture'), detail: brush('detail'), line: brush('line') },
  pigments: { cool: '#3050a0', warm: '#6a4a30', sky: '#5090c0' },
});
const gouache = gouacheSubjectPainter({ brushes: { block: brush('block'), detail: brush('detail') }, paperColor: '#f6efde' });

const formOf = ({ report }: SubjectPainting) => report.contributions.find(({ key }) => key === 'frog.form')?.targets;
/** Every footprint the frog's form layer keeps clear. */
const formReservesOf = (result: SubjectPainting) => result.layers.filter(({ key }) => key === 'frog.form')
  .flatMap((layer) => ('washes' in layer ? (layer.washes ?? []).flatMap(({ applications }) => applications) : [])).flatMap((application) => ('reserves' in application ? application.reserves ?? [] : []));
const handLayer = (name: string): LayerNode => ({ key: name, washes: [] });
const documentKeys = (layers: readonly LayerNode[]) => new Set(subjectLayerDocumentKeys(layers));

type Frog = ReturnType<typeof frog>;
/** Each painter paints the frog with the overrides both painters accept: their shared slots and controls. */
const painters = {
  watercolor: (subject: Frog, overrides: SubjectOverridesFor<Frog, typeof watercolor> = []) => requireSubjectPainting(paintSubject(subject, watercolor, {}, overrides)),
  gouache: (subject: Frog, overrides: SubjectOverridesFor<Frog, typeof gouache> = []) => requireSubjectPainting(paintSubject(subject, gouache, {}, overrides)),
};

for (const [name, paint] of Object.entries(painters)) {
  test(`${name}: a part painted by hand leaves the shared wash and the light, which keep their keys, and sits over the light`, () => {
    const plain = paint(frog());
    const result = paint(frog(), [subjectReplace(selectPart('belly'), { slot: 'all', paint: ({ paintKey }) => [handLayer(paintKey('glaze'))] })]);
    assert.deepEqual(formOf(plain), ['part:body', 'part:belly', 'part:head', 'part:arm']);
    assert.deepEqual(formOf(result), ['part:body', 'part:head', 'part:arm']);
    assert.ok(!result.report.contributions.some(({ targets }) => targets.includes('part:belly')));
    // The light was read from the ball's normals, and replanned without the belly under the same keys.
    assert.ok(documentKeys(result.layers).has('frog.light.shade.material:skin'));
    assert.deepEqual(result.report.contributions.map(({ key }) => key), plain.report.contributions.map(({ key }) => key));
    const order = result.layers.map(({ key }) => key);
    assert.ok(order.indexOf('frog.light') < order.indexOf('frog.replace.part-belly.all.glaze'));
    assert.ok(order.indexOf('frog.replace.part-belly.all.glaze') < order.indexOf('frog.accents'));
  });

  test(`${name}: a face replaced in the accents slot takes its eyes, keeps its mouth and brow, and sits before the lines`, () => {
    const result = paint(frog(), [
      subjectReplace(selectFeatureGroup('face'), { slot: 'accents', frame: 'face', paint: ({ paintKey }) => [handLayer(paintKey('eyes'))] }),
    ]);
    const keys = new Set(result.report.contributions.map(({ key }) => key));
    assert.ok(!keys.has('frog.accents'));
    assert.ok(keys.has('frog.lines.feature:brow'));
    assert.ok(result.report.contributions.some(({ targets }) => targets.includes('feature:mouth')));
    const order = result.layers.map(({ key }) => key);
    assert.match(order[order.indexOf('frog.replace.feature-group-face.accents.eyes') + 1], /^frog\.lines\./);
  });

  test(`${name}: tuning one part washes it apart under a key of its own, and neither a tune nor a hidden part moves another key`, () => {
    const plain = documentKeys(paint(frog()).layers);
    const tuned = documentKeys(paint(frog(), [subjectTune(selectPart('head'), { shadowDepth: 1.6 })]).layers);
    const hidden = documentKeys(paint(frog(false)).layers);
    assert.deepEqual([...plain].filter((each) => !tuned.has(each)), []);
    const added = [...tuned].filter((each) => !plain.has(each));
    assert.ok(added.length > 0 && added.every((each) => /\.material:skin\.variant-[a-z0-9]+$/.test(each)), added.join(', '));
    // Hiding the far arm drops only its far band.
    assert.deepEqual([...plain].filter((each) => !hidden.has(each)), ['frog.light.far.material:skin']);
  });

  test(`${name}: the form keeps a pale marking clear, and keeps no hole for one a replacement paints instead`, () => {
    assert.ok(formReservesOf(paint(frog(true, true))).length > 0);
    const replaced = paint(frog(true, true), [subjectReplace(selectFeatureGroup('face'), { slot: 'all', frame: 'face', paint: ({ paintKey }) => [handLayer(paintKey('face'))] })]);
    assert.deepEqual(formReservesOf(replaced), []);
  });
}
