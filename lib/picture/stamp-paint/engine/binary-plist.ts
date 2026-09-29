// binary-plist.ts: Apple's binary property lists (bplist00), and the NSKeyedArchiver object graphs Procreate stores
// in them (Brush.archive, Document.archive). Reads what those files hold: integers, reals, booleans, strings, data,
// arrays, dictionaries and UIDs; and writes them back, for the probe brushes (procreate-probe-brushset.ts).
//
// Negative space: dates and sets read as their raw number and array; nothing Procreate writes needs more.

/** A reference into an NSKeyedArchiver's `$objects`. */
export class PlistUid {
  readonly uid: number;
  constructor(uid: number) {
    this.uid = uid;
  }
}
/**
 * A real read with `keepReals`, so writing it back keeps it a real: Procreate stores most settings as reals, and a
 * whole-numbered one (1.0) would otherwise come back an integer.
 */
export class PlistReal {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
}
export type PlistValue = null | boolean | number | string | Uint8Array | PlistUid | PlistReal | PlistValue[] | { [key: string]: PlistValue };

export function parseBinaryPlist(bytes: Uint8Array, { keepReals = false } = {}): PlistValue {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== 'bplist00') throw new Error('not a binary plist (bplist00)');
  const trailer = bytes.byteLength - 32;
  const offsetSize = bytes[trailer + 6], refSize = bytes[trailer + 7];
  const objectCount = Number(view.getBigUint64(trailer + 8)), top = Number(view.getBigUint64(trailer + 16));
  const tableAt = Number(view.getBigUint64(trailer + 24));
  const uint = (at: number, size: number) => {
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + bytes[at + i];
    return value;
  };
  const offsets = Array.from({ length: objectCount }, (_, i) => uint(tableAt + i * offsetSize, offsetSize));

  const read = (index: number): PlistValue => {
    const at = offsets[index], marker = bytes[at], kind = marker >> 4, info = marker & 0xf;
    // A length of 0xf means the real length follows as an integer object.
    const sized = () => {
      if (info !== 0xf) return { length: info, start: at + 1 };
      const size = 1 << (bytes[at + 1] & 0xf);
      return { length: uint(at + 2, size), start: at + 2 + size };
    };
    switch (kind) {
      case 0x0: return info === 0x8 ? false : info === 0x9 ? true : null;
      case 0x1: {
        // Eight-byte integers are signed; Procreate's settings fit a double either way.
        const size = 1 << info;
        return size === 8 ? Number(view.getBigInt64(at + 1)) : uint(at + 1, size);
      }
      case 0x2: {
        const value = info === 2 ? view.getFloat32(at + 1) : view.getFloat64(at + 1);
        return keepReals ? new PlistReal(value) : value;
      }
      case 0x3: return view.getFloat64(at + 1);
      case 0x4: { const { length, start } = sized(); return bytes.slice(start, start + length); }
      case 0x5: { const { length, start } = sized(); return new TextDecoder('latin1').decode(bytes.subarray(start, start + length)); }
      case 0x6: { const { length, start } = sized(); return new TextDecoder('utf-16be').decode(bytes.subarray(start, start + length * 2)); }
      case 0x8: return new PlistUid(uint(at + 1, info + 1));
      case 0xa: case 0xc: {
        const { length, start } = sized();
        return Array.from({ length }, (_, i) => read(uint(start + i * refSize, refSize)));
      }
      case 0xd: {
        const { length, start } = sized();
        const entries: Record<string, PlistValue> = {};
        for (let i = 0; i < length; i++) entries[String(read(uint(start + i * refSize, refSize)))] = read(uint(start + (length + i) * refSize, refSize));
        return entries;
      }
      default: throw new Error(`binary plist: object ${index} has marker 0x${marker.toString(16)}, which this reader doesn't know`);
    }
  };
  return read(top);
}

/**
 * The root object of an NSKeyedArchiver plist, every UID replaced by the object it names: `$null` becomes null, an
 * NSArray its `NS.objects`, an NSDictionary a record. Shared objects stay shared, so a graph with cycles resolves.
 */
export function unarchiveKeyedPlist(bytes: Uint8Array): Record<string, unknown> {
  const archive = parseBinaryPlist(bytes) as { $objects: PlistValue[]; $top: { root: PlistUid } };
  const objects = archive.$objects;
  const resolved = new Map<number, unknown>();
  const resolve = (value: PlistValue): unknown => {
    if (!(value instanceof PlistUid)) return value;
    if (resolved.has(value.uid)) return resolved.get(value.uid);
    const object = objects[value.uid];
    if (object === '$null') return null;
    if (typeof object !== 'object' || object === null || Array.isArray(object) || object instanceof Uint8Array || object instanceof PlistUid) return object;
    if ('NS.objects' in object && 'NS.keys' in object) {
      const record: Record<string, unknown> = {};
      resolved.set(value.uid, record);
      const keys = object['NS.keys'] as PlistValue[], values = object['NS.objects'] as PlistValue[];
      keys.forEach((key, i) => { record[String(resolve(key))] = resolve(values[i]); });
      return record;
    }
    if ('NS.objects' in object) {
      const list: unknown[] = [];
      resolved.set(value.uid, list);
      for (const item of object['NS.objects'] as PlistValue[]) list.push(resolve(item));
      return list;
    }
    const record: Record<string, unknown> = {};
    resolved.set(value.uid, record);
    for (const [key, field] of Object.entries(object)) if (key !== '$class') record[key] = resolve(field);
    return record;
  };
  return resolve(archive.$top.root) as Record<string, unknown>;
}

