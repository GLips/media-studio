// procreate-probe-brushset.ts: `studio brushes probes`, which writes the probe brushes (models/procreate-probes.ts)
// as a .brushset Procreate imports. Each probe's Brush.archive is a real Procreate brush's, the template, with the
// probe's settings written over it: an archive rebuilt from nothing might lack a key or class Procreate expects, and a
// template carries every one. Each setting keeps the type the template stores it as (a bool stays a bool, a 4-byte
// real a 4-byte real): Procreate drops a brush whose key decodes as the wrong type, and dropped the whole first set
// over textureDepthTilt, a bool the probes wrote as a real. Its images are drawn here, white is paint.
//
// The set also holds diagnostic brushes, each one factor away from a probe, so which of them Procreate keeps says what
// it requires of a brush (PROCREATE_PROBE_DIAGNOSTICS).
//
// Negative space: the probes carry no QuickLook/Thumbnail.png, so whatever preview comes back is Procreate's own.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { drawProcreateProbeImage, PROCREATE_PROBE_BASE, procreateProbes, type ProcreateProbe, type ProcreateProbeSettings } from '../models/procreate-probes.ts';
import { parseBinaryPlist, PlistReal, PlistUid, unarchiveKeyedPlist, writeBinaryPlist, type PlistValue } from './binary-plist.ts';
import { openZipBytes, openZipFile, writeZipArchive, type ZipArchive } from './zip-archive.ts';

/** A tip's and a grain's side, in pixels: Procreate's own run 500 to 2048. */
const TIP_SIZE = 512, GRAIN_SIZE = 1024;
/** Procreate's own brush preview's size, in pixels. */
const THUMBNAIL = { width: 1060, height: 324 } as const;

/** A PNG of `pixels`: 8-bit greyscale, or RGBA when `channels` is 4. */
function png(pixels: Uint8Array, width: number, height: number, channels: 1 | 4 = 1): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 0;
  const stride = width * channels;
  const rows = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) rows.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** A version-4 UUID, as Procreate names a brush's folder, the same for the same name every time. */
const folderOf = (name: string) => {
  const hex = createHash('sha256').update(`studio-probe|${name}`).digest('hex').toUpperCase().split('');
  hex[12] = '4';
  hex[16] = '89AB'[parseInt(hex[16], 16) % 4];
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

/** How a probe's archive is written: the fixes a diagnostic brush leaves out, one at a time. */
type ArchiveForm = { boolAsReal?: string; widenReals?: boolean };

/** Every real in `value`, 8 bytes wide. */
const widened = (value: PlistValue): PlistValue => (value instanceof PlistReal ? new PlistReal(value.value, 8)
  : Array.isArray(value) ? value.map(widened)
    : value && typeof value === 'object' && !(value instanceof Uint8Array) && !(value instanceof PlistUid)
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, widened(v)])) : value);

/**
 * The template archive with `settings` over it and `name` as its name, each setting the type the template stores it
 * as. A setting the template lacks is refused: Procreate may not read a key its own brushes never carry.
 */
function probeArchive(template: Uint8Array, name: string, settings: ProcreateProbeSettings, form: ArchiveForm = {}): Uint8Array {
  const archive = parseBinaryPlist(template, { keepReals: true }) as { $objects: PlistValue[]; $top: { root: PlistUid } };
  const root = archive.$objects[archive.$top.root.uid] as Record<string, PlistValue>;
  for (const [key, value] of Object.entries(settings)) {
    const was = root[key];
    if (was === undefined) throw new Error(`brushes probes: the template brush has no ${key}; pick one that does`);
    root[key] = key === form.boolAsReal ? new PlistReal(Number(value))
      : typeof was === 'boolean' ? Boolean(value)
        : was instanceof PlistReal ? new PlistReal(Number(value), was.bytes)
          : typeof was === 'number' ? Math.round(Number(value)) : new PlistReal(Number(value));
  }
  archive.$objects.push(name);
  root.name = new PlistUid(archive.$objects.length - 1);
  return writeBinaryPlist((form.widenReals ? widened(archive as unknown as PlistValue) : archive) as unknown as PlistValue);
}

