// stamp-material-set.ts: the wells a painter loads a brush from, a brushful at a time, so neighbouring marks differ.
// A set is drawn from by generators (a charge, per touch); a single deposit's material stays a material or a field.

import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampPaintMaterial } from './stamp-paint-recipe-types.ts';

/** A well: its `id`, unique in its set, its material, and how often it's picked against the others (`weight`, from 0). */
export type StampMaterialSetEntry = { id: string; material: StampPaintMaterial; weight: number };
export type StampMaterialSet = { kind: 'set'; entries: readonly StampMaterialSetEntry[] };

/**
 * A set of wells by ID: each a material, picked as often as the others, or a material with its own `weight`. Throws
 * where stampMaterialSetProblem would refuse it, so a bad set fails where it's written, not where it's drawn from.
 */
export function stampMaterialSet(wells: { readonly [id: string]: StampPaintMaterial | { material: StampPaintMaterial; weight: number } }): StampMaterialSet {
  const set: StampMaterialSet = {
    kind: 'set',
    entries: Object.entries(wells).map(([id, well]) => ('material' in well ? { id, material: well.material, weight: well.weight } : { id, material: well, weight: 1 })),
  };
  const problem = stampMaterialSetProblem(set);
  if (problem) throw new Error(`stamp paint: a material set can't be drawn from: ${problem}`);
  return set;
}

/** Why `set` can't be drawn from, or null: it needs an entry, unique IDs, finite weights from 0 and some weight in all. */
export function stampMaterialSetProblem({ entries }: StampMaterialSet): string | null {
  if (!entries.length) return 'it has no entries';
  const ids = new Set<string>();
  for (const { id, weight } of entries) {
    if (ids.has(id)) return `${JSON.stringify(id)} is in it twice`;
    ids.add(id);
    if (!(weight >= 0) || !Number.isFinite(weight)) return `${JSON.stringify(id)} weighs ${weight}, and a weight is finite from 0`;
  }
  return entries.some(({ weight }) => weight > 0) ? null : 'every entry weighs 0';
}

/** The material `set` gives the brushful named `key`, by weight, the same for the same key. Throws on a set stampMaterialSetProblem refuses. */
export function pickStampMaterial(set: StampMaterialSet, key: string): StampPaintMaterial {
  const problem = stampMaterialSetProblem(set);
  if (problem) throw new Error(`stamp paint: ${key} picks from a material set that can't be drawn from: ${problem}`);
  const total = set.entries.reduce((sum, { weight }) => sum + weight, 0);
  let left = seededRandom(key)() * total;
  for (const entry of set.entries) {
    if (entry.weight > 0 && left < entry.weight) return entry.material;
    left -= entry.weight;
  }
  // Rounding can leave a hair of `left` past the last weight: the last well with any weight takes it.
  return set.entries.findLast(({ weight }) => weight > 0)!.material;
}
