// brush-reading-spread.ts: vid-97's per-brush diagnostic of an app's reading (brush-readings.ts), before any shared
// fit. Each constant is fitted brush by brush, among candidates about its current value (brushReadingCandidates), and
// where the brushes' best values fall says what the constant is: a tight cluster is a real shared constant; two
// clusters are a branch on some brush field the model is missing; scattered values mean the model is still wrong
// there. Which brushes count: only those whose source uses the mechanism, and only the training split (each app's
// heldOut).

/** A brush whose best and worst candidates score closer than this doesn't tell the candidates apart. */
export const BRUSH_READING_INSENSITIVE = 0.02;

export type BrushReadingSpread = 'tight' | 'bimodal' | 'scattered' | 'too few';

/**
 * What brushes' best candidates (indices into the `candidates` ascending values) say: tight when seven in ten sit on
 * one candidate or its neighbours, bimodal when two candidates apart each hold a quarter, else scattered.
 */
export function brushReadingSpread(bests: readonly number[], candidates: number): BrushReadingSpread {
  if (bests.length < 4) return 'too few';
  const counts = Array.from({ length: candidates }, (_, i) => bests.filter((b) => b === i).length);
  const near = (i: number) => (counts[i - 1] ?? 0) + counts[i] + (counts[i + 1] ?? 0);
  if (counts.some((_, i) => near(i) >= 0.7 * bests.length)) return 'tight';
  const heavy = counts.flatMap((n, i) => (n >= 0.25 * bests.length ? [i] : []));
  if (heavy.length >= 2 && heavy.at(-1)! - heavy[0] > 1) return 'bimodal';
  return 'scattered';
}
