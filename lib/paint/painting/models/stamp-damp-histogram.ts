// stamp-damp-histogram.ts: when `damp` holds over a core, found from the damp histograms the GPU bins
// (stamp-sheet-reductions.ts): each wetted core texel's weight by the 1 ms step from τ0 it turns matte, and by the last
// step it's still workable. A texel is damp at step k when it has turned matte by k and sets after it, so a bin's bound
// (what's matte by its end less what has set by its start) is the most damp weight any of its steps holds, and a bin a
// step wide holds it exactly. A search refines the bins whose bound reaches its need until they're a step wide.

import { STAMP_SHEET_STEP, stampSheetWide } from './stamp-sheet-schedule.ts';

/** Bins a damp histogram pass sorts weight into. */
export const STAMP_DAMP_HISTOGRAM_BINS = 4096;

/**
 * A damp histogram: bins `width` 1 ms steps wide from step `start` (steps counted from τ0); in each, the weight turning
 * matte (`matte`) and the weight whose last workable step falls there (`sets`: set from the step after); the weight
 * matte before `start` (`matteBefore`), and set by it (`setBy`), which takes every texel set by τ0.
 */
export type StampDampHistogram = { start: number; width: number; matte: Float64Array; sets: Float64Array; matteBefore: number; setBy: number };

/** A histogram pass's words read as one: two words a bin, matte's then sets', then matte-before's two and set-by's two. */
export function stampDampHistogram(words: Uint32Array, start: number, width: number): StampDampHistogram {
  const bins = STAMP_DAMP_HISTOGRAM_BINS, matte = new Float64Array(bins), sets = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    matte[b] = stampSheetWide(words, 2 * b);
    sets[b] = stampSheetWide(words, 2 * (bins + b));
  }
  return { start, width, matte, sets, matteBefore: stampSheetWide(words, 4 * bins), setBy: stampSheetWide(words, 4 * bins + 2) };
}

/** The words a histogram pass leaves. */
export const STAMP_DAMP_HISTOGRAM_WORDS = 4 * STAMP_DAMP_HISTOGRAM_BINS + 4;

/** Each bin's most damp weight: what's matte by its end less what has set by its start; exact for a bin a step wide. */
export function stampDampBinBounds(histogram: StampDampHistogram): Float64Array {
  const bounds = new Float64Array(STAMP_DAMP_HISTOGRAM_BINS);
  let matte = histogram.matteBefore, set = histogram.setBy;
  for (let b = 0; b < STAMP_DAMP_HISTOGRAM_BINS; b++) {
    matte += histogram.matte[b];
    bounds[b] = matte - set;
    set += histogram.sets[b];
  }
  return bounds;
}

/** The first histogram over steps 0..`last`: bins wide enough that 4096 of them reach it. */
export const stampDampFirstWidth = (last: number) => Math.max(1, Math.ceil((last + 1) / STAMP_DAMP_HISTOGRAM_BINS));

/** A bin's refinement: its steps, binned 4096 ways. */
export const stampDampRefined = (histogram: StampDampHistogram, bin: number) => ({ start: histogram.start + bin * histogram.width, width: Math.ceil(histogram.width / STAMP_DAMP_HISTOGRAM_BINS) });

/** The step of `kL` or `kZ` from a time, `tau0` and the time both after the same base: its first 1 ms step at or past it, at least 0. */
export const stampDampStep = (time: number, tau0: number) => Math.max(0, Math.ceil((time - tau0) / STAMP_SHEET_STEP - 1e-9));

/** Reads a bin's refinement off the GPU. */
export type StampDampRefine = (at: { start: number; width: number }) => Promise<StampDampHistogram>;

/** The most damp weight a search saw, and at which step: an upper bound wherever a bin wider than a step gave it. */
export type StampDampMost = { weight: number; step: number };

/**
 * The first (or `last`) step whose damp weight reaches `need`: each bin whose bound reaches it, in order (from the
 * end, for `last`), refined until a step wide. Resolves that step, or null and the most it saw: a step-wide bin's
 * weight, or an unrefined bin's bound under `need`, never a refined bin's.
 */
async function stampDampSearch(first: StampDampHistogram, need: number, refine: StampDampRefine, last: boolean): Promise<{ step: number | null; most: StampDampMost }> {
  const most: StampDampMost = { weight: 0, step: first.start };
  const search = async (histogram: StampDampHistogram): Promise<number | null> => {
    const bounds = stampDampBinBounds(histogram), order = Array.from({ length: STAMP_DAMP_HISTOGRAM_BINS }, (_, i) => (last ? STAMP_DAMP_HISTOGRAM_BINS - 1 - i : i));
    const reaching = order.filter((b) => {
      if (bounds[b] >= need) return true;
      if (bounds[b] > most.weight) Object.assign(most, { weight: bounds[b], step: histogram.start + b * histogram.width });
      return false;
    });
    if (histogram.width === 1) return reaching.length ? histogram.start + reaching[0] : null;
    const refinedFrom = async (i: number): Promise<number | null> => {
      if (i === reaching.length) return null;
      return (await search(await refine(stampDampRefined(histogram, reaching[i])))) ?? refinedFrom(i + 1);
    };
    return refinedFrom(0);
  };
  return { step: await search(first), most };
}

/** The first step whose damp weight reaches `need`, or null and the most damp weight seen (stampDampSearch). */
export const stampDampFirstStep = (first: StampDampHistogram, need: number, refine: StampDampRefine) => stampDampSearch(first, need, refine, false);

/**
 * When a core is damp over a need, in steps from its histograms' τ: `damp` from the first step that holds it through
 * the last (`to`, inclusive); or `uneven`, never at once, and the most damp weight seen.
 */
export type StampDampSteps = { kind: 'damp'; from: number; to: number } | { kind: 'uneven'; most: StampDampMost };

/**
 * When a core is damp over `need` of its weight, from its first histogram (StampDampSteps). Each refinement is read
 * once, though both searches may ask for it.
 */
export async function stampDampWindow(first: StampDampHistogram, need: number, refine: StampDampRefine): Promise<StampDampSteps> {
  const read = new Map<string, Promise<StampDampHistogram>>();
  const once: StampDampRefine = (at) => {
    const key = `${at.start}/${at.width}`;
    if (!read.has(key)) read.set(key, refine(at));
    return read.get(key)!;
  };
  const from = await stampDampSearch(first, need, once, false);
  if (from.step === null) return { kind: 'uneven', most: from.most };
  const to = await stampDampSearch(first, need, once, true);
  return { kind: 'damp', from: from.step, to: to.step! };
}
