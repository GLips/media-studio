import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnyApplication, LayerNode } from '#lib/paint/document/models/painting-document.ts';
import type { SurfaceEvidence } from '#lib/paint/subject/models/subject-evidence.ts';
import { SUBJECT_HIDDEN, subjectVisible, type SubjectArea } from '#lib/paint/subject/models/subject-geometry.ts';
import { selectFeature, selectFeatureGroup, selectMaterial, selectPart } from '#lib/paint/subject/models/subject-selector.ts';
import { defineSubject } from '#lib/paint/subject/models/subject.ts';
import { paintSubject, requireSubjectPainting, type SubjectOverridesFor, type SubjectPainting } from '../paint-subject.ts';
import { subjectIntent, subjectReplace, subjectTune } from '../subject-overrides.ts';
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

/** A frog of rectangles on a ball's surface, lit from the top left; its arm is on the far side, or hidden; `bib` adds a cream belly marking. */
const frog = (armShows = true, bib = false) => defineSubject({
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
    { kind: 'region', id: 'bib', owner: 'body', material: 'cream', tags: ['belly'], visibility: bib ? subjectVisible(rect(50, 80, 110, 106)) : SUBJECT_HIDDEN },
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
const applicationsOf = (layers: readonly LayerNode[]): AnyApplication[] =>
  layers.flatMap((node) => [...applicationsOf(node.children ?? []), ...(node.washes ?? []).flatMap(({ applications }) => applications)]);
/** Every application in the layers keyed `key`. */
const applicationsIn = (result: SubjectPainting, key: string) => applicationsOf(result.layers.filter((layer) => layer.key === key));
/** Every footprint the frog's form layer keeps clear. */
const formReservesOf = (result: SubjectPainting) => applicationsIn(result, 'frog.form').flatMap((application) => ('reserves' in application ? application.reserves ?? [] : []));
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

  test(`${name}: a tuned shade splits only the light, keyed by its part; retuning it moves no key or seed, nor does a hidden part`, () => {
    const seeds = (result: SubjectPainting) => new Set(applicationsOf(result.layers).map(({ key, seed }) => `${key} ${seed}`));
    const plain = seeds(paint(frog()));
    const tuned = seeds(paint(frog(), [subjectTune(selectPart('belly'), { shadowDepth: 1.6 })]));
    assert.deepEqual([...plain].filter((each) => !tuned.has(each)), []);
    const added = [...tuned].filter((each) => !plain.has(each));
    assert.ok(added.length > 0 && added.every((each) => /^frog\.light\.[a-z-]+\.material:skin\.part:belly /.test(each)), `added: ${added.join(', ')}`);
    assert.deepEqual(seeds(paint(frog(), [subjectTune(selectPart('belly'), { shadowDepth: 1.8 })])), tuned);
    // Hiding the far arm drops only its far band and, where contours are drawn, its stretch of the silhouette.
    const hidden = documentKeys(paint(frog(false)).layers);
    assert.deepEqual([...documentKeys(paint(frog()).layers)].filter((each) => !hidden.has(each) && each !== 'frog.lines.silhouette.part:arm'), ['frog.light.far.material:skin']);
  });

  test(`${name}: shadowDepth 0 lays no shade at all`, () => {
    const flat = paint(frog(), [subjectTune(selectMaterial('skin'), { shadowDepth: 0 })]);
    assert.ok(!flat.layers.some(({ key }) => key === 'frog.light'));
  });

  test(`${name}: a replaced cream belly keeps its paper under the form unless the replacement paints over it or reserves its own`, () => {
    const bib = rect(50, 80, 110, 106).rings, own = rect(60, 84, 100, 104).rings;
    // Watercolour's tint and local wash each keep it clear: one entry per distinct footprint.
    const regions = (result: SubjectPainting) => [...new Set(formReservesOf(result).map((footprint) => JSON.stringify(footprint.kind === 'region' && footprint.region.kind === 'polygon' && footprint.region.rings)))];
    const replaced = (ground?: 'over' | { readonly reserve: SubjectArea }) => paint(frog(true, true), [subjectReplace(selectFeature('bib'), {
      slot: 'all', ...(ground && { ground }), paint: ({ paintKey }) => [handLayer(paintKey('glaze'))],
    })]);
    const plain = regions(paint(frog(true, true)));
    assert.deepEqual(plain, [JSON.stringify(bib)]);
    assert.deepEqual(regions(replaced()), plain);
    assert.deepEqual(regions(replaced('over')), []);
    assert.deepEqual(regions(replaced({ reserve: { rings: own } })), [JSON.stringify(own)]);
  });
}

/** The frog's form washes: each application's area and clips, as the form layer lays them. */
const formAreas = (result: SubjectPainting) => result.layers.filter(({ key }) => key === 'frog.form')
  .flatMap((layer) => ('washes' in layer ? (layer.washes ?? []).flatMap(({ applications }) => applications) : []))
  .flatMap((application) => (application.kind === 'fill' ? (application.clips ?? []).concat(application.area) : []));
/** How far a point lies from the frog's silhouette, the box 20..152 × 15..140. */
const offSilhouette = ({ x, y }: { x: number; y: number }) => Math.min(Math.abs(x - 20), Math.abs(x - 152), Math.abs(y - 15), Math.abs(y - 140));

test('watercolour bleeds past the silhouette and nowhere inside the figure; bleed 0 or a firm edge stops it at the outline', () => {
  const bleeding = (result: SubjectPainting) => formAreas(result).filter(({ edge }) => edge?.kind === 'bleed').length;
  const opened = (result: SubjectPainting) => formAreas(result).flatMap(({ boundaries }) => boundaries ?? []);
  const plain = painters.watercolor(frog());
  // The washes bleed all round; their clips open only where they meet the silhouette.
  assert.ok(bleeding(plain) > 0 && opened(plain).length > 0);
  // Within a cell and a half of the ball's 4 px samples: how far a traced edge may wander from the silhouette.
  assert.ok(opened(plain).every(({ path }) => path.every((point) => offSilhouette(point) <= 6)), 'a clip opens inside the figure');
  const held = (overrides: SubjectOverridesFor<Frog, typeof watercolor>, options = {}) => requireSubjectPainting(paintSubject(frog(), watercolor, options, overrides));
  for (const result of [held([], { bleed: 0 }), held([subjectIntent(selectMaterial('skin'), { edge: 'firm' })])]) {
    assert.equal(bleeding(result), 0);
    assert.deepEqual(opened(result), []);
  }
});

test('the one silhouette is inked stretch by stretch, each with its own part\'s line options and edge', () => {
  const silhouette = (result: SubjectPainting) => new Map(applicationsIn(result, 'frog.lines.silhouette').map((application) => [application.key, 'diameterPx' in application ? application.diameterPx : 0]));
  const results = [
    requireSubjectPainting(paintSubject(frog(), watercolor, {}, [subjectTune(selectPart('head'), { lineWeight: 2 }), subjectIntent(selectPart('arm'), { edge: 'lost' })])),
    requireSubjectPainting(paintSubject(frog(), gouache, { contours: true }, [subjectTune(selectPart('head'), { lineWeight: 2 }), subjectIntent(selectPart('arm'), { edge: 'lost' })])),
  ];
  for (const result of results) {
    const widths = silhouette(result);
    assert.deepEqual([...widths.keys()], ['frog.lines.silhouette.part:body', 'frog.lines.silhouette.part:belly', 'frog.lines.silhouette.part:head']);
    assert.equal(widths.get('frog.lines.silhouette.part:head'), 2 * (widths.get('frog.lines.silhouette.part:body') ?? 0));
  }
});

test('watercolour inks an occluding edge only where it parts two materials: a seam inside one form is left to the washes', () => {
  const seams = defineSubject({
    id: 'toy',
    materials: [{ id: 'skin', localColor: '#5e9b3c' }, { id: 'cream', localColor: '#f4ecd0' }],
    parts: [
      { id: 'body', material: 'skin', visibility: subjectVisible(rect(20, 20, 100, 140)) },
      { id: 'arm', material: 'skin', visibility: subjectVisible(rect(100, 20, 140, 80)) },
      { id: 'sac', material: 'cream', visibility: subjectVisible(rect(100, 80, 140, 140)) },
    ],
    features: [
      { kind: 'path', id: 'arm-edge', owner: 'arm', line: 'occluding-edge', visibility: subjectVisible({ runs: [{ points: [{ x: 100, y: 22 }, { x: 100, y: 78 }], closed: false }] }) },
      { kind: 'path', id: 'sac-edge', owner: 'sac', line: 'occluding-edge', visibility: subjectVisible({ runs: [{ points: [{ x: 100, y: 82 }, { x: 100, y: 138 }], closed: false }] }) },
    ],
    frames: [],
    silhouette: subjectVisible(rect(20, 20, 140, 140)),
    surface: ballSurface(),
    illumination: frog().illumination,
  });
  const inked = requireSubjectPainting(paintSubject(seams, watercolor)).report.contributions.filter(({ slot }) => slot === 'lines').map(({ key }) => key);
  assert.deepEqual(inked, ['toy.lines.silhouette', 'toy.lines.feature:sac-edge']);
});
