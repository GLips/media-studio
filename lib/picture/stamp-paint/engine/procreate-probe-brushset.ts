// procreate-probe-brushset.ts: `studio brushes probes`, which writes the probe brushes (models/procreate-probes.ts)
// as a .brushset Procreate imports. Each probe's Brush.archive is a real Procreate brush's, the template, with the
// probe's settings written over it: an archive rebuilt from nothing might lack a key or class Procreate expects, and a
// template carries every one. Each setting keeps the type the template stores it as (a bool stays a bool, a 4-byte
// real a 4-byte real): Procreate drops a brush whose key decodes as the wrong type, and dropped the whole first set
// over textureDepthTilt, a bool the probes wrote as a real. Its images are drawn here, white is paint.
//
// A bridge probe is a real brush of the template's pack, copied whole and renamed, so it paints with its own settings.
// The set's name carries a hash of what's in it, so the capture rig can tell whether Procreate holds this set already.
//
// Negative space: the probes carry no QuickLook/Thumbnail.png, so whatever preview comes back is Procreate's own.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { drawProcreateProbeImage, PROCREATE_PROBE_BASE, procreateProbeSize, type ProcreateProbe, type ProcreateProbeSettings } from '../models/procreate-probes.ts';
import { parseBinaryPlist, PlistReal, PlistUid, unarchiveKeyedPlist, writeBinaryPlist, type PlistValue } from './binary-plist.ts';
import { openZipBytes, openZipFile, writeZipArchive, type ZipArchive } from './zip-archive.ts';

/** A tip's and a grain's side, in pixels: Procreate's own run 500 to 2048. */
const TIP_SIZE = 512, GRAIN_SIZE = 1024;
/** An 8-bit greyscale PNG of `pixels`. */
function png(pixels: Uint8Array, width: number, height: number): Buffer {
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
  header[9] = 0;
  const stride = width;
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

/**
 * The template archive with `settings` over it and `name` as its name, each setting the type the template stores it
 * as. A setting the template lacks is refused: Procreate may not read a key its own brushes never carry.
 */
function probeArchive(template: Uint8Array, name: string, settings: ProcreateProbeSettings): Uint8Array {
  const archive = parseBinaryPlist(template, { keepReals: true }) as { $objects: PlistValue[]; $top: { root: PlistUid } };
  const root = archive.$objects[archive.$top.root.uid] as Record<string, PlistValue>;
  for (const [key, value] of Object.entries(settings)) {
    const was = root[key];
    if (was === undefined) throw new Error(`brushes probes: the template brush has no ${key}; pick one that does`);
    root[key] = typeof was === 'boolean' ? Boolean(value)
        : was instanceof PlistReal ? new PlistReal(Number(value), was.bytes)
          : typeof was === 'number' ? Math.round(Number(value)) : new PlistReal(Number(value));
  }
  archive.$objects.push(name);
  root.name = new PlistUid(archive.$objects.length - 1);
  return writeBinaryPlist(archive as unknown as PlistValue);
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

/** The set's name in Procreate's Brush Library: the same for the same probes over the same template, and only then. */
export function procreateProbeSetName(probes: readonly ProcreateProbe[], template: string): string {
  return `Studio probes ${createHash('sha256').update(JSON.stringify({ probes, template })).digest('hex').slice(0, 6)}`;
}

/**
 * Writes `probes` as a set to `out`, each over `brush` from the pack `archive` (a .brushset or the zip holding one),
 * which must be a single brush, not a dual; a bridge probe is its named brush from the same pack. Returns the set's
 * name.
 */
export function writeProcreateProbeBrushset({ archive, brush, out, probes }: { archive: string; brush: string; out: string; probes: readonly ProcreateProbe[] }): string {
  const pack = openTemplate(archive);
  const folders = new Map(pack.names.filter((name) => /^[^/]+\/Brush\.archive$/.test(name)).map((name) => {
    const folder = name.split('/')[0];
    return [String(unarchiveKeyedPlist(pack.read(name)).name ?? '').trim(), folder] as const;
  }));
  const folderNamed = (name: string) => {
    const folder = folders.get(name);
    if (!folder) throw new Error(`brushes probes: ${archive} has no brush named ${JSON.stringify(name)}`);
    return folder;
  };
  const templateFolder = folderNamed(brush);
  if (pack.names.includes(`${templateFolder}/Sub01/Brush.archive`)) throw new Error(`brushes probes: ${brush} is a dual brush; pick a single one as the template`);
  const template = new Uint8Array(pack.read(`${templateFolder}/Brush.archive`));

  const images = new Map<string, Buffer>();
  const image = (kind: Parameters<typeof drawProcreateProbeImage>[0], size: number) => {
    const key = `${kind}@${size}`;
    if (!images.has(key)) images.set(key, png(drawProcreateProbeImage(kind, size), size, size));
    return images.get(key)!;
  };
  const entries: { name: string; data: Uint8Array }[] = [];
  const setFolders: string[] = [];
  const add = (at: string, files: { path: string; data: Uint8Array }[]) => {
    setFolders.push(at);
    for (const { path, data } of files) entries.push({ name: `${at}/${path}`, data });
  };
  const probeFiles = ({ name, ...probe }: ProcreateProbe) => {
    if (probe.bridge) {
      const from = folderNamed(probe.bridge.brush);
      return pack.names.filter((n) => n.startsWith(`${from}/`) && !n.endsWith('/')).map((n) => {
        const path = n.slice(from.length + 1), data = new Uint8Array(pack.read(n));
        return { path, data: path === 'Brush.archive' ? probeArchive(data, name, {}) : data };
      });
    }
    const size = procreateProbeSize(probe.diameter);
    return [
      { path: 'Brush.archive', data: probeArchive(template, name, { ...PROCREATE_PROBE_BASE, ...size, ...probe.settings }) },
      { path: 'Shape.png', data: image(probe.tip, TIP_SIZE) },
      { path: 'Grain.png', data: image(probe.grain, GRAIN_SIZE) },
      ...(probe.dual ? [
        { path: 'Sub01/Brush.archive', data: probeArchive(template, `${name} dual`, { ...PROCREATE_PROBE_BASE, ...size, ...probe.dual.settings }) },
        { path: 'Sub01/Shape.png', data: image(probe.dual.tip, TIP_SIZE) },
        { path: 'Sub01/Grain.png', data: image('flat', GRAIN_SIZE) },
      ] : []),
    ];
  };

  for (const probe of probes) add(folderOf(probe.name), probeFiles(probe));
  pack.close();
  const setName = procreateProbeSetName(probes, brush);
  // Procreate's own sets end with brushset.plist.
  entries.push({ name: 'brushset.plist', data: brushsetPlist(setName, setFolders) });
  writeFileSync(out, writeZipArchive(entries));
  return setName;
}
