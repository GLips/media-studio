// photoshop-reading-spread.ts: vid-97's per-brush diagnostic for the PhotoshopReading (photoshop-reading.ts), before
// any shared fit. Each constant is fitted brush by brush, among candidates about its current value, and where the
// brushes' best values fall says what the constant is: a tight cluster is a real shared constant; two clusters are a
// branch on some brush field the model is missing; scattered values mean the model is still wrong there. Which
// brushes count: only those whose preset uses the mechanism, and only the training split.
//
// The split: Kyle T. Webster's packs are held out whole (another author's brushes, never fitted to); of Legacy
// Brushes, the training pack, a fifth is held out, chosen by a hash of the brush's name so it never moves.

import type { PhotoshopReading } from './photoshop-brush.ts';
import type { PhotoshopPreset } from './photoshop-preset.ts';

/** Candidates for each constant, as multiples of its current value. */
export const PHOTOSHOP_READING_MULTIPLES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3] as const;

/** A brush whose best and worst candidates score closer than this doesn't tell the candidates apart. */
export const PHOTOSHOP_READING_INSENSITIVE = 0.02;

/** Whether `preset` uses the mechanism `key` reads; hue jitter is colour, which a coverage sheet can't see. */
export function photoshopReadingUses(key: keyof PhotoshopReading, preset: PhotoshopPreset): boolean {
  switch (key) {
    case 'scatterSpan': return (preset.scatter?.scatter.jitter ?? 0) > 0;
    case 'angleJitterSpan': return (preset.tipDynamics?.angle.jitter ?? 0) > 0;
    case 'dualScale': return !!preset.dual;
    case 'hueJitterShare': return false;
  }
}

/** Packs held out whole from every fit. */
export const PHOTOSHOP_HELD_OUT_PACKS: readonly string[] = ['kyle-watercolor', 'kyle-dry-media', 'kyle-gouache'];

/** Whether a brush is held out of fitting: every brush of a held-out pack, and a fifth of the rest by name. */
export function photoshopBrushHeldOut(pack: string, name: string): boolean {
  if (PHOTOSHOP_HELD_OUT_PACKS.includes(pack)) return true;
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619) >>> 0;
  return hash % 5 === 0;
}

export type PhotoshopReadingSpread = 'tight' | 'bimodal' | 'scattered' | 'too few';

/**
 * What brushes' best candidates (indices into PHOTOSHOP_READING_MULTIPLES) say: tight when seven in ten sit on one
 * candidate or its neighbours, bimodal when two candidates apart each hold a quarter, else scattered.
 */
export function photoshopReadingSpread(bests: readonly number[]): PhotoshopReadingSpread {
  if (bests.length < 4) return 'too few';
  const counts = PHOTOSHOP_READING_MULTIPLES.map((_, i) => bests.filter((b) => b === i).length);
  const near = (i: number) => (counts[i - 1] ?? 0) + counts[i] + (counts[i + 1] ?? 0);
  if (counts.some((_, i) => near(i) >= 0.7 * bests.length)) return 'tight';
  const heavy = counts.flatMap((n, i) => (n >= 0.25 * bests.length ? [i] : []));
  if (heavy.length >= 2 && heavy.at(-1)! - heavy[0] > 1) return 'bimodal';
  return 'scattered';
}
