import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import * as meadow from './meadow.painting.ts';
import type { Application, EdgedRegion, Layer, LayerNode, Mix, PaintingDocument, Ring, Wash } from './painting-document.ts';
import type { PaintingProblem } from './painting-problem.ts';
import { checkPaintingSource, type PaintingSourceModule } from './painting-source.ts';

const W = 400, H = 300;
const BOX: Ring = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: 200 }, { x: 0, y: 200 }];
const { ultramarine, burntSienna } = WATERCOLOUR_PIGMENTS;
const TIP = { brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 60 } as const;
const BLUE: Mix = { parts: [{ pigment: ultramarine, amount: 1 }], strength: 0.5 };

type FloodOptions = { readonly key?: string; readonly water: number; readonly area?: EdgedRegion; readonly mix?: Mix };
const flood = ({ key, water, area = { region: { kind: 'polygon', rings: [BOX] } }, mix = BLUE }: FloodOptions): Application => ({
  ...(key && { key }), kind: 'fill', area, ...TIP, seed: `flood-${key}`, charge: { kind: 'paint', mix, water },
});
const stroke = (key: string): Application => ({
  key, kind: 'stroke', subpaths: [[{ x: 20, y: 150 }, { x: 380, y: 150 }]], ...TIP, diameterPx: 20, seed: `stroke-${key}`,
  charge: { kind: 'paint', mix: { parts: [{ pigment: burntSienna, amount: 1 }], strength: 0.7 } },
});
const documentOf = (layers: readonly LayerNode[], medium: PaintingDocument['medium'] = 'watercolour', dryingScale?: PaintingDocument['dryingScale']): PaintingDocument => ({
  widthPx: W, heightPx: H, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium, ...(dryingScale !== undefined && { dryingScale }), layers,
});
const sourceOf = (paintingDocument: PaintingDocument): PaintingSourceModule => ({ default: function broken() { return paintingDocument; } });
const layer = (key: string, washes: readonly Wash[]): Layer => ({ key, washes });
/** A mix of hex pigments, each its own: `count` greys from #101010 up. */
const greys = (from: number, count: number): Mix => ({
  parts: Array.from({ length: count }, (_, i) => ({ pigment: `#${(from + i).toString(16).padStart(2, '0').repeat(3)}`, amount: 1 })), strength: 1,
});

