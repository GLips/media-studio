// procreate-canvas.ts: the flattened picture inside a .procreate document. Procreate keeps a composite of every
// visible layer beside the layers themselves, as square tiles of premultiplied RGBA, each compressed with Apple's
// LZ4 framing (`bv41` blocks, ended by `bv4$`) and named `<column>~<row>.lz4` in a folder named by the composite's UUID.
// Reading that composite gives the canvas as Procreate shows it, without compositing its layers' blend modes.

import { unarchiveKeyedPlist } from './binary-plist.ts';
import type { ZipArchive } from '#lib/platform/zip/engine/zip-archive.ts';

/**
 * Apple's LZ4 stream (compression_encode_buffer's COMPRESSION_LZ4): blocks of `bv41` (LZ4) or `bv4-` (stored), ended
 * by `bv4$`. A block's matches may reach back into the blocks before it, so all of them decode into one buffer.
 */
export function decompressAppleLz4(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  let total = 0;
  for (let at = 0; tag(at) !== 'bv4$';) {
    total += view.getUint32(at + 4, true);
    at += tag(at) === 'bv4-' ? 8 + view.getUint32(at + 4, true) : 12 + view.getUint32(at + 8, true);
  }
  const out = new Uint8Array(total);
  let to = 0;
  for (let at = 0; ;) {
    const magic = tag(at);
    if (magic === 'bv4$') break;
    const size = view.getUint32(at + 4, true);
    if (magic === 'bv4-') {
      out.set(bytes.subarray(at + 8, at + 8 + size), to);
      at += 8 + size;
    } else if (magic === 'bv41') {
      const compressed = view.getUint32(at + 8, true);
      const end = decompressLz4Block(bytes.subarray(at + 12, at + 12 + compressed), out, to);
      if (end - to !== size) throw new Error(`Apple LZ4: a block decompressed to ${end - to} bytes, and its header promised ${size}`);
      at += 12 + compressed;
    } else {
      throw new Error(`Apple LZ4: block ${JSON.stringify(magic)} at byte ${at} is neither bv41, bv4- nor bv4$`);
    }
    to += size;
  }
  return out;
}

/** One raw LZ4 block, written into `out` from `to`; where it ended. */
function decompressLz4Block(source: Uint8Array, out: Uint8Array, start: number): number {
  let from = 0, to = start;
  const length = (initial: number) => {
    let value = initial;
    if (initial === 15) {
      let next;
      do value += next = source[from++]; while (next === 255);
    }
    return value;
  };
  while (from < source.length) {
    const token = source[from++];
    const literals = length(token >> 4);
    out.set(source.subarray(from, from + literals), to);
    from += literals, to += literals;
    if (from >= source.length) break;
    const offset = source[from] | (source[from + 1] << 8);
    from += 2;
    // A match may overlap what it copies (offset < length), so it goes a byte at a time.
    for (let n = length(token & 15) + 4, back = to - offset; n > 0; n--) out[to++] = out[back++];
  }
  return to;
}

/**
 * A composite as stored: straight (not premultiplied) RGBA, `width` × `height`, rows top first. Procreate shows it
 * turned by `orientation`, which the caller applies.
 */
export type ProcreateCanvas = { name: string; width: number; height: number; orientation: number; rgba: Uint8Array };

export function readProcreateComposite(label: string, document: ZipArchive): ProcreateCanvas {
  const root = unarchiveKeyedPlist(document.read('Document.archive'));
  const [width, height] = String(root.size).match(/\d+/g)!.map(Number);
  const tileSize = Number(root.tileSize), composite = root.composite as { UUID: string } | null;
  if (!composite) throw new Error(`${label} keeps no composite image`);
  const rgba = new Uint8Array(width * height * 4);
  const tilePattern = new RegExp(`^${composite.UUID}/(\\d+)~(\\d+)\\.lz4$`);
  for (const name of document.names) {
    const match = tilePattern.exec(name);
    if (!match) continue;
    const column = Number(match[1]), row = Number(match[2]);
    const tile = decompressAppleLz4(document.read(name));
    // A tile on the right or bottom edge is cut to the canvas.
    const tileWidth = Math.min(tileSize, width - column * tileSize), tileHeight = Math.min(tileSize, height - row * tileSize);
    if (tile.length !== tileWidth * tileHeight * 4) throw new Error(`${label}: tile ${name} holds ${tile.length} bytes, not ${tileWidth}×${tileHeight} pixels`);
    for (let y = 0; y < tileHeight; y++) {
      rgba.set(tile.subarray(y * tileWidth * 4, (y + 1) * tileWidth * 4), ((row * tileSize + y) * width + column * tileSize) * 4);
    }
  }
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3];
    if (alpha === 0 || alpha === 255) continue;
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.min(255, Math.round((rgba[i + c] * 255) / alpha));
  }
  return { name: String(root.name), width, height, orientation: Number(root.orientation), rgba };
}
