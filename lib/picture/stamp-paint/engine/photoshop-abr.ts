// photoshop-abr.ts: Photoshop's brush files. An .abr (version 6 and later, everything Photoshop has written since CS)
// is a two-short header and then `8BIM` sections: `samp`, the sampled tips; `patt`, the patterns textures name; `desc`,
// one ActionDescriptor listing every preset; `phry`, the presets' groups; `plid`, which isn't read. A .tpl holds tool
// presets the same way (`tpsh` tips, `tppa` patterns, `tptp` the presets), each preset's tool options beside its brush.
// Both read into a PhotoshopBrushFile; writePhotoshopAbr writes one back as Photoshop lays it out.
//
// Tips and patterns are Photoshop's image blocks (its "virtual memory array lists"): a rectangle and per-channel planes,
// raw or PackBits. A tip is one 8-bit or 16-bit plane where more is more paint; a pattern is grey, RGB or indexed.
// The layout follows Krita's reverse engineering (libs/brush/kis_abr_brush_collection.cpp) and psd-tools', checked
// against every file Photoshop 2026 ships.
//
// Negative space: version 1 and 2 files (Photoshop 7 and older) aren't read: they hold only tips, no settings.

import type { PhotoshopDescriptor } from '../models/photoshop-descriptor.ts';
import { PhotoshopByteReader, PhotoshopByteWriter, readPhotoshopDescriptor, writePhotoshopDescriptor } from './photoshop-descriptor-codec.ts';

/** A single-channel image, row by row, 0..255 with 255 the most (paint, for a tip). */
export type PhotoshopGrayImage = { width: number; height: number; pixels: Uint8Array };
/** A pattern as grey (luminance for colour patterns): lighter is higher, and takes more paint through a texture. */
export type PhotoshopPattern = { name: string; image: PhotoshopGrayImage };
/** A preset: its descriptor (a `brushPreset`, tool options under `toolOptions`) and the group it's filed under. */
export type PhotoshopBrushPreset = { descriptor: PhotoshopDescriptor; group?: string };
export type PhotoshopBrushFile = {
  kind: 'abr' | 'tpl';
  presets: PhotoshopBrushPreset[];
  /** Sampled tips by the id a `sampledBrush`'s `sampledData` names. */
  tips: Map<string, PhotoshopGrayImage>;
  /** Patterns by the id a texture's `Idnt` names. */
  patterns: Map<string, PhotoshopPattern>;
};

/** PackBits rows, each row's packed length given first. */
function unpackRows(r: PhotoshopByteReader, rows: number, width: number, bytesPerSample: number): Uint8Array {
  const lengths = Array.from({ length: rows }, () => r.u16());
  const out = new Uint8Array(rows * width * bytesPerSample);
  let at = 0;
  for (const length of lengths) {
    const end = r.at + length, rowEnd = at + width * bytesPerSample;
    while (r.at < end) {
      const n = r.u8();
      if (n < 128) {
        out.set(r.take(n + 1), at);
        at += n + 1;
      } else if (n > 128) {
        out.fill(r.u8(), at, at + 257 - n);
        at += 257 - n;
      }
    }
    at = rowEnd;
  }
  return out;
}