const brokenSources: readonly { readonly name: string; readonly check: () => readonly PaintingProblem[]; readonly expect: Pick<PaintingProblem, 'severity' | 'path' | 'message'> }[] = [
  {
    name: 'a key used twice',
    check: () => checkPaintingSource(sourceOf(documentOf([layer('sky', [{ key: 'sky', applications: [flood({ key: 'sky-flood', water: 0.85 })] }])]))),
    expect: { severity: 'error', path: 'sky.key', message: 'is used twice, by a layer and a wash' },
  },
  {
    name: 'a property value off its step',
    check: () => checkPaintingSource(meadow, { hillTopPx: 205 }),
    expect: { severity: 'error', path: 'property hillTopPx.value', message: 'hillTopPx = 205 is off its step 10' },
  },
  {
    name: 'a crayon wash keeping a wet history',
    check: () => checkPaintingSource(sourceOf(documentOf([layer('drawing', [{ key: 'lines', applications: [stroke('line')] }])], 'crayon'))),
    expect: { severity: 'error', path: 'lines.wetHistory', message: 'needs wetHistory: false: crayon keeps no wet history' },
  },
  {
    name: 'a fixed at before its predecessor',
    check: () => checkPaintingSource(sourceOf(documentOf([layer('landscape', [{
      key: 'hill', clock: { origin: 0 }, applications: [{ ...flood({ key: 'hill-base', water: 0.85 }), at: 3.5 }, { ...stroke('hill-flood'), at: 3.2 }],
    }])]))),
    expect: { severity: 'error', path: 'hill-flood.at', message: 'fixed at 3.2 s precedes its predecessor at 3.5 s' },
  },
  {
    name: 'a boundary off its outline',
    check: () => checkPaintingSource(sourceOf(documentOf([layer('landscape', [{
      key: 'hill', applications: [flood({ water: 0.85, area: { region: { kind: 'polygon', rings: [BOX] }, boundaries: [{ path: [{ x: 0, y: 205 }, { x: W, y: 205 }], edge: { kind: 'bleed', reachPx: 20 } }] } })],
    }])]))),
    expect: { severity: 'error', path: 'hill.applications[0].area.boundaries[0].path', message: 'a boundary strays more than 1 px from its outline' },
  },
  {
    name: 'thirteen pigments in a layer',
    check: () => checkPaintingSource(sourceOf(documentOf([layer('landscape', [
      { key: 'near', applications: [flood({ key: 'near-flood', water: 0.85, mix: greys(0x10, 7) })] },
      { key: 'far', applications: [flood({ key: 'far-flood', water: 0.85, mix: greys(0x20, 6) })] },
    ])]))),
    expect: { severity: 'error', path: 'landscape.washes', message: 'mixes 13 pigments; a layer holds 12: split it into two layers' },
  },
  {
    name: 'a bloom on paint, written in JS',
    check: () => checkPaintingSource(sourceOf(documentOf([layer('sky', [{
      key: 'sky-wash',
      // SAFETY: the types refuse a bloom on paint; this is the JS source the check is there for.
      applications: [flood({ key: 'sky-flood', water: 0.85 }), { ...stroke('drop'), on: 'damp', effect: 'bloom' } as Application],
    }])]))),
    expect: { severity: 'error', path: 'drop.effect', message: 'lays paint; a bloom is water' },
  },
  {
    name: "an unkeyed application's water out of range",
    check: () => checkPaintingSource(sourceOf(documentOf([layer('sky', [{
      key: 'sky-wash',
      applications: [flood({ key: 'sky-flood', water: 0.85 }), { ...TIP, kind: 'stroke', subpaths: [[{ x: 0, y: 40 }, { x: 300, y: 40 }]], seed: 'rewet', charge: { kind: 'water', water: 1.2 } }],
    }])]))),
    expect: { severity: 'error', path: 'sky-wash.applications[1].charge.water', message: "1.2 isn't within 0..1" },
  },
  {
    name: "an on 'wet' after a flood no wetter than shiny",
    check: () => checkPaintingSource(sourceOf(documentOf([layer('landscape', [{ key: 'sky', applications: [flood({ key: 'sky-flood', water: 0.7 }), { ...stroke('treeline'), on: 'wet' }] }])]))),
    expect: { severity: 'warning', path: 'treeline.on', message: "on 'wet' follows only applications at or below shiny 0.7: it can never hold" },
  },
  {
    name: "an own sheet's dryingScale of 0",
    check: () => {
      const wing: Layer = { key: 'wing', washes: [{ key: 'wing-wash', clock: { origin: 0 }, applications: [flood({ key: 'wing-flood', water: 0.85 })] }] };
      return checkPaintingSource(sourceOf(documentOf([{ key: 'card', sheet: { kind: 'own', paper: { color: '#ffffff', absorbency: 0.5 }, dryingScale: 0 }, children: [wing] }])));
    },
    expect: { severity: 'error', path: 'card.sheet.dryingScale', message: "0 isn't above 0, 'instant' or 'never'" },
  },
  {
    name: 'a wet wash on a crayon-owned sheet',
    check: () => {
      const sky: Layer = { key: 'sky', medium: 'watercolour', washes: [{ key: 'sky-wash', applications: [flood({ key: 'sky-flood', water: 0.85 })] }] };
      return checkPaintingSource(sourceOf(documentOf([{ key: 'card', medium: 'crayon', sheet: { kind: 'own', paper: { color: '#ffffff', absorbency: 0.5 } }, children: [sky] }])));
    },
    expect: { severity: 'error', path: 'sky-wash.applications', message: "lays water on card's own sheet, whose medium crayon keeps no wet history" },
  },
  {
    name: "a wash after a wet one on a sheet whose clock is 'never'",
    check: () => checkPaintingSource(sourceOf(documentOf([
      layer('shallows', [{ key: 'puddle', clock: { origin: 0 }, applications: [flood({ key: 'puddle-flood', water: 0.9 })] }]),
      layer('landscape', [{ key: 'sky', applications: [flood({ key: 'sky-flood', water: 0.85 })] }, { key: 'hill', applications: [stroke('ridge')] }]),
    ], 'watercolour', 'never'))),
    expect: { severity: 'error', path: 'hill.clock', message: "follows sky on the root's sheet, which never dries" },
  },
  {
    name: 'a tiled document whose grain is laid at half its scale across x',
    check: () => {
      const grain = { image: { style: 'watercolor', pack: 'vvds', file: 'papers/vvds-watercolor-canvas-3.grain.png' }, scale: 1, depth: 0.35 };
      const sky = layer('sky', [{ key: 'sky-wash', applications: [flood({ key: 'sky-flood', water: 0.85 })] }]);
      return checkPaintingSource(sourceOf({ ...documentOf([sky]), wrap: 'xy', paper: { color: '#f4f2ed', absorbency: 0.5, grain } }));
    },
    expect: { severity: 'warning', path: 'document.paper.grain.scale', message: 'is laid at 0.5 on a document wrapping across x: its mirrored tiles fit the width in whole pairs, 1 ÷ 2n of it (0.5, 0.25, 0.167…)' },
  },
];

test('each broken source is refused with its one exact problem', () => {
  for (const { name, check, expect } of brokenSources) {
    assert.deepEqual(check().map(({ severity, path, message }) => ({ severity, path, message })), [expect], name);
  }
});

test("a source that can paint checks clean: the meadow, and a charge into another layer's wet flood on its sheet", () => {
  assert.deepEqual(checkPaintingSource(meadow), []);
  const foot = documentOf([layer('shallows', [{ key: 'pool', applications: [flood({ key: 'pool-flood', water: 0.9 })] }]), layer('heron', [{ key: 'foot', applications: [{ ...stroke('foot-charge'), on: 'wet' }] }])]);
  assert.deepEqual(checkPaintingSource(sourceOf(foot)), []);
});

test("a problem's footprint is the box of the geometry it's about, grown by half its brush", () => {
  const [problem] = brokenSources[7].check();
  assert.deepEqual(problem.footprint, { x0: -30, y0: 10, x1: 330, y1: 70 });
});

test("a factory that isn't pure is named, with the first place two of its calls differ", () => {
  let calls = 0;
  const restless: PaintingSourceModule = { default: function restless() { return documentOf([layer('sky', [{ key: 'sky-wash', applications: [flood({ key: 'sky-flood', water: 0.8 + 0.01 * calls++ })] }])]); } };
  assert.deepEqual(checkPaintingSource(restless).map(({ path, message }) => ({ path, message })), [
    { path: 'document.layers[0].washes[0].applications[0].charge.water', message: "restless isn't pure: two calls differ at layers[0].washes[0].applications[0].charge.water" },
  ]);
});
