// stamp-kept-memo.ts: the paint engine's bounded memos, kept by bytes, the least recently asked for given up first.
// Finding a value counts as asking for it.

/** What a memo keeps: how many values, and about how many bytes they hold. */
export type StampKeptHeld = { readonly count: number; readonly bytes: number };

/** Values by key, each holding about `bytes`, at most a budget of them all. */
export type StampKeptByBytes<K, V> = {
  readonly get: (key: K) => V | undefined;
  /** Keeps `value`, giving up the least recently asked for past the budget; one larger than the budget alone isn't kept. */
  readonly set: (key: K, value: V, bytes: number) => void;
  readonly held: () => StampKeptHeld;
};

/** A memo keeping the values last asked for, up to `maxBytes` of them. */
export function createKeptByBytes<K, V>(maxBytes: number): StampKeptByBytes<K, V> {
  const kept = new Map<K, { readonly value: V; readonly bytes: number }>();
  let keptBytes = 0;
  const forget = (key: K) => {
    const entry = kept.get(key);
    if (!entry) return;
    kept.delete(key);
    keptBytes -= entry.bytes;
  };
  return {
    get: (key) => {
      const entry = kept.get(key);
      if (!entry) return undefined;
      kept.delete(key);
      kept.set(key, entry);
      return entry.value;
    },
    set: (key, value, bytes) => {
      forget(key);
      if (bytes > maxBytes) return;
      kept.set(key, { value, bytes });
      keptBytes += bytes;
      for (const oldest of kept.keys()) {
        if (keptBytes <= maxBytes) break;
        forget(oldest);
      }
    },
    held: () => ({ count: kept.size, bytes: keptBytes }),
  };
}
