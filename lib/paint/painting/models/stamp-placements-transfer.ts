// stamp-placements-transfer.ts: remembered placements as one buffer, so one process places them and another adopts
// them: a render places its paintings once in Node and hands them to every page it draws in. The buffer is a header's
// length, the header (JSON: each placement's key, kind, marks and flood, a typed array named by its index), then every
// typed array's bytes, each 8-aligned, so a page reads each as a view of the one buffer, copying nothing.

import { stampMarksReceived, type FrozenStampMarks } from '#lib/paint/brush/models/stamp-mark-rows.ts';
import type { StampDepositPlacement, StampKeyedPlacement } from './stamp-deposit-placement.ts';
import type { CompiledStampFlood } from './stamp-paint-recipe-compile.ts';

const TYPED_ARRAYS = { Float32Array, Float64Array, Uint8Array, Uint32Array, Int32Array } as const;
type TypedArrayName = keyof typeof TYPED_ARRAYS;
const TYPED_ARRAY_NAMES: readonly TypedArrayName[] = ['Float32Array', 'Float64Array', 'Uint8Array', 'Uint32Array', 'Int32Array'];
type TypedArray = Float32Array | Float64Array | Uint8Array | Uint32Array | Int32Array;

/** What a flood holds, as the transfer reads it: data, and typed arrays. */
type StampTransferDatum = string | number | boolean | null | undefined | TypedArray | readonly StampTransferDatum[] | { readonly [field: string]: StampTransferDatum };

/** A datum in the header: a typed array as `{ '§t': index }`, a number JSON can't hold as `{ '§n': its name }`. */
type StampTransferJson = string | number | boolean | null | readonly StampTransferJson[] | { readonly [field: string]: StampTransferJson };

type PackedMarks = { readonly length: number; readonly rows: number; readonly tints: number | null };
type PackedPlacement = { readonly key: string; readonly kind: StampDepositPlacement['kind']; readonly stamps: PackedMarks; readonly dualStamps: PackedMarks; readonly flood: StampTransferJson };
type PackedHeader = { readonly placements: readonly PackedPlacement[]; readonly arrays: readonly (readonly [TypedArrayName, number, number])[] };

const TYPED_TAG = '§t', NUMBER_TAG = '§n';
const aligned = (at: number) => Math.ceil(at / 8) * 8;

function typedArrayName(array: ArrayBufferView): TypedArrayName {
  const name = TYPED_ARRAY_NAMES.find((each) => array instanceof TYPED_ARRAYS[each]);
  if (!name) throw new Error(`stamp placements transfer: a ${array.constructor.name} isn't a typed array it carries`);
  return name;
}

/** `value` as header JSON, its typed arrays handed to `put` for their index. */
function encoded(value: StampTransferDatum, put: (array: TypedArray) => number): StampTransferJson {
  if (value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? value : { [NUMBER_TAG]: Object.is(value, -0) ? '-0' : String(value) };
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (ArrayBuffer.isView(value)) return { [TYPED_TAG]: put(value) };
  if (Array.isArray(value)) return value.map((each: StampTransferDatum) => encoded(each, put));
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined).map(([name, field]) => [name, encoded(field, put)]));
}

/** Header JSON read back, its typed arrays from `views`, every list and record frozen. */
function decoded(value: StampTransferJson, views: readonly TypedArray[]): StampTransferDatum {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map((each: StampTransferJson) => decoded(each, views)));
  // SAFETY: an object JSON read that isn't a list is a record of header JSON.
  const record = value as { readonly [field: string]: StampTransferJson };
  const typed = record[TYPED_TAG], number = record[NUMBER_TAG];
  if (typeof typed === 'number') return views[typed];
  if (typeof number === 'string') return number === '-0' ? -0 : Number(number);
  return Object.freeze(Object.fromEntries(Object.entries(record).map(([name, field]) => [name, decoded(field, views)])));
}