/** The written planes of an image block, each as 8-bit, and the block's size. Leaves the reader at the block's end. */
function readImageBlock(r: PhotoshopByteReader): { width: number; height: number; planes: Uint8Array[] } {
  const version = r.u32();
  if (version !== 3) throw new Error(`photoshop: an image block of version ${version}; the reader knows 3`);
  const end = r.u32() + r.at;
  const top = r.u32(), left = r.u32(), bottom = r.u32(), right = r.u32();
  const slots = r.u32() + 2;
  const planes: Uint8Array[] = [];
  for (let slot = 0; slot < slots && r.at < end; slot++) {
    if (!r.u32()) continue;
    const length = r.u32();
    if (!length) continue;
    const planeEnd = r.at + length;
    const depth = r.u32();
    const pt = r.u32(), pl = r.u32(), pb = r.u32(), pr = r.u32();
    r.u16();
    const compression = r.u8();
    const width = pr - pl, height = pb - pt, bytes = depth / 8;
    if (depth !== 8 && depth !== 16) throw new Error(`photoshop: a ${depth}-bit image plane; the reader knows 8 and 16`);
    const raw = compression ? unpackRows(r, height, width, bytes) : r.take(width * height * bytes);
    // 16-bit planes keep their high byte.
    planes.push(bytes === 1 ? raw.slice() : Uint8Array.from({ length: width * height }, (_, i) => raw[i * 2]));
    r.at = planeEnd;
  }
  r.at = end;
  return { width: right - left, height: bottom - top, planes };
}

/** A sampled tip. Subversion 1 (early CS files) lays out its plane bare after ten bytes; 2 in an image block. */
function readTip(r: PhotoshopByteReader, tips: Map<string, PhotoshopGrayImage>, subversion: number) {
  const end = r.u32() + r.at;
  const id = r.pascal();
  if (subversion === 1) {
    r.take(10);
    const top = r.u32(), left = r.u32(), bottom = r.u32(), right = r.u32();
    const depth = r.u16(), compression = r.u8(), width = right - left, height = bottom - top;
    if (depth !== 8) throw new Error(`photoshop: a ${depth}-bit tip in a subversion 1 file; the reader knows 8`);
    tips.set(id, { width, height, pixels: compression ? unpackRows(r, height, width, 1) : r.take(width * height).slice() });
  } else {
    r.u32();
    const block = readImageBlock(r);
    if (block.planes.length) tips.set(id, { width: block.width, height: block.height, pixels: block.planes[0] });
  }
  r.at = end;
}

/** Image modes, as Photoshop numbers them. */
const MODE_GRAY = 1, MODE_INDEXED = 2, MODE_RGB = 3, MODE_LAB = 9;

function readPattern(r: PhotoshopByteReader, patterns: Map<string, PhotoshopPattern>) {
  const end = r.u32() + r.at;
  r.u32();
  const mode = r.u32();
  r.u16();
  r.u16();
  const name = r.unicode(), id = r.pascal();
  let table: Uint8Array | undefined;
  if (mode === MODE_INDEXED) {
    table = r.take(768);
    r.u32();
  }
  const { width, height, planes } = readImageBlock(r);
  // CMYK and other modes aren't read: a preset naming such a pattern is reported as missing it. Lab's first plane is lightness.
  if (!planes.length || ![MODE_GRAY, MODE_INDEXED, MODE_RGB, MODE_LAB].includes(mode)) {
    r.at = end;
    return;
  }
  const n = width * height, gray = new Uint8Array(n);
  if (mode === MODE_RGB && planes.length >= 3) {
    for (let i = 0; i < n; i++) gray[i] = Math.round(0.299 * planes[0][i] + 0.587 * planes[1][i] + 0.114 * planes[2][i]);
  } else if (mode === MODE_INDEXED && table) {
    for (let i = 0; i < n; i++) {
      const k = planes[0][i];
      gray[i] = Math.round(0.299 * table[k * 3] + 0.587 * table[k * 3 + 1] + 0.114 * table[k * 3 + 2]);
    }
  } else {
    gray.set(planes[0].subarray(0, n));
  }
  patterns.set(id, { name, image: { width, height, pixels: gray } });
  r.at = end;
}

/** Each record of a section of length-prefixed records, 4-byte aligned. */
function eachRecord(r: PhotoshopByteReader, end: number, read: () => void) {
  while (r.at < end) {
    read();
    while (r.at % 4) r.at++;
  }
}

