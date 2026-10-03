// stamp-sheet-state-key.ts: a sheet program's state keys (ENGINE 4.2): K₀ hashes the program's head, each Kₖ the key
// before it and entry k as read. SHA-256 over canonical JSON, the same in Node and the browser (WebCrypto), so equal
// keys mean equal state on any machine that solves them; nothing of a key enters a solve.
//
// Canonical JSON: object keys sorted, numbers as JS prints them (shortest round trip), undefined and functions left
// out (a function's work is in what it made: a hand's curve in the stamps it placed), typed arrays, Sets and Maps as
// arrays.

/** What a key may read: a document's data, a compiled deposit's, typed arrays and collections of them. */
export type StampCanonicalDatum =
  | string | number | boolean | null | undefined
  | ((...args: never[]) => StampCanonicalDatum)
  | Float32Array | Uint32Array | Uint8Array
  | readonly StampCanonicalDatum[]
  | ReadonlySet<StampCanonicalDatum>
  | ReadonlyMap<StampCanonicalDatum, StampCanonicalDatum>
  | { readonly [field: string]: StampCanonicalDatum };

/** `value` as canonical JSON. Shared objects are written at each place they're met. */
export function stampCanonicalJson(value: StampCanonicalDatum): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'function') return 'null';
  if (ArrayBuffer.isView(value)) return stampCanonicalJson(Array.from(value));
  if (Array.isArray(value)) return `[${value.map(stampCanonicalJson).join(',')}]`;
  if (value instanceof Set) return stampCanonicalJson([...value]);
  if (value instanceof Map) return stampCanonicalJson([...value]);
  // SAFETY: every other kind StampCanonicalDatum admits has returned above.
  const record = value as { readonly [field: string]: StampCanonicalDatum };
  const fields = Object.keys(record).toSorted().flatMap((key) => {
    const field = record[key];
    return field === undefined || typeof field === 'function' ? [] : [`${JSON.stringify(key)}:${stampCanonicalJson(field)}`];
  });
  return `{${fields.join(',')}}`;
}

/** SHA-256 of `text`'s UTF-8, as hex. */
export async function stampSheetHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** K₀: the key of a program's incoming state, from its head's canonical text. */
export const stampSheetHeadKey = (head: string) => stampSheetHash(`head\n${head}`);

/** Kₖ: the key after an entry, from the key before it and the entry's canonical text as read. */
export const stampSheetEntryKey = (before: string, entry: string) => stampSheetHash(`${before}\n${entry}`);
