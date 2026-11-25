import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaintingDocument } from './painting-document.ts';
import type { PropertySchema, PropertyValues } from './painting-properties.ts';
import { PAINTING_EVALUATIONS_KEPT, painting, paintingEvaluationCounts, type PaintingSourceModule } from './painting-source.ts';

const properties = { frame: { type: 'number', min: 0, max: 1000, step: 1, default: 0 } } as const satisfies PropertySchema;

function posed({ frame }: PropertyValues<typeof properties>): PaintingDocument {
  return { widthPx: 100, heightPx: 100, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', layers: [{ key: `at-${frame}`, washes: [] }] };
}

/** A source posed by its frame, as a subject in motion is: a new evaluation per frame. Each call is a new source. */
const posedSource = (): PaintingSourceModule<typeof properties> => ({ properties, default: posed });

const madeBy = (ask: () => void) => {
  const before = paintingEvaluationCounts().made;
  ask();
  return paintingEvaluationCounts().made - before;
};

test('painting() keeps the evaluations last asked for, giving up the least recently asked first', () => {
  const source = posedSource(), first = painting(source, { frame: 0 });
  for (let frame = 1; frame < PAINTING_EVALUATIONS_KEPT; frame++) painting(source, { frame });
  // Asking for frame 0 again makes it the most recent, so the next new frame gives up frame 1 instead.
  assert.equal(painting(source, { frame: 0 }), first);
  assert.equal(madeBy(() => painting(source, { frame: PAINTING_EVALUATIONS_KEPT })), 1);
  assert.equal(madeBy(() => painting(source, { frame: 0 })), 0);
  assert.equal(madeBy(() => painting(source, { frame: 1 })), 1);
});

test('a long run of new frames keeps no more than the bound', () => {
  const source = posedSource();
  for (let frame = 0; frame <= 1000; frame++) painting(source, { frame });
  // The last PAINTING_EVALUATIONS_KEPT frames are met again without evaluating; the one before them is made anew.
  assert.equal(madeBy(() => { for (let frame = 1001 - PAINTING_EVALUATIONS_KEPT; frame <= 1000; frame++) painting(source, { frame }); }), 0);
  assert.equal(madeBy(() => painting(source, { frame: 1000 - PAINTING_EVALUATIONS_KEPT })), 1);
});
