import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Hex, LayerNode } from '#lib/paint/document/models/painting-document.ts';
import { SUBJECT_HIDDEN, subjectVisible, type SubjectArea, type SubjectRing } from '#lib/paint/subject/models/subject-geometry.ts';
import { selectFeatureGroup, selectPart } from '#lib/paint/subject/models/subject-selector.ts';
import { defineSubject } from '#lib/paint/subject/models/subject.ts';
import { paintSubject, requireSubjectPainting, type SubjectOverridesFor, type SubjectPainting } from './paint-subject.ts';
import { subjectAreasRegion } from './subject-document-geometry.ts';
import { subjectIntent, subjectReplace, subjectTune } from './subject-overrides.ts';
import { defineSubjectPainter, type SubjectPaintKey } from './subject-painter.ts';

const square = (x: number, y: number, size: number): SubjectRing => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];
const area = (...rings: [SubjectRing, ...SubjectRing[]]): SubjectArea => ({ rings });

/** A frog of squares: its arm hides when `armShows` is false, as a turned pose hides it. */
const frog = (armShows = true) => defineSubject({
  id: 'frog',
  materials: [{ id: 'skin', localColor: '#5a8f3c' }, { id: 'ink', localColor: '#302010' }],
  parts: [
    { id: 'body', material: 'skin', visibility: subjectVisible(area(square(0, 40, 100))) },
    { id: 'belly', material: 'skin', tags: ['belly'], visibility: subjectVisible(area(square(30, 80, 40))) },
    { id: 'arm', material: 'skin', visibility: armShows ? subjectVisible(area(square(100, 60, 20))) : SUBJECT_HIDDEN },
    { id: 'head', material: 'skin', visibility: subjectVisible(area(square(20, 0, 60))) },
  ],
  features: [
    { kind: 'landmark', id: 'eye-left', owner: 'head', groups: ['face'], visibility: subjectVisible({ at: { x: 35, y: 15 } }) },
    { kind: 'landmark', id: 'eye-right', owner: 'head', groups: ['face'], visibility: subjectVisible({ at: { x: 65, y: 15 } }) },
    { kind: 'region', id: 'mouth', owner: 'head', material: 'ink', groups: ['face'], visibility: subjectVisible(area(square(40, 40, 15))) },
  ],
  frames: [{ id: 'face', owner: 'head', from: { kind: 'landmarks', left: 'eye-left', right: 'eye-right' } }],
  silhouette: subjectVisible(area(square(0, 0, 130))),
});

const layerOf = (key: SubjectPaintKey, hex: Hex, region: ReturnType<typeof subjectAreasRegion>): LayerNode => ({
  key, washes: [{ key: `${key}.wash`, applications: [{
    key: `${key}.fill`, kind: 'fill', area: { region }, brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 40, seed: key,
    charge: { kind: 'paint', mix: { parts: [{ pigment: hex, amount: 1 }], strength: 0.6 }, water: 0.5 },
  }] }],
});

/** One shared wash per material over every part it still owns, then a face wash over the face's regions. */
const washPainter = defineSubjectPainter<{ strength: number }>()({
  id: 'wash-test',
  evidence: [],
  defaults: { strength: 0.6 },
  slots: ['form', 'face'],
  replaceAllAt: 'form',
  controls: ['strength'],
  intents: ['localColor'],
  paint: (context) => {
    const materials = [...context.subject.materials.values()];
    const forms = materials.flatMap((material) => {
      const parts = context.paintedParts('form').filter((part) => part.material === material.id);
      if (!parts.length) return [];
      const key = context.paintKey('form-wash', material.ref);
      return [{ key, slot: 'form' as const, targets: parts.map(({ ref }) => ref), layers: [layerOf(key, context.intent(parts[0].ref).localColor, subjectAreasRegion(parts.map(({ visibility }) => visibility.geometry)))] }];
    });
    const regions = context.paintedFeatures('face').flatMap((feature) => (feature.kind === 'region' ? [feature] : []));
    const faceKey = context.paintKey('face-wash');
    const face = regions.length ? [{ key: faceKey, slot: 'face' as const, targets: regions.map(({ ref }) => ref), layers: [layerOf(faceKey, context.intent(regions[0].ref).localColor, subjectAreasRegion(regions.map(({ visibility }) => visibility.geometry)))] }] : [];
    return [...forms, ...face];
  },
});

