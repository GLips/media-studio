// stamp-material-keys.ts: a deposit's material changing over its scene, as a sky's mixtures shift through a sunset,
// keyed as stamp-scene-keys.ts keys anything. The painting keeps its marks; only its paint changes. Between keys each
// pigment's laid amount eases linearly (flat colour by its gamma-encoded channels), as a graded wash does across space.
//
// Negative space: a recolour repaints the groups it touches. The wet laws and paper contact aren't linear in pigment
// amounts (the flow's hold, a lift's stain, coverage under a move, how firmly paint meets the tooth), so no
// colour-free layer can be kept and recoloured afterwards.

import { mapStampKeyList, stampKeyList, stampKeyTimesProblem, type StampKeyList } from './stamp-scene-keys.ts';

/** One key: `material` from `at` seconds into the scene. */
export type StampMaterialKey<M> = { at: number; material: M };

/** A material over scene time as written: each key eased into the next and held beyond the first and last. */
export type StampMaterialKeys<M> = { kind: 'keys'; keys: readonly StampMaterialKey<M>[] };

/** A material over scene time as compiled (compileStampMaterialKeys): at least one key, at finite increasing times. */
export type CompiledStampMaterialKeys<M> = { kind: 'keys'; keys: StampKeyList<StampMaterialKey<M>> };

/** Why `keys` can't be painted, or null: none, times not finite and increasing, or a material as `materialProblem` says. */
export function stampMaterialKeysProblem<M>({ keys }: StampMaterialKeys<M>, materialProblem: (material: M) => string | null): string | null {
  const timing = stampKeyTimesProblem(keys);
  if (timing) return timing;
  for (const [i, { material }] of keys.entries()) {
    const problem = materialProblem(material);
    if (problem) return `key ${i}: ${problem}`;
  }
  return null;
}

/** `written`, which stampMaterialKeysProblem passed, as compiled, each key's material mapped by `map`. */
export function compileStampMaterialKeys<M, U>(written: StampMaterialKeys<M>, map: (material: M) => U): CompiledStampMaterialKeys<U> {
  return { kind: 'keys', keys: mapStampKeyList(stampKeyList(written.keys, 'a keyed material'), ({ at, material }) => ({ at, material: map(material) })) };
}

