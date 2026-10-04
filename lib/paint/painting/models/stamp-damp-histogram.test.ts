import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STAMP_DAMP_HISTOGRAM_BINS, stampDampFirstStep, stampDampFirstWidth, stampDampWindow, type StampDampHistogram, type StampDampRefine,
} from './stamp-damp-histogram.ts';

/** Core weight that turns matte at step `matte` from τ0 and sets at step `sets` (0: set by τ0). */
type DampTexels = { weight: number; matte: number; sets: number };

/** `texels` binned as the GPU's histogram pass bins them, from step `start`, `width` steps a bin. */
function histogramOf(texels: readonly DampTexels[], { start, width }: { start: number; width: number }): StampDampHistogram {
  const matte = new Float64Array(STAMP_DAMP_HISTOGRAM_BINS), sets = new Float64Array(STAMP_DAMP_HISTOGRAM_BINS);
  let matteBefore = 0, setBy = 0;
  const bin = (step: number) => Math.floor((step - start) / width);
  for (const texel of texels) {
    if (texel.matte < start) matteBefore += texel.weight;
    else if (bin(texel.matte) < STAMP_DAMP_HISTOGRAM_BINS) matte[bin(texel.matte)] += texel.weight;
    if (texel.sets <= start) setBy += texel.weight;
    else if (bin(texel.sets - 1) < STAMP_DAMP_HISTOGRAM_BINS) sets[bin(texel.sets - 1)] += texel.weight;
  }
  return { start, width, matte, sets, matteBefore, setBy };
}

/** The first histogram over `texels`, reaching their last set, and refinements read off them. */
function searchOf(texels: readonly DampTexels[]): { first: StampDampHistogram; refine: StampDampRefine } {
  const last = Math.max(...texels.map(({ sets }) => sets));
  return { first: histogramOf(texels, { start: 0, width: stampDampFirstWidth(last) }), refine: async (at) => histogramOf(texels, at) };
}

test('paper set before τ0 counts against the first bin: a core half set is never damp over 95%, and at most half of it is', async () => {
  const { first, refine } = searchOf([{ weight: 50, matte: 0, sets: 0 }, { weight: 50, matte: 0, sets: 20000 }]);
  assert.ok(first.width > 1);
  const { step, most } = await stampDampFirstStep(first, 95, refine);
  assert.equal(step, null);
  assert.equal(most.weight, 50);
});

test('halves damp one after the other are never damp at once: the coarse bin holding both bounds 100%, but the most seen is half', async () => {
  const { first, refine } = searchOf([{ weight: 50, matte: 0, sets: 2 }, { weight: 50, matte: 3, sets: 20000 }]);
  assert.ok(first.width > 3, 'one coarse bin holds both halves damp');
  const window = await stampDampWindow(first, 95, refine);
  assert.equal(window.kind, 'uneven');
  assert.equal(window.kind === 'uneven' && window.most.weight, 50);
});

test('a damp window is found to the step from coarse bins: from when the last part turns matte until the first part sets', async () => {
  const { first, refine } = searchOf([
    { weight: 40, matte: 1000, sets: 9000 }, { weight: 40, matte: 3000, sets: 12000 }, { weight: 20, matte: 2500, sets: 7000 }, { weight: 3, matte: 0, sets: 0 },
  ]);
  assert.deepEqual(await stampDampWindow(first, 0.95 * 103, refine), { kind: 'damp', from: 3000, to: 6999 });
});