/** brushset.plist as Procreate writes it: an XML plist of the set's name and its brushes' folders, in order. */
function brushsetPlist(name: string, folders: readonly string[]): Uint8Array {
  const escaped = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>brushes</key>
\t<array>
${folders.map((f) => `\t\t<string>${f}</string>`).join('\n')}
\t</array>
\t<key>name</key>
\t<string>${escaped(name)}</string>
</dict>
</plist>
`);
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
 * The diagnostic brushes, listed first in the set. Each is Probe 01 with one fix left out or one thing added, but
 * `as bought`, the template itself: which ones Procreate keeps, beside whether the probes load, says what it requires.
 */
export const PROCREATE_PROBE_DIAGNOSTICS = [
  { key: 'asBought', name: '(the template, unchanged)', reads: "the template brush's folder repacked byte for byte (it keeps its own name): whether this set's packing loads at all" },
  { key: 'renamed', name: 'Diag 1 template renamed', reads: 'the template with only its name changed, through the plist writer, no extra folders: whether the writer and the bare folder load' },
  { key: 'boolAsReal', name: 'Diag 2 bool as real', reads: 'Probe 01 with textureDepthTilt written as a real, as the first set wrote every probe: whether a mistyped key drops a brush' },
  { key: 'wideReals', name: 'Diag 3 8-byte reals', reads: "Probe 01 with every real written 8 bytes wide, as the first set did, where Procreate's are 4: whether width matters" },
  { key: 'oldFolder', name: 'Diag 4 non-v4 folder', reads: 'Probe 01 in a folder named like the first set\'s (no version-4 digits): whether the folder name must be a v4 UUID' },
  { key: 'thumbnail', name: 'Diag 5 with thumbnail', reads: 'Probe 01 with a blank QuickLook/Thumbnail.png: whether a brush needs one (the probes carry none)' },
  { key: 'reset', name: 'Diag 6 with Reset', reads: 'Probe 01 with a Reset/ copy of itself, as Procreate\'s own brushes have: whether a brush needs one' },
] as const;

/**
 * Writes the probe set to `out`, each probe over `brush` from the pack `archive` (a .brushset or the zip holding one),
 * which must be a single brush, not a dual, with the diagnostic brushes before them. Returns every brush in the set,
 * in order, with what it reads.
 */
export function writeProcreateProbeBrushset({ archive, brush, out }: { archive: string; brush: string; out: string }): { name: string; reads: string }[] {
  const pack = openTemplate(archive);
  const folder = pack.names.filter((name) => /^[^/]+\/Brush\.archive$/.test(name)).map((name) => name.split('/')[0])
    .find((f) => String(unarchiveKeyedPlist(pack.read(`${f}/Brush.archive`)).name ?? '').trim() === brush);
  if (!folder) throw new Error(`brushes probes: ${archive} has no brush named ${JSON.stringify(brush)}`);
  if (pack.names.includes(`${folder}/Sub01/Brush.archive`)) throw new Error(`brushes probes: ${brush} is a dual brush; pick a single one as the template`);
  const templateFiles = pack.names.filter((name) => name.startsWith(`${folder}/`) && !name.endsWith('/')).map((name) => ({ path: name.slice(folder.length + 1), data: new Uint8Array(pack.read(name)) }));
  const template = templateFiles.find((f) => f.path === 'Brush.archive')!.data;
  pack.close();

  const images = new Map<string, Buffer>();
  const image = (kind: Parameters<typeof drawProcreateProbeImage>[0], size: number) => {
    const key = `${kind}@${size}`;
    if (!images.has(key)) images.set(key, png(drawProcreateProbeImage(kind, size), size, size));
    return images.get(key)!;
  };
  const entries: { name: string; data: Uint8Array }[] = [];
  const folders: string[] = [];
  const add = (at: string, files: { path: string; data: Uint8Array }[]) => {
    folders.push(at);
    for (const { path, data } of files) entries.push({ name: `${at}/${path}`, data });
  };
  const probeFiles = (probe: ProcreateProbe, name: string, form: ArchiveForm = {}) => [
    { path: 'Brush.archive', data: probeArchive(template, name, { ...PROCREATE_PROBE_BASE, ...probe.settings }, form) },
    { path: 'Shape.png', data: image(probe.tip, TIP_SIZE) },
    { path: 'Grain.png', data: image(probe.grain, GRAIN_SIZE) },
    ...(probe.dual ? [
      { path: 'Sub01/Brush.archive', data: probeArchive(template, `${name} dual`, { ...PROCREATE_PROBE_BASE, ...probe.dual.settings }, form) },
      { path: 'Sub01/Shape.png', data: image(probe.dual.tip, TIP_SIZE) },
      { path: 'Sub01/Grain.png', data: image('flat', GRAIN_SIZE) },
    ] : []),
  ];

  const probes = procreateProbes();
  const first = probes[0];
  for (const d of PROCREATE_PROBE_DIAGNOSTICS) {
    const at = folderOf(d.name);
    switch (d.key) {
      case 'asBought': add(at, templateFiles); break;
      case 'renamed': add(at, [
        { path: 'Brush.archive', data: probeArchive(template, d.name, {}) },
        ...templateFiles.filter((f) => f.path === 'Shape.png' || f.path === 'Grain.png'),
      ]); break;
      case 'boolAsReal': add(at, probeFiles(first, d.name, { boolAsReal: 'textureDepthTilt' })); break;
      case 'wideReals': add(at, probeFiles(first, d.name, { widenReals: true })); break;
      case 'oldFolder': add(`${at.slice(0, 14)}0${at.slice(15)}`, probeFiles(first, d.name)); break;
      case 'thumbnail': add(at, [...probeFiles(first, d.name), { path: 'QuickLook/Thumbnail.png', data: png(new Uint8Array(THUMBNAIL.width * THUMBNAIL.height * 4), THUMBNAIL.width, THUMBNAIL.height, 4) }]); break;
      case 'reset': {
        const files = probeFiles(first, d.name);
        add(at, [...files, ...files.map((f) => ({ path: `Reset/${f.path}`, data: f.data }))]);
        break;
      }
    }
  }
  for (const probe of probes) add(folderOf(probe.name), probeFiles(probe, probe.name));
  // Procreate's own sets end with brushset.plist.
  entries.push({ name: 'brushset.plist', data: brushsetPlist('Studio probes', folders) });
  writeFileSync(out, writeZipArchive(entries));
  return [...PROCREATE_PROBE_DIAGNOSTICS.map(({ name, reads }) => ({ name: name.startsWith('(') ? brush : name, reads })), ...probes];
}
