import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampSheetEntryKey, stampSheetHeadKey } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import { stampRoundTipStatedProfile } from '#lib/paint/painting/models/stamp-tip-support.ts';
import { compilePaintingRootSheet } from './painting-document-compile.ts';
import type { PaintingDocument } from './painting-document.ts';
import { painting } from './painting-source.ts';
import * as meadow from './meadow.painting.ts';

const wash: StampBrush = {
  profile: STAMP_BRUSH_UNMEASURED, name: 'wash', blend: 'normal', media: 'wet', accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'watercolor', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1, stepping: 'spread', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
};
wash.profile = stampRoundTipStatedProfile(wash);
const brushOf = () => wash;

test('the meadow compiles to its sheet order: a film per layer, a wash per wash, its treeline waiting on wet paper', () => {
  const program = compilePaintingRootSheet(painting(meadow), brushOf);
  assert.deepEqual(program.films.map(({ name }) => name), ['landscape', 'cloud']);
  assert.deepEqual(program.washes.map(({ name, film }) => [name, film]), [['sky', 0], ['hill', 0], ['cloud-wash', 1]]);
  assert.deepEqual(program.entries.map(({ name, wash: w, on }) => [name, w, on]), [['sky-flood', 0, null], ['treeline', 0, 'wet'], ['hill-flood', 1, null], ['cloud-wash.applications[0]', 2, null]]);
  const [sky, treeline, , cloud] = program.entries;
  assert.equal(sky.deposit.kind, 'flood');
  assert.equal(treeline.deposit.within?.length, 1);
  assert.ok(cloud.deposit.kind === 'flood' && cloud.deposit.flood.barrier.edge?.soft === 14);
  // A property step re-reads only what it changes: the hill's entry, not the sky's.
  const higher = compilePaintingRootSheet(painting(meadow, { hillTopPx: 210 }), brushOf);
  assert.deepEqual(higher.entries.map(({ datum }, k) => datum === program.entries[k].datum), [true, true, false, true]);
});

const square = (x0: number, size: number) => [{ x: x0, y: x0 }, { x: x0 + size, y: x0 }, { x: x0 + size, y: x0 + size }, { x: x0, y: x0 + size }];
const ringedDocument = (rings: readonly ReturnType<typeof square>[]): PaintingDocument => ({
  widthPx: 300, heightPx: 300, paper: { color: '#ffffff', absorbency: 0.5 }, medium: 'watercolour',
  layers: [{ key: 'target', washes: [{ key: 'rings', applications: [{
    kind: 'fill', area: { region: { kind: 'polygon', rings } },
    brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 24, seed: 'rings', charge: { kind: 'paint', mix: { parts: [{ pigment: '#335577', amount: 1 }], strength: 0.6 } },
  }] }] }],
});

test('a fill with an island in its hole floods both outer rings as one deposit, stopped at the ringed area', () => {
  const compiled = (rings: readonly ReturnType<typeof square>[]) => compilePaintingRootSheet(painting({ default: () => ringedDocument(rings) }), brushOf).entries[0].deposit;
  const ringed = compiled([square(20, 260), square(80, 140), square(130, 40)]), outline = compiled([square(20, 260)]);
  assert.ok(ringed.kind === 'flood');
  assert.equal(ringed.flood.barrier.rings?.length, 3);
  assert.ok(ringed.stamps.length > outline.stamps.length, 'the island is flooded besides the outline');
});

const strokedDocument = (profile: (along: number) => number): PaintingDocument => ({
  widthPx: 200, heightPx: 120, paper: { color: '#ffffff', absorbency: 0.5 }, medium: 'watercolour',
  layers: [{ key: 'ink', washes: [{ key: 'line', applications: [{
    kind: 'stroke', subpaths: [[{ x: 20, y: 60 }, { x: 180, y: 60 }]], hand: { profile },
    brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 16, seed: 'line', charge: { kind: 'paint', mix: { parts: [{ pigment: '#223344', amount: 1 }], strength: 0.8 } },
  }] }] }],
});

test("a stroke's hand curve enters its key through the stamps it lays: two curves, two keys; the same curve, one", async () => {
  const keyOf = async (profile: (along: number) => number) => {
    const program = compilePaintingRootSheet(painting({ default: () => strokedDocument(profile) }), brushOf);
    return stampSheetEntryKey(await stampSheetHeadKey(program.head), program.entries[0]);
  };
  const [rising, falling, risingAgain] = await Promise.all([keyOf((along) => 0.2 + 0.8 * along), keyOf((along) => 1 - 0.8 * along), keyOf((along) => 0.2 + 0.8 * along)]);
  assert.notEqual(rising, falling);
  assert.equal(rising, risingAgain);
});
