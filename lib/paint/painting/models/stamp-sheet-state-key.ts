// stamp-sheet-state-key.ts: a sheet program's state keys (ENGINE 4.2): K₀ hashes the program's head, each Kₖ the key
// before it and entry k as read: its digest and pose. SHA-256, alike in Node and the browser, so equal keys mean equal
// state on any machine.
//
// Canonical JSON: object keys sorted, numbers as JS prints them, undefined and functions left out, typed arrays, Sets
// and Maps as arrays. A function is dropped, so what it decides enters a key as what it made: an entry's datum holds
// its compiled marks (a hand's curve is in the stamps it placed). That's megabytes for a flood, so its digest hashes
// the same reading as bytes, as they're written (stampCanonicalDigest).

import { createSha256, textSha256Hex, type Sha256 } from '#lib/platform/hash/models/sha256.ts';
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

/** What opens each value in the canonical bytes. */
const CANONICAL_TAG = { null: 0, false: 1, true: 2, number: 3, byte: 4, string: 5, list: 6, shape: 7, shaped: 8, shapedByte: 9 } as const;

/** A record's fields as written: sorted, each with its name's canonical bytes, and `names`, naming the set. */
type StampCanonicalFields = { readonly names: string; readonly fields: readonly { readonly key: string; readonly named: Uint8Array }[] };

/** The most key orders the field caches keep. */
const CANONICAL_SHAPES_KEPT = 4096;

/** Each set of field names' fields, by the names sorted. */
const canonicalFieldsBySorted = new Map<string, StampCanonicalFields>();

/** The fields named `sorted`, in order. */
function stampCanonicalSortedFields(sorted: readonly string[]): StampCanonicalFields {
  const names = JSON.stringify(sorted);
  let fields = canonicalFieldsBySorted.get(names);
  if (!fields) canonicalFieldsBySorted.set(names, (fields = { names, fields: sorted.map((key) => ({ key, named: stampCanonicalStringBytes(key) })) }));
  return fields;
}

/**
 * Records' fields by their keys in the order met: a mark list is thousands of records alike, and sorting and encoding
 * each one's keys afresh would cost more than the hashing.
 */
const canonicalFieldsByKeys = new Map<string, StampCanonicalFields>();

/** The keys last looked up and their fields: a mark list's records come one after another alike, a stamp's tint between. */
const lastFields: { keys: readonly string[]; fields: StampCanonicalFields }[] = [];

function stampCanonicalFields(keys: readonly string[]): StampCanonicalFields {
  for (const last of lastFields) if (last.keys.length === keys.length && last.keys.every((key, i) => key === keys[i])) return last.fields;
  const fields = stampCanonicalFieldsMet(keys);
  lastFields.unshift({ keys, fields });
  lastFields.length = Math.min(lastFields.length, 4);
  return fields;
}

function stampCanonicalFieldsMet(keys: readonly string[]): StampCanonicalFields {
  const met = JSON.stringify(keys);
  let fields = canonicalFieldsByKeys.get(met);
  if (!fields) {
    // Records keyed by their data (a document's pigments by id) make a shape each: past the cap, start again.
    if (canonicalFieldsByKeys.size >= CANONICAL_SHAPES_KEPT) {
      canonicalFieldsByKeys.clear();
      canonicalFieldsBySorted.clear();
    }
    canonicalFieldsByKeys.set(met, (fields = stampCanonicalSortedFields(keys.toSorted())));
  }
  return fields;
}

/** A string's canonical bytes: its tag, its length in UTF-16 units, and the units, each little-endian. */
function stampCanonicalStringBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(5 + 2 * text.length), view = new DataView(bytes.buffer);
  bytes[0] = CANONICAL_TAG.string;
  view.setUint32(1, text.length, true);
  for (let i = 0; i < text.length; i++) view.setUint16(5 + 2 * i, text.charCodeAt(i), true);
  return bytes;
}

/** Bytes gathered before they're hashed; a string longer than the rest of them is hashed alone. */
const CANONICAL_CHUNK_BYTES = 1 << 16;

/**
 * `root`'s canonical bytes, to `hash`: canonical JSON's reading, with a finite number a byte when it's one, else its
 * float64 (-0 as 0), so equal canonical JSON means equal bytes. A record names its fields the first time the value
 * meets that set (its shape), then gives the shape's number: a mark list's records share one or two.
 */
