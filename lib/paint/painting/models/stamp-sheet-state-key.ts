// stamp-sheet-state-key.ts: a sheet program's state keys (ENGINE 4.2): K₀ hashes the program's head, each Kₖ the key
// before it and entry k as read: its digest and pose. SHA-256 over canonical JSON, alike in Node and the browser, so
// equal keys mean equal state on any machine.
//
// Canonical JSON: object keys sorted, numbers as JS prints them, undefined and functions left out, typed arrays, Sets
// and Maps as arrays. A function is dropped, so what it decides enters a key as what it made: an entry's datum holds
// its compiled marks (a hand's curve is in the stamps it placed). That's megabytes of text for a flood, so it's
// hashed as it's written and only its digest kept (stampCanonicalDigest).

import { createTextSha256, textSha256Hex } from '#lib/platform/hash/models/text-sha256.ts';
import type { StampSheetEntry } from './stamp-sheet-program.ts';

/** What a key may read: a document's data, a compiled deposit's, typed arrays and collections of them. */
export type StampCanonicalDatum =
  | string | number | boolean | null | undefined
  | ((...args: never[]) => StampCanonicalDatum)
  | Float32Array | Uint32Array | Uint8Array
  | readonly StampCanonicalDatum[]
  | ReadonlySet<StampCanonicalDatum>
  | ReadonlyMap<StampCanonicalDatum, StampCanonicalDatum>
  | { readonly [field: string]: StampCanonicalDatum };

/** `value`'s canonical JSON, a piece at a time, to `write`. Shared objects are written at each place they're met. */
function writeStampCanonical(value: StampCanonicalDatum, write: (piece: string) => void): void {
  if (value === null || value === undefined || typeof value === 'function') {
    write('null');
  } else if (typeof value === 'number') {
    write(Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value)));
  } else if (typeof value === 'string' || typeof value === 'boolean') {
    write(JSON.stringify(value));
  } else if (ArrayBuffer.isView(value) || Array.isArray(value)) {
    write('[');
    // SAFETY: a view StampCanonicalDatum admits is a typed array of numbers, read by index like a list.
    const list = value as ArrayLike<StampCanonicalDatum>;
    for (let i = 0; i < list.length; i++) {
      if (i) write(',');
      writeStampCanonical(list[i], write);
    }
    write(']');
  } else if (value instanceof Set || value instanceof Map) {
    writeStampCanonical([...value], write);
  } else {
    // SAFETY: every other kind StampCanonicalDatum admits has been written above.
    const record = value as { readonly [field: string]: StampCanonicalDatum };
    let first = true;
    write('{');
    for (const key of Object.keys(record).toSorted()) {
      const field = record[key];
      if (field === undefined || typeof field === 'function') continue;
      write(first ? `${JSON.stringify(key)}:` : `,${JSON.stringify(key)}:`);
      first = false;
      writeStampCanonical(field, write);
    }
    write('}');
  }
}

/** `value` as canonical JSON. */
export function stampCanonicalJson(value: StampCanonicalDatum): string {
  const pieces: string[] = [];
  writeStampCanonical(value, (piece) => pieces.push(piece));
  return pieces.join('');
}

/** The SHA-256 of `value`'s canonical JSON, as hex: the text hashed as it's written, never held whole. */
export function stampCanonicalDigest(value: StampCanonicalDatum): string {
  const hash = createTextSha256();
  writeStampCanonical(value, hash.update);
  return hash.hex();
}

/** K₀: the key of a program's incoming state, from its head's canonical text. */
export const stampSheetHeadKey = (head: string) => textSha256Hex(`head\n${head}`);

/** Kₖ: the key after an entry, from the key before it and the entry as read: its datum's digest at rest and the map posing it. */
export const stampSheetEntryKey = (before: string, entry: Pick<StampSheetEntry, 'digest' | 'pose'>) => textSha256Hex(`${before}\n${entry.digest}\n${entry.pose}`);