const painted = (subject: ReturnType<typeof frog>, overrides: SubjectOverridesFor<ReturnType<typeof frog>, typeof washPainter> = []) =>
  paintSubject(subject, washPainter, {}, overrides);

test('a hidden part keeps its identity: its override matches, draws nothing, and no other key moves', () => {
  const shown = requireSubjectPainting(painted(frog(true), [subjectTune(selectPart('arm'), { strength: 0.3 })]));
  const turned = requireSubjectPainting(painted(frog(false), [subjectTune(selectPart('arm'), { strength: 0.3 })]));
  assert.deepEqual(turned.report.hidden, ['part:arm']);
  assert.deepEqual(turned.report.matched[0].targets, ['part:arm']);
  assert.deepEqual(turned.report.contributions.map(({ key }) => key), shown.report.contributions.map(({ key }) => key));
  assert.ok(!turned.report.contributions.some(({ targets }) => targets.includes('part:arm')));
  assert.deepEqual(shown.report.contributions.map(({ key }) => key), ['frog.form-wash.material:skin', 'frog.face-wash']);
});

const skinWash = ({ report }: SubjectPainting) => report.contributions.find(({ key }) => key === 'frog.form-wash.material:skin')?.targets;

test('replacing the belly takes it out of the shared wash the painter plans, and sits in the painter\'s form slot', () => {
  const plain = requireSubjectPainting(painted(frog()));
  const result = requireSubjectPainting(painted(frog(), [subjectReplace(selectPart('belly'), {
    slot: 'all', paint: (context) => [layerOf(context.paintKey('belly-glaze'), '#ffffff', { kind: 'polygon', rings: [square(30, 80, 40)] })],
  })]));
  assert.deepEqual(skinWash(plain), ['part:body', 'part:belly', 'part:arm', 'part:head']);
  assert.deepEqual(skinWash(result), ['part:body', 'part:arm', 'part:head']);
  assert.deepEqual(result.report.replacements[0].targets, ['part:belly']);
  // The form slot holds the skin wash and then the replacement; the face wash comes after.
  assert.deepEqual(result.layers.map(({ key }) => key), ['frog.form-wash.material:skin', 'frog.replace.part-belly.all.belly-glaze', 'frog.face-wash']);
});

test('replacements that meet in a slot are an error naming both', () => {
  const head = subjectReplace(selectPart('head'), { slot: 'all', paint: () => [] });
  const face = subjectReplace(selectFeatureGroup('face'), { slot: 'face', frame: 'face', paint: () => [] });
  const result = painted(frog(), [head, face]);
  assert.ok(!result.ok);
  const overlap = result.diagnostics.find(({ code }) => code === 'overlapping-replacements');
  assert.ok(overlap);
  assert.equal(overlap.address, 'override[1]');
  assert.match(overlap.message, /override\[0\].*feature:mouth/);
});

test('an id the subject lacks fails to compile when its ids are known, and is an unknown-ref diagnostic when they are data', () => {
  // @ts-expect-error: the frog has no part 'tail'.
  painted(frog(), [subjectIntent(selectPart('tail'), { localColor: '#ff0000' })]);
  const fromData: Parameters<typeof paintSubject>[0] = frog();
  const result = paintSubject(fromData, washPainter, {}, [subjectIntent(selectPart('tail'), { localColor: '#ff0000' })]);
  assert.ok(!result.ok);
  assert.deepEqual(result.diagnostics.map(({ code, address }) => [code, address]), [['unknown-ref', 'override[0].select']]);
  assert.match(result.diagnostics[0].fix, /body, belly, arm, head/);
});

test('a tune outside the painter\'s controls is refused, and an intent it can\'t interpret is reported', () => {
  // @ts-expect-error: wash-test can't tune water per target, which the types already know.
  const result = painted(frog(), [subjectTune(selectPart('head'), { water: 0.9 }), subjectIntent(selectPart('head'), { edge: 'lost' })]);
  assert.ok(!result.ok);
  assert.deepEqual(result.diagnostics.map(({ code, severity }) => [code, severity]), [['unsupported-control', 'error'], ['unsupported-intent', 'warning']]);
});