/** `placements` as one buffer (stampPlacementsUnpacked reads it). */
export function stampPlacementsPacked(placements: Iterable<StampKeyedPlacement>): ArrayBuffer {
  const arrays: TypedArray[] = [], put = (array: TypedArray) => arrays.push(array) - 1;
  const marks = ({ length, rows, tints }: FrozenStampMarks): PackedMarks => ({ length, rows: put(rows), tints: tints ? put(tints) : null });
  const packed = [...placements].map(([key, placement]): PackedPlacement => ({
    key, kind: placement.kind, stamps: marks(placement.stamps), dualStamps: marks(placement.dualStamps), flood: placement.kind === 'flood' ? encoded(placement.flood, put) : null,
  }));
  let end = 0;
  const layout = arrays.map((array) => {
    const at = aligned(end);
    end = at + array.byteLength;
    return [typedArrayName(array), at, array.length] as const;
  });
  const header = new TextEncoder().encode(JSON.stringify({ placements: packed, arrays: layout } satisfies PackedHeader)), start = aligned(4 + header.length);
  const buffer = new ArrayBuffer(start + end), bytes = new Uint8Array(buffer);
  new DataView(buffer).setUint32(0, header.length, true);
  bytes.set(header, 4);
  arrays.forEach((array, i) => bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), start + layout[i][1]));
  return buffer;
}

/** The placements stampPlacementsPacked wrote into `buffer` from `offset` (8-aligned), their arrays views of it. */
export function stampPlacementsUnpacked(buffer: ArrayBuffer, offset = 0): StampKeyedPlacement[] {
  const length = new DataView(buffer, offset).getUint32(0, true), start = offset + aligned(4 + length);
  // SAFETY: stampPlacementsPacked wrote this header, and the render that hands it over is this bundle's.
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset + 4, length))) as PackedHeader;
  const views = header.arrays.map(([name, at, count]): TypedArray => new TYPED_ARRAYS[name](buffer, start + at, count));
  const float32 = (index: number) => {
    const view = views[index];
    if (!(view instanceof Float32Array)) throw new Error(`stamp placements transfer: marks' array ${index} is a ${view.constructor.name}`);
    return view;
  };
  const marks = ({ length: stamps, rows, tints }: PackedMarks) => stampMarksReceived(stamps, float32(rows), tints === null ? null : float32(tints));
  return header.placements.map(({ key, kind, stamps, dualStamps, flood }): StampKeyedPlacement => {
    const common = { stamps: marks(stamps), dualStamps: marks(dualStamps) };
    if (kind !== 'flood') return [key, Object.freeze({ kind, ...common })];
    // SAFETY: written from a placement's CompiledStampFlood by stampPlacementsPacked, its numbers and arrays as they were.
    return [key, Object.freeze({ kind, ...common, flood: decoded(flood, views) as CompiledStampFlood })];
  });
}

/**
 * Packed buffers sent one after another, as the pieces to write: each after its length (8 bytes, for alignment), then
 * padded to 8, so each lands 8-aligned for stampPlacementsUnframed.
 */
export function stampPlacementsFramed(parts: readonly ArrayBuffer[]): Uint8Array[] {
  return parts.flatMap((part) => {
    const frame = new Uint8Array(8);
    new DataView(frame.buffer).setUint32(0, part.byteLength, true);
    return [frame, new Uint8Array(part), new Uint8Array(aligned(part.byteLength) - part.byteLength)];
  });
}

/** Every placement in buffers stampPlacementsFramed sent, read from what arrived. */
export function stampPlacementsUnframed(buffer: ArrayBuffer): StampKeyedPlacement[] {
  const placements: StampKeyedPlacement[] = [];
  for (let at = 0; at < buffer.byteLength;) {
    const length = new DataView(buffer, at).getUint32(0, true);
    placements.push(...stampPlacementsUnpacked(buffer, at + 8));
    at += 8 + aligned(length);
  }
  return placements;
}
