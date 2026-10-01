// binary-plist.ts: Apple's binary property lists (bplist00), and the NSKeyedArchiver object graphs Procreate stores
// in them (Brush.archive, Document.archive). Reads what those files hold: integers, reals, booleans, strings, data,
// arrays, dictionaries and UIDs.
//
// Negative space: dates and sets read as their raw number and array; nothing Procreate writes needs more.

/** A reference into an NSKeyedArchiver's `$objects`. */
export class PlistUid {
  readonly uid: number;
  constructor(uid: number) {
    this.uid = uid;
  }
}
export type PlistValue = null | boolean | number | string | Uint8Array | PlistUid | PlistValue[] | { [key: string]: PlistValue };

export function parseBinaryPlist(bytes: Uint8Array): PlistValue {
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
      case 0x2: return info === 2 ? view.getFloat32(at + 1) : view.getFloat64(at + 1);
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
