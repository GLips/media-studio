import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Layer, PaintingDocument, Paper, Sheet } from '#lib/paint/document/models/painting-document.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { layersOf } from './shot-selection.ts';

const ROOT_PAPER: Paper = { color: '#f4f2ed', absorbency: 0.5 };
const HERON_PAPER: Paper = { color: '#efe9dc', absorbency: 0.4 };

const layer = (key: string, sheet?: Sheet): Layer => ({
  key, ...(sheet && { sheet }), washes: [{
    key: `${key}-wash`,
    applications: [{
      kind: 'stroke', subpaths: [[{ x: 40, y: 100 }, { x: 200, y: 120 }]], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 20,
      seed: key, charge: { kind: 'paint', mix: { parts: [{ pigment: '#3a4a6b', amount: 1 }], strength: 0.6 } },
    }],
  }],
});

/** A gouache heron on a sheet of its own, its shadow on the scene's paper, behind it a watercolour sky on the root's. */
const pond = painting({
  default: function pond(): PaintingDocument {
    return {
      widthPx: 320, heightPx: 240, paper: ROOT_PAPER, medium: 'watercolour', layers: [
        layer('sky'),
        { key: 'heron', medium: 'gouache', sheet: { kind: 'own', paper: HERON_PAPER }, children: [layer('body'), layer('neck'), layer('shadow', { kind: 'scene' })] },
      ],
    };
  },
});

test("a document's sheets: the root's over the document, an own sheet edged by its paint and drying by its owner's medium, `scene` back on the root's", () => {
  assert.deepEqual(pond.sheets.sheets, [
    { owner: null, paper: ROOT_PAPER, edge: 'document', water: 'watercolour' }, { owner: 'heron', paper: HERON_PAPER, edge: 'union', water: 'gouache' },
  ]);
  assert.deepEqual(pond.sheets.layers.map(({ node, sheet, groups }) => [node.key, sheet.owner, groups]), [
    ['sky', null, []], ['body', 'heron', ['heron']], ['neck', 'heron', ['heron']], ['shadow', null, ['heron']],
  ]);
});

test('layersOf keeps an own sheet whole and refuses what no plane could draw', () => {
  assert.deepEqual(layersOf(pond, ['body', 'neck', 'shadow'], { at: 2 }).layers, ['body', 'neck', 'shadow']);
  assert.deepEqual(layersOf(pond, ['shadow']).layers, ['shadow']);
  assert.throws(() => layersOf(pond, ['neck']), { message: "layersOf: neck lies on heron's own sheet: select heron, or all its sheet's layers, together" });
  assert.throws(() => layersOf(pond, ['heron', 'neck']), { message: 'layersOf selects neck twice: through heron and neck' });
  assert.throws(() => layersOf(pond, ['neck-wash']), { message: 'layersOf names neck-wash, which is a wash: it selects layers and groups' });
  assert.throws(() => layersOf(pond, ['reeds']), { message: 'layersOf names reeds, which is unknown in pond' });
});