/** Group names by preset, from `phry`'s flat list: each `Grup` names the presets after it. */
function readGroups(r: PhotoshopByteReader): (string | undefined)[] {
  r.u32();
  const items = readPhotoshopDescriptor(r).hierarchy as PhotoshopDescriptor[] | undefined;
  let group: string | undefined;
  return (items ?? []).flatMap((item) => {
    if (item._class === 'Grup') {
      group = displayName(String(item['Nm  '] ?? ''));
      return [];
    }
    return [group];
  });
}

/** A localizable name (`$$$/Presets/Brushes/SoftRound=Soft Round`) as Photoshop shows it in English. */
export const displayName = (name: string) => (name.startsWith('$$$/') && name.includes('=') ? name.slice(name.indexOf('=') + 1) : name);

export function readPhotoshopAbr(bytes: Uint8Array): PhotoshopBrushFile {
  const r = new PhotoshopByteReader(bytes);
  const version = r.u16();
  if (version < 6) throw new Error(`photoshop: an .abr of version ${version} (Photoshop 7 or older); the reader knows 6 and later`);
  const subversion = r.u16();
  const out: PhotoshopBrushFile = { kind: 'abr', presets: [], tips: new Map(), patterns: new Map() };
  let groups: (string | undefined)[] = [];
  while (r.at + 12 <= bytes.byteLength) {
    const signature = r.ascii(4), key = r.ascii(4), end = r.u32() + r.at;
    if (signature !== '8BIM') throw new Error(`photoshop: expected an 8BIM section at ${r.at - 12}, found ${JSON.stringify(signature)}`);
    if (key === 'samp') eachRecord(r, end, () => readTip(r, out.tips, subversion));
    else if (key === 'patt') eachRecord(r, end, () => readPattern(r, out.patterns));
    else if (key === 'desc') {
      r.u32();
      out.presets = ((readPhotoshopDescriptor(r).Brsh ?? []) as PhotoshopDescriptor[]).map((descriptor) => ({ descriptor }));
    } else if (key === 'phry') groups = readGroups(r);
    r.at = end;
    while (r.at % 4) r.at++;
  }
  out.presets.forEach((preset, i) => {
    if (groups[i]) preset.group = groups[i];
  });
  return out;
}

/**
 * A .tpl's brush-tool presets (paintbrush, pencil, mixer brush), each a `brushPreset` holding its tool's options under
 * `toolOptions`, as an .abr's converted tool presets hold them. Presets of other tools (healing, crop, type) are left out.
 */
export function readPhotoshopTpl(bytes: Uint8Array): PhotoshopBrushFile {
  const r = new PhotoshopByteReader(bytes);
  if (r.ascii(4) !== '8BTP') throw new Error('photoshop: not a tool preset file (8BTP)');
  r.u32();
  r.u32();
  const out: PhotoshopBrushFile = { kind: 'tpl', presets: [], tips: new Map(), patterns: new Map() };
  while (r.at + 12 <= bytes.byteLength) {
    const signature = r.ascii(4), key = r.ascii(4), end = r.u32() + r.at;
    if (signature !== '8BIM') throw new Error(`photoshop: expected an 8BIM section at ${r.at - 12}, found ${JSON.stringify(signature)}`);
    if (key === 'tpsh') {
      eachRecord(r, end, () => {
        const recordEnd = r.u32() + r.at;
        r.u32();
        // Photoshop's own .tpl files hold only healing-brush tips, in a layout of their own; a tip that isn't in an
        // .abr's layout is left out, and a preset naming it is reported as missing its tip. Unverified against a
        // paintbrush .tpl: none was at hand, so a brush tool preset's tip may land here too.
        try {
          readTip(r, out.tips, 2);
        } catch {}
        r.at = recordEnd;
      });
    } else if (key === 'tppa') eachRecord(r, end, () => readPattern(r, out.patterns));
    else if (key === 'tptp') {
      const count = r.u32();
      for (let i = 0; i < count; i++) {
        const name = r.unicode();
        r.u32();
        const tool = readPhotoshopDescriptor(r);
        const brush = tool.Brsh as PhotoshopDescriptor | undefined;
        if (!brush || brush._class !== 'brushPreset') continue;
        const { Brsh: _, _class, ...options } = tool;
        out.presets.push({ descriptor: { ...brush, 'Nm  ': name, toolOptions: { ...options, _class: TOOL_CLASSES[_class] ?? _class } } });
      }
    }
    r.at = end;
    while (r.at % 4) r.at++;
  }
  return out;
}

