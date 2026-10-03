// stamp-remembered.ts: what a painting works out from frozen inputs (marks, tips, levels), worked out once each.
//
// The inputs are never written after they're made, so whatever is derived from them stays true; a recompile shares
// its unchanged deposits' inputs, and with them everything already worked out. Shared values: never write them.

/** A cache `rememberedOnce` reads and fills: a Map, or a WeakMap keyed by the object derived from. */
type StampRememberedCache<K, V> = { get(key: K): V | undefined; set(key: K, value: V): void };

/** `make()` for `key`, worked out the first time it's asked for. */
export function rememberedOnce<K, V>(cache: StampRememberedCache<K, V>, key: K, make: () => V): V {
  let value = cache.get(key);
  if (value === undefined) cache.set(key, (value = make()));
  return value;
}

/** `make()` for `of` under `key`, worked out the first time it's asked for. */
export const rememberedFor = <O extends object, K, V>(cache: WeakMap<O, Map<K, V>>, of: O, key: K, make: () => V): V =>
  rememberedOnce(rememberedOnce(cache, of, () => new Map<K, V>()), key, make);
