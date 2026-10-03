import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as meadow from './meadow.painting.ts';
import type { Application, Hex, PaintingDocument } from './painting-document.ts';
import { paintingEvaluationDiff } from './painting-evaluation-diff.ts';
import { painting } from './painting-source.ts';
import { paintingTestBrushOf } from './painting-test-brush.ts';

const BRUSH = { style: 'watercolor', brush: 'wash' } as const;
const touch = (seed: string, key?: string, profile?: (u: number) => number, pigment: Hex = '#3a4a6b', diameterPx = 24): Application => ({
  ...(key && { key }), kind: 'stroke', subpaths: [[{ x: 20, y: 60 }, { x: 180, y: 70 }]], ...(profile && { hand: { profile } }), brush: BRUSH, diameterPx, seed,
  charge: { kind: 'paint', mix: { parts: [{ pigment, amount: 1 }], strength: 0.6 } },
});

type PondChoices = {
  readonly chargeKey?: string; readonly chargeSeed?: string; readonly curve?: (u: number) => number; readonly paper?: Hex; readonly glaze?: Hex;
  /** The glaze's brush width, px; and whether the pond wraps round x. */
  readonly glazePx?: number; readonly wrap?: boolean;
  /** The reeds in a group owning a sheet of its own; and a mist layer laid before the water. */
  readonly reedBed?: boolean; readonly mist?: boolean;
};
/** A pool flooded and charged, glazed in a later wash, and reeds in a layer of their own: each variant its own source. */
const pondSource = ({ chargeKey = 'charge', chargeSeed = 'charge', curve = Math.sqrt, paper = '#f4f2ed', glaze = '#3a4a6b', glazePx = 24, wrap = false, reedBed = false, mist = false }: PondChoices) => painting({
  default: function pond(): PaintingDocument {
    const reeds = { key: 'reeds', washes: [{ key: 'reed-wash', applications: [touch('reeds')] }] };
    return {
      widthPx: 200, heightPx: 120, paper: { color: paper, absorbency: 0.5 }, medium: 'watercolour', ...(wrap && { wrap: 'x' as const }), layers: [
        ...(mist ? [{ key: 'mist', washes: [{ key: 'mist-wash', applications: [touch('mist')] }] }] : []),
        {
          key: 'water', washes: [
            { key: 'pool', applications: [touch('flood', 'flood'), touch(chargeSeed, chargeKey, curve)] },
            { key: 'pool-glaze', applications: [touch('glaze', undefined, undefined, glaze, glazePx)] },
          ],
        },
        reedBed ? { key: 'reed-bed', sheet: { kind: 'own', paper: { color: '#e9e0cc', absorbency: 0.5 } }, children: [reeds] } : reeds,
      ],
    };
  },
});

/** The pond's washes when its charge changes at `path`: the pool itself, and every wash after it on the sheet. */
const chargeChanged = (path: string) => [['pool', { kind: 'content', path }], ['pool-glaze', { kind: 'upstream', from: 'charge' }], ['reed-wash', { kind: 'upstream', from: 'charge' }]];

const changes = (diff: ReturnType<typeof paintingEvaluationDiff>) => diff.washes.map(({ wash, change }) => [wash, change]);

test('a property step re-solves the wash it changes and every later one on its sheet', () => {
  const diff = paintingEvaluationDiff(painting(meadow, { hillTopPx: 200 }), painting(meadow, { hillTopPx: 210 }), null);
  assert.deepEqual(diff.document, []);
  assert.deepEqual(changes(diff), [
    ['sky', { kind: 'same' }],
    ['hill', { kind: 'content', path: 'hill-flood.area.region.rings[0][0].y' }],
    ['cloud-wash', { kind: 'upstream', from: 'hill-flood' }],
  ]);
});

test('keys and paper colour re-solve nothing; a seed or a recreated curve re-solves its wash and all after it', () => {
  const base = pondSource({});
  const same = changes(paintingEvaluationDiff(base, pondSource({ chargeKey: 'dab' }), null));
  assert.deepEqual(same, [['pool', { kind: 'same' }], ['pool-glaze', { kind: 'same' }], ['reed-wash', { kind: 'same' }]]);
  const recoloured = paintingEvaluationDiff(base, pondSource({ paper: '#efe9dc' }), null);
  assert.deepEqual([recoloured.document, changes(recoloured)], [['paper.color'], same]);
  assert.deepEqual(changes(paintingEvaluationDiff(base, pondSource({ chargeSeed: 'charge-2' }), null)), chargeChanged('charge.seed'));
  assert.deepEqual(changes(paintingEvaluationDiff(base, pondSource({ curve: (u) => Math.sqrt(u) }), null)), chargeChanged('charge.hand.profile'));
});

test("a layer added earlier in the document leaves another sheet's washes as they were", () => {
  const diff = paintingEvaluationDiff(pondSource({ reedBed: true }), pondSource({ reedBed: true, mist: true }), null);
  assert.deepEqual(changes(diff).filter(([wash]) => wash === 'reed-wash'), [['reed-wash', { kind: 'same' }]]);
});

test("a pigment a later wash brings changes its layer's film from the layer's first application on", () => {
  assert.deepEqual(changes(paintingEvaluationDiff(pondSource({}), pondSource({ glaze: '#7a4a2b' }), null)), [
    ['pool', { kind: 'content', path: 'water.slots.palette' }],
    ['pool-glaze', { kind: 'content', path: 'pool-glaze.applications[0].charge.mix.parts[0].pigment' }],
    ['reed-wash', { kind: 'upstream', from: 'water' }],
  ]);
});

test("on a wrapped sheet, a later wash widening the halo past its power of two re-solves the sheet from its start", () => {
  const diff = (glazePx: number) => changes(paintingEvaluationDiff(pondSource({ wrap: true }), pondSource({ wrap: true, glazePx }), paintingTestBrushOf));
  assert.deepEqual(diff(25).slice(0, 2), [['pool', { kind: 'same' }], ['pool-glaze', { kind: 'content', path: 'pool-glaze.applications[0].diameterPx' }]]);
  assert.deepEqual(diff(120)[0], ['pool', { kind: 'upstream', from: "the root's sheet" }]);
});