/**
 * `value` as a binary plist. A number is written as an integer when it's whole and as a real otherwise; a PlistReal
 * always as a real. Every object is written once per place it appears: nothing is shared.
 */
export function writeBinaryPlist(value: PlistValue): Uint8Array {
  const objects: Uint8Array[] = [];
  const counts = (v: PlistValue): number => (Array.isArray(v) ? 1 + v.reduce((n: number, item) => n + counts(item), 0)
    : v && typeof v === 'object' && !(v instanceof Uint8Array) && !(v instanceof PlistUid) && !(v instanceof PlistReal)
      ? 1 + Object.entries(v).reduce((n, [, item]) => n + 1 + counts(item), 0) : 1);
  const total = counts(value);
  const refSize = total < 256 ? 1 : total < 65536 ? 2 : 4;
  const sizeOf = (n: number) => (n < 256 ? 1 : n < 65536 ? 2 : n < 2 ** 32 ? 4 : 8);
  const uintBytes = (n: number, size: number) => Array.from({ length: size }, (_, i) => Math.floor(n / 256 ** (size - 1 - i)) % 256);
  const header = (kind: number, length: number) => (length < 15 ? [(kind << 4) | length] : [(kind << 4) | 0xf, 0x10 | Math.log2(sizeOf(length)), ...uintBytes(length, sizeOf(length))]);
  const real = (n: number) => {
    const bytes = new Uint8Array(9);
    bytes[0] = 0x23;
    new DataView(bytes.buffer).setFloat64(1, n);
    return bytes;
  };
  const add = (v: PlistValue): number => {
    const index = objects.length;
    objects.push(new Uint8Array());
    let bytes: number[] | Uint8Array;
    if (v === null) bytes = [0x00];
    else if (typeof v === 'boolean') bytes = [v ? 0x09 : 0x08];
    else if (v instanceof PlistReal) bytes = real(v.value);
    else if (typeof v === 'number') {
      if (!Number.isInteger(v)) bytes = real(v);
      else if (v < 0) {
        const out = new Uint8Array(9);
        out[0] = 0x13;
        new DataView(out.buffer).setBigInt64(1, BigInt(v));
        bytes = out;
      } else bytes = [0x10 | Math.log2(sizeOf(v)), ...uintBytes(v, sizeOf(v))];
    } else if (v instanceof PlistUid) bytes = [0x80 | (sizeOf(v.uid) - 1), ...uintBytes(v.uid, sizeOf(v.uid))];
    else if (typeof v === 'string') {
      // ASCII as bytes; anything else as UTF-16 big-endian, as Apple writes it.
      if (/^[\x00-\x7f]*$/.test(v)) bytes = [...header(0x5, v.length), ...Array.from(v, (c) => c.charCodeAt(0))];
      else bytes = [...header(0x6, v.length), ...Array.from(v).flatMap((c) => { const code = c.charCodeAt(0); return [code >> 8, code & 0xff]; })];
    } else if (v instanceof Uint8Array) bytes = [...header(0x4, v.length), ...v];
    else if (Array.isArray(v)) {
      const refs = v.map(add);
      bytes = [...header(0xa, refs.length), ...refs.flatMap((r) => uintBytes(r, refSize))];
    } else {
      const entries = Object.entries(v);
      const keys = entries.map(([key]) => add(key)), values = entries.map(([, item]) => add(item));
      bytes = [...header(0xd, entries.length), ...keys.flatMap((r) => uintBytes(r, refSize)), ...values.flatMap((r) => uintBytes(r, refSize))];
    }
    objects[index] = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    return index;
  };
  add(value);
  const offsets: number[] = [];
  let at = 8;
  for (const object of objects) { offsets.push(at); at += object.length; }
  const offsetSize = sizeOf(at);
  const trailer = [0, 0, 0, 0, 0, 0, offsetSize, refSize, ...uintBytes(objects.length, 8), ...uintBytes(0, 8), ...uintBytes(at, 8)];
  const out = new Uint8Array(at + offsets.length * offsetSize + 32);
  out.set(new TextEncoder().encode('bplist00'));
  objects.forEach((object, i) => out.set(object, offsets[i]));
  out.set(offsets.flatMap((o) => uintBytes(o, offsetSize)), at);
  out.set(trailer, at + offsets.length * offsetSize);
  return out;
}
