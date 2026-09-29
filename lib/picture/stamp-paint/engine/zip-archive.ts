// zip-archive.ts: reads entries out of a zip (a Procreate .brushset, .swatches or .procreate is one, and packs come as
// zips of those) without unpacking it, from a file on disk or from bytes already read. Stored and deflated entries.
// Writes one too, every entry stored, for the probe brushes (procreate-probe-brushset.ts).
//
// Negative space: no Zip64 or encryption. A pack's archives stay well under 4 GB; one that doesn't is refused by name.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { crc32, inflateRawSync } from 'node:zlib';

export type ZipArchive = {
  /** Every entry's path, directories and macOS resource forks (`__MACOSX/`) left out. */
  names: readonly string[];
  read: (name: string) => Buffer;
  close: () => void;
};

type ZipEntry = { method: number; compressedSize: number; localHeaderAt: number };

function openZip(label: string, size: number, readAt: (at: number, length: number) => Buffer, close: () => void): ZipArchive {
  // The end-of-central-directory record sits in the last 64 KB + 22 bytes, after an optional comment.
  const tailLength = Math.min(size, 65_557), tail = readAt(size - tailLength, tailLength);
  const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error(`${label} isn't a zip archive`);
  const count = tail.readUInt16LE(end + 10), directorySize = tail.readUInt32LE(end + 12), directoryAt = tail.readUInt32LE(end + 16);
  if (count === 0xffff || directoryAt === 0xffffffff) throw new Error(`${label} is a Zip64 archive, which this reader doesn't open`);
  const directory = readAt(directoryAt, directorySize);
  const entries = new Map<string, ZipEntry>();
  for (let at = 0, i = 0; i < count; i++) {
    const nameLength = directory.readUInt16LE(at + 28), extraLength = directory.readUInt16LE(at + 30), commentLength = directory.readUInt16LE(at + 32);
    const name = directory.toString('utf8', at + 46, at + 46 + nameLength);
    entries.set(name, { method: directory.readUInt16LE(at + 10), compressedSize: directory.readUInt32LE(at + 20), localHeaderAt: directory.readUInt32LE(at + 42) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...entries.keys()].filter((name) => !name.endsWith('/') && !name.startsWith('__MACOSX/')),
    read(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`${label} has no entry ${name}`);
      const header = readAt(entry.localHeaderAt, 30);
      const dataAt = entry.localHeaderAt + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      const data = readAt(dataAt, entry.compressedSize);
      if (entry.method === 0) return data;
      if (entry.method === 8) return inflateRawSync(data);
      throw new Error(`${label}: ${name} is compressed by method ${entry.method}, and only stored and deflated entries are read`);
    },
    close,
  };
}

export function openZipFile(file: string): ZipArchive {
  const fd = openSync(file, 'r');
  const readAt = (at: number, length: number) => {
    const buffer = Buffer.alloc(length);
    if (readSync(fd, buffer, 0, length, at) !== length) throw new Error(`${file} ends before byte ${at + length}; it's truncated or corrupt`);
    return buffer;
  };
  return openZip(file, fstatSync(fd).size, readAt, () => closeSync(fd));
}

export function openZipBytes(label: string, bytes: Buffer): ZipArchive {
  const readAt = (at: number, length: number) => {
    if (at + length > bytes.byteLength) throw new Error(`${label} ends before byte ${at + length}; it's truncated or corrupt`);
    return bytes.subarray(at, at + length);
  };
  return openZip(label, bytes.byteLength, readAt, () => {});
}

/** A zip of `entries`, in order, each stored uncompressed: a brush set's PNGs are compressed already. */
export function writeZipArchive(entries: readonly { name: string; data: Uint8Array }[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let at = 0;
  for (const { name, data } of entries) {
    const path = Buffer.from(name, 'utf8'), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    // Bit 11: the name is UTF-8.
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(path.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(path.length, 28);
    central.writeUInt32LE(at, 42);
    locals.push(local, path, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    centrals.push(central, path);
    at += 30 + path.length + data.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...locals, directory, end]);
}
