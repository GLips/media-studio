import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampRevealShownAt } from '#lib/paint/painting/models/stamp-reveal.ts';
import type { PaintingBrushOf } from './painting-deposit-compile.ts';
import type { Application, DirectApplication, Mix } from './painting-document.ts';
import { paintingEasedRevealStrokes, paintingRevealBandPx, paintingStrokeVisibleWidthPx } from './painting-reveal.ts';
import { paintingTestBrushOf } from './painting-test-brush.ts';

const PATH = [{ x: 20, y: 60 }, { x: 180, y: 60 }];
const STROKE = { kind: 'stroke', subpaths: [PATH], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 16, seed: 'line' } as const;
const INK: Mix = { parts: [{ pigment: '#223344', amount: 1 }], strength: 0.8 };
const LINE = { ...STROKE, key: 'line', charge: { kind: 'paint', mix: INK } } satisfies DirectApplication;

test("a stroke reads its visible width, and a band holding all it lays reaches past it: a scattered brush's stamps strayed from the path, a wet wash's water past them", () => {
  const brush = paintingTestBrushOf({ style: 'watercolor', brush: 'wash' });
  const scattered: PaintingBrushOf = () => ({ ...brush, scatter: { count: 3, radius: 1, lateral: 0.5 } });
  const plain = paintingRevealBandPx(LINE, 'watercolour', { brushOf: paintingTestBrushOf, wet: false });
  // The test brush's even edge reads its diameter wide; a point scaled 1.5 widens it, and wobble moves it 4 px each way.
  assert.equal(paintingStrokeVisibleWidthPx(LINE, paintingTestBrushOf), LINE.diameterPx);
  const wavering = { ...LINE, subpaths: [[PATH[0], { ...PATH[1], scale: 1.5 }]], hand: { wobble: { position: 0.25 } } } satisfies DirectApplication;
  assert.equal(paintingStrokeVisibleWidthPx(wavering, paintingTestBrushOf), 32);
  assert.ok(plain >= LINE.diameterPx, `a plain stroke's band, ${plain} px, holds its diameter`);
  // Scattered up to a diameter off the path, its stamps need near a diameter more each side.
  assert.ok(paintingRevealBandPx(LINE, 'watercolour', { brushOf: scattered, wet: false }) > plain + LINE.diameterPx);
  const wet = { ...STROKE, key: 'wet', charge: { kind: 'paint', mix: INK, water: 0.8 } } satisfies Application;
  assert.ok(paintingRevealBandPx(wet, 'watercolour', { brushOf: paintingTestBrushOf }) > plain);
});

test("an eased pull's front is where the ease puts it, and its pieces close up behind it", () => {
  const strokes = paintingEasedRevealStrokes(PATH, { widthPx: 20, from: 0, to: 1, ease: (u) => u * u });
  const shown = (x: number, t: number) => +stampRevealShownAt({ kind: 'strokes', strokes }, { x, y: 60.5 }, t).toFixed(3);
  // At half its time an ease-in front is a quarter of the way: 40 px along, at x = 60.
  assert.deepEqual([shown(45.5, 0.5), shown(85.5, 0.5)], [1, 0]);
  assert.deepEqual(Array.from({ length: 16 }, (_, i) => shown(25.5 + i * 10, 1)), Array(16).fill(1));
});
