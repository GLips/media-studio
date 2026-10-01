// stamp-material-keys.ts: a deposit's material changing over its scene, as a sky's mixtures shift through a sunset.
// The painting keeps its marks; only its paint changes. Between keys each pigment's laid amount eases linearly (flat
// colour by its gamma-encoded channels), as a graded wash does across space.
//
// Negative space: a recolour repaints the groups it touches. The wet laws and paper contact aren't linear in pigment
// amounts (the flow's hold, a lift's stain, coverage under a move, how firmly paint meets the tooth), so no
// colour-free layer can be kept and recoloured afterwards.

/** Keys holding at least one: what a compiled painting reads, so its first and last always exist. */
export type StampKeyList<K> = readonly [K, ...K[]];

/** One key: `material` from `at` seconds into the scene. */
export type StampMaterialKey<M> = { at: number; material: M };

/** A material over scene time as written: each key eased into the next and held beyond the first and last. */
export type StampMaterialKeys<M> = { kind: 'keys'; keys: readonly StampMaterialKey<M>[] };

/** A material over scene time as compiled (compileStampMaterialKeys): at least one key, at finite increasing times. */
export type CompiledStampMaterialKeys<M> = { kind: 'keys'; keys: StampKeyList<StampMaterialKey<M>> };

/** `list` with each key mapped, still holding at least one. */
export function mapStampKeyList<K, U>(list: StampKeyList<K>, map: (key: K) => U): StampKeyList<U> {
  const [first, ...rest] = list;
  return [map(first), ...rest.map(map)];
}

/** Whether every key of `list` is an `S`, so the list is one of them. */
export const everyStampKey = <K, S extends K>(list: StampKeyList<K>, is: (key: K) => key is S): list is StampKeyList<S> => list.every(is);

/** Where `t` falls among `keys`: the key before and after it, and the share of the way between, held beyond them. */
export function stampKeySpanAt(keys: StampKeyList<{ at: number }>, t: number): { from: number; to: number; share: number } {
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

/** `written`, which stampMaterialKeysProblem passed, as compiled, each key's material mapped by `map`. */
export function compileStampMaterialKeys<M, U>(written: StampMaterialKeys<M>, map: (material: M) => U): CompiledStampMaterialKeys<U> {
  if (!written.keys.length) throw new Error('stamp paint: a keyed material reached compiling with no keys');
  const [first, ...rest] = written.keys;
  return { kind: 'keys', keys: mapStampKeyList([first, ...rest], ({ at, material }) => ({ at, material: map(material) })) };
}

/** The scene seconds over which `keys` change their material: from the first key to the last. */
export const stampMaterialKeysSpan = ({ keys }: CompiledStampMaterialKeys<unknown>) => ({ from: keys[0].at, to: keys[keys.length - 1].at });
