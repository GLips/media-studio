import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as meadow from './meadow.painting.ts';
import type { Application, Hex, PaintingDocument } from './painting-document.ts';
import { paintingEvaluationDiff } from './painting-evaluation-diff.ts';
import { painting } from './painting-source.ts';

const BRUSH = { style: 'watercolor', brush: 'wash' } as const;
const touch = (seed: string, key?: string, profile?: (u: number) => number): Application => ({
  ...(key && { key }), kind: 'stroke', subpaths: [[{ x: 20, y: 60 }, { x: 180, y: 70 }]], ...(profile && { hand: { profile } }), brush: BRUSH, diameterPx: 24, seed,
  charge: { kind: 'paint', mix: { parts: [{ pigment: '#3a4a6b', amount: 1 }], strength: 0.6 } },
});

type PondChoices = { readonly chargeKey?: string; readonly chargeSeed?: string; readonly curve?: (u: number) => number; readonly paper?: Hex };
/** A pool flooded and charged, glazed in a later wash, and reeds in a layer of their own: each variant its own source. */
const pondSource = ({ chargeKey = 'charge', chargeSeed = 'charge', curve = Math.sqrt, paper = '#f4f2ed' }: PondChoices) => painting({
  default: function pond(): PaintingDocument {
    return {
      widthPx: 200, heightPx: 120, paper: { color: paper, absorbency: 0.5 }, medium: 'watercolour', layers: [
        {
          key: 'water', washes: [
            { key: 'pool', applications: [touch('flood', 'flood'), touch(chargeSeed, chargeKey, curve)] },
            { key: 'pool-glaze', applications: [touch('glaze')] },
          ],
        },
        { key: 'reeds', washes: [{ key: 'reed-wash', applications: [touch('reeds')] }] },
      ],
    };
  },
});

/** The pond's washes when its charge changes at `path`: the pool itself, and every wash after it on the sheet. */
const chargeChanged = (path: string) => [['pool', { kind: 'content', path }], ['pool-glaze', { kind: 'upstream', from: 'charge' }], ['reed-wash', { kind: 'upstream', from: 'charge' }]];

const changes = (diff: ReturnType<typeof paintingEvaluationDiff>) => diff.washes.map(({ wash, change }) => [wash, change]);

test('a property step re-solves the wash it changes and every later one on its sheet', () => {
  const diff = paintingEvaluationDiff(painting(meadow, { hillTopPx: 200 }), painting(meadow, { hillTopPx: 210 }));
  assert.deepEqual(diff.document, []);
  assert.deepEqual(changes(diff), [
    ['sky', { kind: 'same' }],
    ['hill', { kind: 'content', path: 'hill-flood.area.region.rings[0][0].y' }],
    ['cloud-wash', { kind: 'upstream', from: 'hill-flood' }],
  ]);
});

test('keys and paper colour re-solve nothing; a seed or a recreated curve re-solves its wash and all after it', () => {
  const base = pondSource({});
  const same = changes(paintingEvaluationDiff(base, pondSource({ chargeKey: 'dab' })));
  assert.deepEqual(same, [['pool', { kind: 'same' }], ['pool-glaze', { kind: 'same' }], ['reed-wash', { kind: 'same' }]]);
  const recoloured = paintingEvaluationDiff(base, pondSource({ paper: '#efe9dc' }));
  assert.deepEqual([recoloured.document, changes(recoloured)], [['paper.color'], same]);
  assert.deepEqual(changes(paintingEvaluationDiff(base, pondSource({ chargeSeed: 'charge-2' }))), chargeChanged('charge.seed'));
  assert.deepEqual(changes(paintingEvaluationDiff(base, pondSource({ curve: (u) => Math.sqrt(u) }))), chargeChanged('charge.hand.profile'));
});
