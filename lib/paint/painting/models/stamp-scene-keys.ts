// stamp-scene-keys.ts: what changes over a painting's scene, as keys: a group's placement as it moves
// (stamp-group-motion.ts) and a deposit's material as it recolours (stamp-material-keys.ts). Each key is `at` seconds
// into the scene; between two keys a value eases linearly from one to the next, and beyond the first and last it holds.
// What eases (a placement's offsets, a pigment's amount, a colour's channels) is each one's own.

/** Keys holding at least one: what a compiled painting reads, so its first and last always exist. */
export type StampKeyList<K> = readonly [K, ...K[]];

/** `list` with each key mapped, still holding at least one. */
export function mapStampKeyList<K, U>(list: StampKeyList<K>, map: (key: K) => U): StampKeyList<U> {
  const [first, ...rest] = list;
  return [map(first), ...rest.map(map)];
}

/** Whether every key of `list` is an `S`, so the list is one of them. */
export const everyStampKey = <K, S extends K>(list: StampKeyList<K>, is: (key: K) => key is S): list is StampKeyList<S> => list.every(is);

/** Why `keys` can't be eased, or null: none, or their times not finite and increasing. */
export function stampKeyTimesProblem(keys: readonly { at: number }[]): string | null {
  if (!keys.length) return 'it has no keys';
  for (const [i, { at }] of keys.entries()) {
    if (!Number.isFinite(at)) return `key ${i} is at ${at}s, not a finite time`;
    if (i && !(at > keys[i - 1].at)) return `its keys need increasing times; key ${i} is at ${at}s`;
  }
  return null;
}

/** `keys`, which stampKeyTimesProblem passed, as a list holding at least one; `what` names them if it didn't. */
export function stampKeyList<K extends { at: number }>(keys: readonly K[], what: string): StampKeyList<K> {
  const [first, ...rest] = keys;
  if (!first) throw new Error(`stamp paint: ${what} reached compiling with no keys`);
  return [first, ...rest];
}

/** Where `t` falls among `keys`: the key before and after it, and the share of the way between, held beyond them. */
export function stampKeySpanAt(keys: StampKeyList<{ at: number }>, t: number): { from: number; to: number; share: number } {
  const next = keys.findIndex((key) => key.at > t);
  if (next === 0) return { from: 0, to: 0, share: 0 };
  if (next < 0) return { from: keys.length - 1, to: keys.length - 1, share: 0 };
  return { from: next - 1, to: next, share: (t - keys[next - 1].at) / (keys[next].at - keys[next - 1].at) };
}

/** The scene seconds over which `keys` change what they key: from the first key to the last. */
export const stampKeysSpan = (keys: StampKeyList<{ at: number }>) => ({ from: keys[0].at, to: keys[keys.length - 1].at });