function hashStampCanonical(root: StampCanonicalDatum, hash: Sha256): void {
  const bytes = new Uint8Array(CANONICAL_CHUNK_BYTES), view = new DataView(bytes.buffer);
  // The shapes met, numbered in the order met. By name: the caches may start again, making a shape met a new object.
  const shapesMet = new Map<string, number>(), shapesMetByObject = new Map<StampCanonicalFields, number>();
  let at = 0;
  const room = (needed: number) => {
    if (at + needed > CANONICAL_CHUNK_BYTES) {
      hash.update(bytes, 0, at);
      at = 0;
    }
  };
  const putBytes = (more: Uint8Array) => {
    if (more.length > CANONICAL_CHUNK_BYTES) {
      room(CANONICAL_CHUNK_BYTES);
      hash.update(more);
      return;
    }
    room(more.length);
    bytes.set(more, at);
    at += more.length;
  };
  const put = (value: StampCanonicalDatum): void => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        // As canonical JSON writes it: the string it prints as.
        putBytes(stampCanonicalStringBytes(String(value)));
      } else if (value >= 0 && value <= 255 && Number.isInteger(value)) {
        // Most of a stamp's fields are 0 or 1: a byte, not a float64, halves what a mark list hashes.
        room(2);
        bytes[at] = CANONICAL_TAG.byte;
        bytes[at + 1] = value;
        at += 2;
      } else {
        room(9);
        bytes[at] = CANONICAL_TAG.number;
        view.setFloat64(at + 1, value === 0 ? 0 : value, true);
        at += 9;
      }
    } else if (value === null || value === undefined || typeof value === 'function') {
      room(1);
      bytes[at++] = CANONICAL_TAG.null;
    } else if (typeof value === 'boolean') {
      room(1);
      bytes[at++] = value ? CANONICAL_TAG.true : CANONICAL_TAG.false;
    } else if (typeof value === 'string') {
      putBytes(stampCanonicalStringBytes(value));
    } else if (ArrayBuffer.isView(value) || Array.isArray(value)) {
      // SAFETY: a view StampCanonicalDatum admits is a typed array of numbers, read by index like a list.
      const list = value as ArrayLike<StampCanonicalDatum>;
      room(5);
      bytes[at] = CANONICAL_TAG.list;
      view.setUint32(at + 1, list.length, true);
      at += 5;
      for (let i = 0; i < list.length; i++) put(list[i]);
    } else if (value instanceof Set || value instanceof Map) {
      put([...value]);
    } else {
      // SAFETY: every other kind StampCanonicalDatum admits has been written above.
      const record = value as { readonly [field: string]: StampCanonicalDatum };
      const all = stampCanonicalFields(Object.keys(record));
      let shape = all;
      for (const { key } of all.fields) {
        const field = record[key];
        if (field === undefined || typeof field === 'function') {
          shape = stampCanonicalSortedFields(all.fields.flatMap((each) => (record[each.key] === undefined || typeof record[each.key] === 'function' ? [] : [each.key])));
          break;
        }
      }
      let seen = shapesMetByObject.get(shape);
      if (seen === undefined) {
        seen = shapesMet.get(shape.names);
        if (seen !== undefined) shapesMetByObject.set(shape, seen);
      }
      room(5);
      if (seen === undefined) {
        bytes[at] = CANONICAL_TAG.shape;
        view.setUint32(at + 1, shape.fields.length, true);
        at += 5;
        for (const field of shape.fields) putBytes(field.named);
        shapesMetByObject.set(shape, shapesMet.size);
        shapesMet.set(shape.names, shapesMet.size);
      } else if (seen <= 255) {
        bytes[at] = CANONICAL_TAG.shapedByte;
        bytes[at + 1] = seen;
        at += 2;
      } else {
        bytes[at] = CANONICAL_TAG.shaped;
        view.setUint32(at + 1, seen, true);
        at += 5;
      }
      for (const { key } of shape.fields) put(record[key]);
    }
  };
  put(root);
  hash.update(bytes, 0, at);
}

/** `value` as canonical JSON. */
export function stampCanonicalJson(value: StampCanonicalDatum): string {
  const pieces: string[] = [];
  writeStampCanonical(value, (piece) => pieces.push(piece));
  return pieces.join('');
}

/** The SHA-256 of `value`'s canonical bytes (hashStampCanonical's), as hex: hashed as they're written, never held whole. */
export function stampCanonicalDigest(value: StampCanonicalDatum): string {
  const hash = createSha256();
  hashStampCanonical(value, hash);
  return hash.hex();
}

/** K₀: the key of a program's incoming state, from its head's canonical text. */
export const stampSheetHeadKey = (head: string) => textSha256Hex(`head\n${head}`);

/** Kₖ: the key after an entry, from the key before it and the entry as read: its datum's digest at rest and the map posing it. */
export const stampSheetEntryKey = (before: string, entry: Pick<StampSheetEntry, 'digest' | 'pose'>) => textSha256Hex(`${before}\n${entry.digest}\n${entry.pose}`);