/** A .tpl names its tool by stringID; an .abr's converted tool options by class charID. */
const TOOL_CLASSES: Readonly<Record<string, string>> = { paintbrushTool: 'PbTl', pencilTool: 'PcTl', wetBrushTool: 'MixB', mixerBrushTool: 'MixB' };

/**
 * An image block holding `image` as one grey plane in slot `slot` of `channels`, the rest empty, as Photoshop files a
 * tip (slot 55 of 56) or a grey pattern (slot 0 of 24).
 */
function writeImageBlock(w: PhotoshopByteWriter, image: PhotoshopGrayImage, channels: number, slot: number) {
  const { width, height, pixels } = image;
  const plane = new PhotoshopByteWriter().u32(8).u32(0).u32(0).u32(height).u32(width).u16(8).u8(0).bytes(pixels).finish();
  const body = new PhotoshopByteWriter().u32(0).u32(0).u32(height).u32(width).u32(channels);
  // Two more slots than channels: the user mask and the sheet mask.
  for (let i = 0; i < channels + 2; i++) {
    if (i === slot) body.u32(1).u32(plane.byteLength).bytes(plane);
    else body.u32(0);
  }
  const finished = body.finish();
  w.u32(3).u32(finished.byteLength).bytes(finished);
}

/**
 * An .abr (version 10, subversion 2, as Photoshop 2026 writes) holding `file`'s presets, tips and patterns, each tip and
 * pattern grey and uncompressed, and the presets' groups. For fixtures and probe brushes: every preset must name its
 * tips and pattern by the ids they're given here.
 */
export function writePhotoshopAbr(file: Omit<PhotoshopBrushFile, 'kind'>): Uint8Array {
  const w = new PhotoshopByteWriter().u16(10).u16(2);
  const section = (key: string, body: Uint8Array) => {
    w.ascii('8BIM').ascii(key).u32(body.byteLength).bytes(body).pad(4);
  };
  const samp = new PhotoshopByteWriter();
  for (const [id, image] of file.tips) {
    const record = new PhotoshopByteWriter().pascal(id).u32(0x00010000);
    writeImageBlock(record, image, 56, 55);
    samp.u32(record.length).bytes(record.finish()).pad(4);
  }
  section('samp', samp.finish());
  const patt = new PhotoshopByteWriter();
  for (const [id, { name, image }] of file.patterns) {
    const record = new PhotoshopByteWriter().u32(1).u32(MODE_GRAY).u16(image.height).u16(image.width).unicode(name).pascal(id);
    writeImageBlock(record, image, 24, 0);
    patt.u32(record.length).bytes(record.finish()).pad(4);
  }
  section('patt', patt.finish());
  const desc = new PhotoshopByteWriter().u32(16);
  writePhotoshopDescriptor(desc, { _class: 'null', Brsh: file.presets.map((p) => p.descriptor) });
  section('desc', desc.finish());
  const phry = new PhotoshopByteWriter().u32(16);
  let group: string | undefined;
  const hierarchy: PhotoshopDescriptor[] = [];
  for (const preset of file.presets) {
    if (preset.group && preset.group !== group) hierarchy.push({ _class: 'Grup', 'Nm  ': (group = preset.group) });
    hierarchy.push({ _class: 'preset' });
  }
  writePhotoshopDescriptor(phry, { _class: 'null', hierarchy });
  section('phry', phry.finish());
  return w.finish();
}
