// shot-key-drawings.ts: which moments of a painting in time are solved, its key drawings. Each sample is a point in
// property space (numbers scaled to their ranges), the drawing it quantises to, and its run (booleans and enums).
// The first and last samples are keys, and both sides of each change of run (a cut). Then, within the budget, the
// stretch travelling farthest is split: where its path turns farthest from the straight dissolve, if a quarter of
// its travel or more, else halfway. A split draws what neither end draws.

/** A moment's values as the chooser reads them: the drawing they quantise to, their run, and their numbers 0..1 of their ranges. */
export type ShotKeySample = { readonly drawing: string; readonly run: string; readonly unit: readonly number[] };

/** Why a moment is a key: the first or last, either side of a cut, where its values turn, or halfway along a change. */
export type ShotKeyReason = 'first' | 'last' | 'cut' | 'turn' | 'between';

export type ShotKeyChoice = { readonly sample: number; readonly reason: ShotKeyReason };

/** The keys chosen, by sample; `fits` false when the first, last and cuts alone draw more than the budget, those keys then. */
export type ShotKeyChoices = { readonly keys: readonly ShotKeyChoice[]; readonly fits: boolean };

const minus = (a: readonly number[], b: readonly number[]) => a.map((value, i) => value - b[i]);
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const lengthOf = (a: readonly number[]) => Math.sqrt(dot(a, a));

/**
 * How far `at` has come from `a` toward `b`, 0..1: its projection on the line between them, clamped. 0 when they're
 * one point. A frame between two keys dissolves them by it.
 */
export function shotKeyDissolveK(a: readonly number[], b: readonly number[], at: readonly number[]): number {
  const along = minus(b, a), squared = dot(along, along);
  return squared === 0 ? 0 : Math.min(1, Math.max(0, dot(minus(at, a), along) / squared));
}

/** What `at` misses its dissolve between `a` and `b` by, number by number: `at` less the point the dissolve shows. */
export function shotKeyDissolveMiss(a: readonly number[], b: readonly number[], at: readonly number[]): number[] {
  const k = shotKeyDissolveK(a, b, at);
  return at.map((value, i) => value - (a[i] + k * (b[i] - a[i])));
}

/**
 * Where to split the stretch between keys `a` and `b`, among the samples between them drawing what neither end
 * draws and `affordable` allows: where its path turns farthest from the line between its ends, if a quarter of its
 * travel or more; else the one nearest halfway along its path. Null when none may split it.
 */
function stretchSplit(
  samples: readonly ShotKeySample[], travelled: readonly number[], a: number, b: number, affordable: (drawing: string) => boolean,
): ShotKeyChoice | null {
  const from = samples[a], to = samples[b], open: number[] = [];
  for (let i = a + 1; i < b; i++) {
    const { drawing } = samples[i];
    if (drawing !== from.drawing && drawing !== to.drawing && affordable(drawing)) open.push(i);
  }
  if (!open.length) return null;
  const off = open.map((i) => lengthOf(shotKeyDissolveMiss(from.unit, to.unit, samples[i].unit))), farthest = off.indexOf(Math.max(...off));
  const travel = travelled[b] - travelled[a];
  if (off[farthest] > 0 && off[farthest] >= travel / 4) return { sample: open[farthest], reason: 'turn' };
  const half = travelled[a] + travel / 2, gaps = open.map((i) => Math.abs(travelled[i] - half));
  return { sample: open[gaps.indexOf(Math.min(...gaps))], reason: 'between' };
}

/**
 * The key drawings of `samples` (in time order, at least one), at most `budget` drawings (see the file's head): a
 * stretch travelling farther is split first, the earlier of two alike. A key drawing what a key already draws costs
 * nothing, so splits go on once the budget's spent, among drawings already made.
 */
export function chooseShotKeyDrawings(samples: readonly ShotKeySample[], budget: number): ShotKeyChoices {
  const reasons = new Map<number, ShotKeyReason>();
  const keyAt = (sample: number, reason: ShotKeyReason) => {
    if (!reasons.has(sample)) reasons.set(sample, reason);
  };
  const keys = () => [...reasons].map(([sample, reason]) => ({ sample, reason })).toSorted((a, b) => a.sample - b.sample);
  keyAt(0, 'first');
  keyAt(samples.length - 1, 'last');
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].run === samples[i - 1].run) continue;
    keyAt(i - 1, 'cut');
    keyAt(i, 'cut');
  }
  const drawn = new Set([...reasons.keys()].map((sample) => samples[sample].drawing));
  if (drawn.size > budget) return { keys: keys(), fits: false };
  const travelled = samples.map(() => 0);
  for (let i = 1; i < samples.length; i++) travelled[i] = travelled[i - 1] + lengthOf(minus(samples[i].unit, samples[i - 1].unit));
  const affordable = (drawing: string) => drawn.size < budget || drawn.has(drawing);
  for (;;) {
    const ordered = keys();
    let best: { readonly split: ShotKeyChoice; readonly travel: number } | null = null;
    for (let j = 1; j < ordered.length; j++) {
      const a = ordered[j - 1].sample, b = ordered[j].sample, travel = travelled[b] - travelled[a];
      if (samples[a].run !== samples[b].run || (best && travel <= best.travel)) continue;
      const split = stretchSplit(samples, travelled, a, b, affordable);
      if (split) best = { split, travel };
    }
    if (!best) return { keys: ordered, fits: true };
    keyAt(best.split.sample, best.split.reason);
    drawn.add(samples[best.split.sample].drawing);
  }
}
