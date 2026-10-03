import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Layer, PaintingDocument, Paper, Sheet } from '#lib/paint/document/models/painting-document.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { dissolve, layersOf, paintedSourceProblems } from './shot-selection.ts';

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

/** A plane's problems as `<path>: <message>`. */
const problemsOf = (...args: Parameters<typeof paintedSourceProblems>) => paintedSourceProblems(...args).map(({ path, message }) => `${path}: ${message}`);

test('a shot keeps an own sheet whole and refuses what no plane could draw, every problem at once', () => {
  assert.deepEqual(problemsOf('front', layersOf(pond, ['body', 'neck', 'shadow'], { at: 2 })), []);
  assert.deepEqual(problemsOf('front', layersOf(pond, ['shadow'])), []);
  assert.deepEqual(problemsOf('front', layersOf(pond, ['neck'])), ["front/neck: lies on heron's own sheet: select heron, or all its sheet's layers, on one plane"]);
  assert.deepEqual(problemsOf('front', dissolve(layersOf(pond, ['heron', 'neck']), layersOf(pond, ['neck-wash', 'reeds'], { at: Number.NaN }), 1.5)), [
    'front.source.k: 1.5 isn\'t within 0..1',
    'front/neck: is selected twice, through heron and neck',
    'front.source.b.at: NaN isn\'t a finite scene second',
    'front.source.b.layers[0]: names neck-wash, which is a wash: it selects layers and groups',
    'front.source.b.layers[1]: names reeds, which is unknown in pond',
  ]);
});
