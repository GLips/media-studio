// photoshop-descriptor-codec.ts: Photoshop's ActionDescriptor serialization, the settings format inside an .abr's 8BIMdesc
// section, a .tpl's tool presets and what scripting's executeActionGet returns. Reads a descriptor into plain JSON
// (models/photoshop-descriptor.ts) and writes one back, byte for byte as Photoshop lays it out, so the same value round-trips.
//
// A key or class is a charID (four bytes, written with a zero length: `Nm  `, `Brsh`) or a stringID (written with its
// length: `useTipDynamics`); both read as the string, the charID keeping its padding. Photoshop's own files mix the
// two, and a stringID where Photoshop writes a charID is silently ignored when loaded, so a key is kept as written.
//
// Negative space: references (`obj `) and paths (`Pth `) aren't read, and a few types don't write back as read (`comp`
// as a 32-bit `long`, `UnFl` as a list of units, `GlbO` as `Objc`, a class reference without its name); no brush or
// tool preset holds any of them.

import { photoshopTagged, type PhotoshopDescriptor, type PhotoshopValue } from '../models/photoshop-descriptor.ts';

/**
 * The stringIDs four letters long, which look like charIDs once read: Photoshop's files write these with their length,
 * and read a charID in their place as another key. `flow` is the only one its brush files hold.
 */
const FOUR_LETTER_STRING_IDS = new Set(['flow']);

/** A big-endian cursor over bytes, shared by the .abr and .tpl readers. */
export class PhotoshopByteReader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  at: number;
  constructor(bytes: Uint8Array, at = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.at = at;
  }
  get done() {
    return this.at >= this.bytes.byteLength;
  }
  u8() {
    return this.bytes[this.at++];
  }
  u16() {
    const v = this.view.getUint16(this.at);
    this.at += 2;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.at);
    this.at += 4;
    return v;
  }
  i32() {
    const v = this.view.getInt32(this.at);
    this.at += 4;
    return v;
  }
  f64() {
    const v = this.view.getFloat64(this.at);
    this.at += 8;
    return v;
  }
  take(length: number) {
    if (this.at + length > this.bytes.byteLength) throw new Error(`photoshop: read of ${length} bytes at ${this.at} runs past the end (${this.bytes.byteLength})`);
    const out = this.bytes.subarray(this.at, this.at + length);
    this.at += length;
    return out;
  }
  ascii(length: number) {
    return String.fromCharCode(...this.take(length));
  }
  /** A length-prefixed UTF-16 string, its count in code units, usually ending in a zero Photoshop counts. */
  unicode() {
    const count = this.u32();
    let s = '';
    for (let i = 0; i < count; i++) s += String.fromCharCode(this.u16());
    return s.replace(/\0+$/, '');
  }
  pascal() {
    return this.ascii(this.u8());
  }
  /** A key or class: a four-byte charID after a zero length, else a stringID of that length. */
  id() {
    const length = this.u32();
    return this.ascii(length === 0 ? 4 : length);
  }
}

