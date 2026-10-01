// stamp-material-keys.ts: a deposit's material changing over its scene, as a sky's mixtures shift through a sunset.
// The painting keeps its marks; only its paint changes. Between keys each pigment's laid amount eases linearly (flat
// colour by its gamma-encoded channels), as a graded wash does across space.
//
// Negative space: a recolour repaints the groups it touches. The wet laws aren't linear in pigment amounts (the
// flow's hold, a lift's stain, coverage under a move), so no colour-free layer can be kept and recoloured afterwards.

/**
 * A material over scene time: each key's from `at` seconds into the scene, eased into the next and held beyond the
 * first and last.
 */
export type StampMaterialKeys<M> = { kind: 'keys'; keys: readonly { at: number; material: M }[] };

/** Where `t` falls among `keys`: the key before and after it, and the share of the way between, held beyond them. */
export function stampKeySpanAt(keys: readonly { at: number }[], t: number): { from: number; to: number; share: number } {
  const next = keys.findIndex((key) => key.at > t);
  if (next === 0) return { from: 0, to: 0, share: 0 };
  if (next < 0) return { from: keys.length - 1, to: keys.length - 1, share: 0 };
  return { from: next - 1, to: next, share: (t - keys[next - 1].at) / (keys[next].at - keys[next - 1].at) };
}

/** Why `keys` can't be painted, or null: none, times not finite and increasing, or a material as `materialProblem` says. */
export function stampMaterialKeysProblem<M>({ keys }: StampMaterialKeys<M>, materialProblem: (material: M) => string | null): string | null {
  if (!keys.length) return 'it has no keys';
  for (const [i, { at, material }] of keys.entries()) {
    if (!Number.isFinite(at)) return `key ${i} is at ${at}s, not a finite time`;
    if (i && !(at > keys[i - 1].at)) return `its keys need increasing times; key ${i} is at ${at}s`;
    const problem = materialProblem(material);
    if (problem) return `key ${i}: ${problem}`;
  }
  return null;
}

/** The scene seconds over which `keys` change their material: from the first key to the last. */
export const stampMaterialKeysSpan = ({ keys }: StampMaterialKeys<unknown>) => ({ from: keys[0].at, to: keys[keys.length - 1].at });
