// procreate-probe-brushset.ts: `studio brushes probes`, which writes the probe brushes (models/procreate-probes.ts)
// as a .brushset Procreate imports. Each probe's Brush.archive is a real Procreate brush's, the template, with the
// probe's settings written over it: an archive rebuilt from nothing might lack a key or class Procreate expects, and a
// template carries every one. Its images are drawn here, white is paint.
//
// Negative space: no QuickLook/Thumbnail.png is written, so whatever preview comes back is Procreate's own.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { drawProcreateProbeImage, PROCREATE_PROBE_BASE, procreateProbes, type ProcreateProbe, type ProcreateProbeSettings } from '../models/procreate-probes.ts';
import { parseBinaryPlist, PlistReal, PlistUid, unarchiveKeyedPlist, writeBinaryPlist, type PlistValue } from './binary-plist.ts';
import { openZipBytes, openZipFile, writeZipArchive, type ZipArchive } from './zip-archive.ts';

/** A tip's and a grain's side, in pixels: Procreate's own run 500 to 2048. */
const TIP_SIZE = 512, GRAIN_SIZE = 1024;

/** An 8-bit greyscale PNG of `pixels`, `size` square. */
function greyPng(pixels: Uint8Array, size: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  const rows = Buffer.alloc(size * (size + 1));
  for (let y = 0; y < size; y++) rows.set(pixels.subarray(y * size, (y + 1) * size), y * (size + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** A UUID-shaped folder name, the same for the same probe every time. */
const folderOf = (name: string) => {
  const hex = createHash('sha256').update(`studio-probe|${name}`).digest('hex').toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

/** The template archive with `settings` over it and `name` as its name. A number stays a real where the template's was. */
function probeArchive(template: Uint8Array, name: string, settings: ProcreateProbeSettings): Uint8Array {
  const archive = parseBinaryPlist(template, { keepReals: true }) as { $objects: PlistValue[]; $top: { root: PlistUid } };
  const root = archive.$objects[archive.$top.root.uid] as Record<string, PlistValue>;
  for (const [key, value] of Object.entries(settings)) {
    const was = root[key];
    root[key] = typeof value === 'boolean' || (typeof was === 'number' && Number.isInteger(value)) ? value : new PlistReal(value);
  }
  archive.$objects.push(name);
  root.name = new PlistUid(archive.$objects.length - 1);
  return writeBinaryPlist(archive as unknown as PlistValue);
}

function openTemplate(archive: string): ZipArchive {
  if (archive.endsWith('.brushset')) return openZipFile(archive);
  const outer = openZipFile(archive), brushset = outer.names.find((name) => name.endsWith('.brushset'));
  if (!brushset) throw new Error(`brushes probes: ${archive} holds no .brushset`);
  const inner = openZipBytes(brushset, outer.read(brushset));
  outer.close();
  return inner;
}

/**
 * Writes the probe set to `out`, each probe over `brush` from the pack `archive` (a .brushset or the zip holding one),
 * which must be a single brush, not a dual. Returns the probes.
 */
export function writeProcreateProbeBrushset({ archive, brush, out }: { archive: string; brush: string; out: string }): ProcreateProbe[] {
  const pack = openTemplate(archive);
  const folder = pack.names.filter((name) => /^[^/]+\/Brush\.archive$/.test(name)).map((name) => name.split('/')[0])
    .find((f) => String(unarchiveKeyedPlist(pack.read(`${f}/Brush.archive`)).name ?? '').trim() === brush);
  if (!folder) throw new Error(`brushes probes: ${archive} has no brush named ${JSON.stringify(brush)}`);
  if (pack.names.includes(`${folder}/Sub01/Brush.archive`)) throw new Error(`brushes probes: ${brush} is a dual brush; pick a single one as the template`);
  const template = new Uint8Array(pack.read(`${folder}/Brush.archive`));
  pack.close();

  const probes = procreateProbes();
  const images = new Map<string, Buffer>();
  const image = (kind: Parameters<typeof drawProcreateProbeImage>[0], size: number) => {
    const key = `${kind}@${size}`;
    if (!images.has(key)) images.set(key, greyPng(drawProcreateProbeImage(kind, size), size));
    return images.get(key)!;
  };
  const entries: { name: string; data: Uint8Array }[] = [];
  const folders = probes.map((probe) => {
    const at = folderOf(probe.name);
    entries.push(
      { name: `${at}/Brush.archive`, data: probeArchive(template, probe.name, { ...PROCREATE_PROBE_BASE, ...probe.settings }) },
      { name: `${at}/Shape.png`, data: image(probe.tip, TIP_SIZE) },
      { name: `${at}/Grain.png`, data: image(probe.grain, GRAIN_SIZE) },
    );
    if (probe.dual) {
      entries.push(
        { name: `${at}/Sub01/Brush.archive`, data: probeArchive(template, `${probe.name} dual`, { ...PROCREATE_PROBE_BASE, ...probe.dual.settings }) },
        { name: `${at}/Sub01/Shape.png`, data: image(probe.dual.tip, TIP_SIZE) },
        { name: `${at}/Sub01/Grain.png`, data: image('flat', GRAIN_SIZE) },
      );
    }
    return at;
  });
  entries.unshift({ name: 'brushset.plist', data: writeBinaryPlist({ name: 'Studio probes', brushes: folders }) });
  writeFileSync(out, writeZipArchive(entries));
  return probes;
}
