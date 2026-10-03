import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Layer, PaintingDocument, Paper, Sheet } from './painting-document.ts';
import { paintingTree } from './painting-tree.ts';

const ROOT_PAPER: Paper = { color: '#f4f2ed', absorbency: 0.5 };
const HERON_PAPER: Paper = { color: '#efe9dc', absorbency: 0.4 };

const layer = (key: string, sheet?: Sheet): Layer => ({ key, ...(sheet && { sheet }), washes: [] });

test("a document's sheets: the root's over the document, an own sheet edged by its paint and drying by its owner's medium, `scene` back on the root's", () => {
  const pond: PaintingDocument = {
    widthPx: 320, heightPx: 240, paper: ROOT_PAPER, medium: 'watercolour', layers: [
      layer('sky'),
      { key: 'heron', medium: 'gouache', sheet: { kind: 'own', paper: HERON_PAPER }, children: [layer('body'), layer('neck'), layer('shadow', { kind: 'scene' })] },
    ],
  };
  const tree = paintingTree(pond);
  assert.deepEqual(tree.sheets, [
    { owner: null, paper: ROOT_PAPER, edge: 'document', water: 'watercolour' }, { owner: 'heron', paper: HERON_PAPER, edge: 'union', water: 'gouache' },
  ]);
  assert.deepEqual(tree.layers.map(({ node, sheet, groups, medium }) => [node.key, sheet.owner, groups, medium]), [
    ['sky', null, [], 'watercolour'], ['body', 'heron', ['heron'], 'gouache'], ['neck', 'heron', ['heron'], 'gouache'], ['shadow', null, ['heron'], 'gouache'],
  ]);
});