/** A big-endian writer, the reader's inverse. */
export class PhotoshopByteWriter {
  private chunks: Uint8Array[] = [];
  length = 0;
  bytes(b: Uint8Array) {
    this.chunks.push(b);
    this.length += b.byteLength;
    return this;
  }
  private fixed(size: number, set: (view: DataView) => void) {
    const b = new Uint8Array(size);
    set(new DataView(b.buffer));
    return this.bytes(b);
  }
  u8(v: number) {
    return this.fixed(1, (d) => d.setUint8(0, v));
  }
  u16(v: number) {
    return this.fixed(2, (d) => d.setUint16(0, v));
  }
  u32(v: number) {
    return this.fixed(4, (d) => d.setUint32(0, v));
  }
  i32(v: number) {
    return this.fixed(4, (d) => d.setInt32(0, v));
  }
  f64(v: number) {
    return this.fixed(8, (d) => d.setFloat64(0, v));
  }
  ascii(s: string) {
    return this.bytes(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  }
  unicode(s: string) {
    this.u32(s.length + 1);
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
    return this.u16(0);
  }
  pascal(s: string) {
    return this.u8(s.length).ascii(s);
  }
  /** Writes a four-character key as a charID, anything else as a stringID, as Photoshop does. */
  id(s: string) {
    return s.length === 4 && !FOUR_LETTER_STRING_IDS.has(s) ? this.u32(0).ascii(s) : this.u32(s.length).ascii(s);
  }
  pad(to: number) {
    while (this.length % to) this.u8(0);
    return this;
  }
  finish() {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

function readValue(r: PhotoshopByteReader, type: string): PhotoshopValue {
  switch (type) {
    case 'Objc': case 'GlbO': return readPhotoshopDescriptor(r);
    case 'VlLs': return Array.from({ length: r.u32() }, () => readValue(r, r.ascii(4)));
    case 'doub': return r.f64();
    case 'UntF': return { _unit: r.ascii(4), value: r.f64() };
    case 'TEXT': return r.unicode();
    case 'enum': return { _enum: r.id(), value: r.id() };
    case 'long': return { _long: r.i32() };
    case 'comp': return { _long: Number(r.view.getBigInt64(r.take(8).byteOffset - r.bytes.byteOffset)) };
    case 'bool': return r.u8() !== 0;
    case 'type': case 'GlbC': {
      r.unicode();
      return { _classRef: r.id() };
    }
    case 'tdta': case 'alis': return { _raw: type, hex: hex(r.take(r.u32())) };
    case 'UnFl': {
      const unit = r.ascii(4);
      return Array.from({ length: r.u32() }, () => ({ _unit: unit, value: r.f64() }));
    }
    default: throw new Error(`photoshop descriptor: a value of type ${JSON.stringify(type)} at ${r.at - 4}, which the reader doesn't know`);
  }
}

/** A descriptor at the reader's place: its name, its class, its count and then each key, type and value. */
export function readPhotoshopDescriptor(r: PhotoshopByteReader): PhotoshopDescriptor {
  const name = r.unicode();
  const out: PhotoshopDescriptor = { _class: r.id(), ...(name && { _name: name }) };
  const count = r.u32();
  for (let i = 0; i < count; i++) {
    const key = r.id();
    out[key] = readValue(r, r.ascii(4));
  }
  return out;
}

function writeValue(w: PhotoshopByteWriter, v: PhotoshopValue) {
  if (typeof v === 'number') return w.ascii('doub').f64(v);
  if (typeof v === 'boolean') return w.ascii('bool').u8(v ? 1 : 0);
  if (typeof v === 'string') return w.ascii('TEXT').unicode(v);
  if (Array.isArray(v)) {
    w.ascii('VlLs').u32(v.length);
    for (const item of v) writeValue(w, item);
    return w;
  }
  const t = photoshopTagged(v);
  if (!t) {
    w.ascii('Objc');
    return writePhotoshopDescriptor(w, v as PhotoshopDescriptor);
  }
  if ('_unit' in t) return w.ascii('UntF').ascii(t._unit).f64(t.value);
  if ('_enum' in t) return w.ascii('enum').id(t._enum).id(t.value);
  if ('_long' in t) return w.ascii('long').i32(t._long);
  if ('_classRef' in t) return w.ascii('type').unicode('').id(t._classRef);
  const b = Buffer.from(t.hex, 'hex');
  return w.ascii(t._raw).u32(b.byteLength).bytes(b);
}

export function writePhotoshopDescriptor(w: PhotoshopByteWriter, d: PhotoshopDescriptor) {
  w.unicode(d._name ?? '').id(d._class);
  const keys = Object.keys(d).filter((k) => k !== '_class' && k !== '_name' && d[k] !== undefined);
  w.u32(keys.length);
  for (const key of keys) writeValue(w.id(key), d[key]!);
  return w;
}
