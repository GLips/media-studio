// import-photoshop-pack.ts: `studio brushes import` for Photoshop. Turns an .abr, a .tpl, or a pack's zip holding
// either or both, into a style's assets in work/styles/<style>/brushes/<pack>/, the same layout a Procreate pack
// imports to: each brush's tip, dual tip and texture turned to dark-is-paint, and a manifest (StampPaintPack) holding
// each brush's preset, its images and the file it came from, which a style reads into a brush when it resolves.
// Photoshop files carry no rendered previews, so the manifest's previews stay empty: Photoshop's own renders come
// from the capture rig (vid-100).
//
// A computed tip (and a bristle, erodible or airbrush one, read as round) is drawn by Photoshop's profile at its
// hardness and diameter, over the span its soft edge reaches, and shared by every brush alike, as
// tips/round-<hardness>-<diameter>.png; an erodible tip's height map is written beside it, once per map, as
// tips/<brush>.heights.f32. A sampled tip is written once per file and flip, as the first brush that uses it names
// it; a pattern likewise, once per polarity. A brush whose tip class the studio doesn't read is skipped.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  photoshopPatternNegated, photoshopSampleWithBorder, photoshopTipImage, type PhotoshopBrushSource, type PhotoshopTipAsset,
} from '#lib/picture/photoshop-brushes/models/photoshop-brush.ts';
import { drawPhotoshopComputedTip } from '#lib/picture/photoshop-brushes/models/photoshop-computed-tip.ts';
import { photoshopTagged, type PhotoshopDescriptor, type PhotoshopValue } from '#lib/picture/photoshop-brushes/models/photoshop-descriptor.ts';
import { readPhotoshopPreset, type PhotoshopKnownTip } from '#lib/picture/photoshop-brushes/models/photoshop-preset.ts';
import type { StampBrushAsset, StampBrushSupportNote } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { readStampPaintPack, STAMP_PAINT_ASSETS_VERSION, STAMP_PAINT_PACK_MANIFEST, type PhotoshopPackBrush, type StampPaintPack } from '../models/stamp-paint-pack.ts';
import { displayName, readPhotoshopAbr, readPhotoshopTpl, type PhotoshopBrushFile } from '#lib/picture/photoshop-brushes/engine/photoshop-abr.ts';
import {
  replaceStampPaintPack, sha256OfFile, stampPackSlug, STAMP_PACK_GRAIN_MAX, STAMP_PACK_TIP_MAX, writeStampPackGray, type ImportStampPaintPackOptions,
} from './stamp-paint-pack-files.ts';
import { openZipFile } from '#lib/platform/zip/engine/zip-archive.ts';

export type ImportedPhotoshopPack = { dir: string; manifest: StampPaintPack };


/** Whether a file inside a pack's zip is a Photoshop brush file, and not macOS's resource-fork shadow of one. */
export const isPhotoshopBrushFile = (name: string) => /\.(abr|tpl)$/i.test(name) && !name.split('/').some((part) => part === '__MACOSX' || part.startsWith('._'));

/** Each brush file the archive is or holds, read, by its name. */
function readBrushFiles(archive: string): { name: string; file: PhotoshopBrushFile }[] {
  const read = (name: string, bytes: Uint8Array) => ({ name: basename(name), file: /\.tpl$/i.test(name) ? readPhotoshopTpl(bytes) : readPhotoshopAbr(bytes) });
  if (isPhotoshopBrushFile(archive)) return [read(archive, readFileSync(archive))];
  const zip = openZipFile(archive);
  try {
    const names = zip.names.filter(isPhotoshopBrushFile);
    if (!names.length) throw new Error(`brushes import: ${archive} holds no .abr or .tpl`);
    return names.map((name) => read(name, new Uint8Array(zip.read(name))));
  } finally {
    zip.close();
  }
}

/** A preset for the manifest: its erodible tips' height maps dropped, as each is written beside the tips (erodibleHeights). */
function sourcePreset(preset: PhotoshopDescriptor): PhotoshopDescriptor {
  return JSON.parse(JSON.stringify(preset, (key, value) => (key === 'dtipsErodibleTipHeightMap' ? undefined : value)));
}

const descriptorOf = (v: PhotoshopValue | undefined) => (v && typeof v === 'object' && !Array.isArray(v) && '_class' in v ? v : undefined);

/** An erodible tip's height map as the .abr holds it, `gridSize`² little-endian float32s; `at` names the brush. */
function erodibleHeights(tip: PhotoshopDescriptor | undefined, gridSize: number, at: string): Buffer {
  const raw = photoshopTagged(tip?.dtipsErodibleTipHeightMap);
  if (!raw || !('_raw' in raw)) throw new Error(`brushes import: ${at}'s erodible tip holds no height map`);
  const bytes = Buffer.from(raw.hex, 'hex');
  if (bytes.length !== gridSize * gridSize * 4) throw new Error(`brushes import: ${at}'s erodible height map is ${bytes.length} bytes, not a ${gridSize}² grid of floats`);
  return bytes;
}

/** Imports a Photoshop pack, replacing what an import writes only once it has succeeded (replaceStampPaintPack). */
export function importPhotoshopPack(options: ImportStampPaintPackOptions): ImportedPhotoshopPack {
  return replaceStampPaintPack(options, (staging) => writePackAssets(options, staging));
}

function writePackAssets({ archive, style, pack }: ImportStampPaintPackOptions, dir: string): Omit<ImportedPhotoshopPack, 'dir'> {
  const brushFiles = readBrushFiles(archive);
  for (const sub of ['tips', 'grains']) mkdirSync(join(dir, sub), { recursive: true });

  const brushes: Record<string, PhotoshopPackBrush<PhotoshopDescriptor>> = {}, skipped: Record<string, StampBrushSupportNote[]> = {};
  const files = new Set<string>(), written = new Map<string, StampBrushAsset>();
  /** A file written once under `key`, at a name from `slug` and `extension` that no other file has taken. */
  const writeOnce = (key: string, folder: string, slug: string, body: (out: string) => void, extension = 'png'): StampBrushAsset => {
    const known = written.get(key);
    if (known) return known;
    let file = `${folder}/${slug}.${extension}`;
    for (let n = 2; files.has(file); n++) file = `${folder}/${slug}-${n}.${extension}`;
    body(join(dir, file));
    files.add(file);
    const asset = { style, pack, file };
    written.set(key, asset);
    return asset;
  };

  for (const { name: fileName, file } of brushFiles) {
    /** Where `tip` (its descriptor `raw`) lands among the pack's files; nothing for a sample the file lacks. */
    const tipAsset = (tip: PhotoshopKnownTip, raw: PhotoshopDescriptor | undefined, slug: string, at: string): PhotoshopTipAsset | undefined => {
      const image = photoshopTipImage(tip);
      if (image.kind === 'sampled') {
        const sample = file.tips.get(image.id);
        if (!sample) return undefined;
        const written = writeOnce(`${fileName}|${image.id}|${image.flipX}|${image.flipY}`, 'tips', slug, (out) => writeStampPackGray(photoshopSampleWithBorder(sample), STAMP_PACK_TIP_MAX, out, { negate: true, flipX: image.flipX, flipY: image.flipY }));
        return { kind: 'sampled', image: written, sample: { width: sample.width, height: sample.height } };
      }
      const hardness = Math.round(image.hardness * 100), key = `${hardness}-${stampPackSlug(String(image.diameter))}`;
      const drawing = writeOnce(`round|${key}`, 'tips', `round-${key}`, (out) => {
        const { size, pixels } = drawPhotoshopComputedTip(image.diameter, image.hardness, image.span, STAMP_PACK_TIP_MAX);
        writeStampPackGray({ width: size, height: size, pixels }, STAMP_PACK_TIP_MAX, out);
      });
      if (tip.kind !== 'erodible') return { kind: 'round', image: drawing };
      const heights = erodibleHeights(raw, tip.gridSize, at);
      const heightMap = writeOnce(`heights|${heights.toString('hex')}`, 'tips', `${slug}.heights`, (out) => writeFileSync(out, heights), 'f32');
      return { kind: 'erodible', image: drawing, heightMap };
    };

    for (const { descriptor: preset, group } of file.presets) {
      const shown = displayName(String(preset['Nm  '] ?? '')).trim() || 'Untitled';
      // Legacy sets repeat names across their groups, and a manifest keys brushes by name.
      let name = shown in brushes || shown in skipped ? (group ? `${shown} (${group})` : shown) : shown;
      for (let n = 2; name in brushes || name in skipped; n++) name = `${shown} ${n}`;
      const slug = stampPackSlug(name) || `brush-${Object.keys(brushes).length + 1}`;

      const typed = readPhotoshopPreset(preset), { tip } = typed, dualTip = typed.dual?.tip;
      if (tip.kind === 'unsupported') {
        skipped[name] = [{ level: 'unsupported', setting: 'tip.kind', detail: `the tip is a ${tip.classId}, which the studio doesn't read; not imported` }];
        continue;
      }
      const tipImage = tipAsset(tip, descriptorOf(preset.Brsh), slug, name);
      if (!tipImage) {
        skipped[name] = [{ level: 'unsupported', setting: 'tip.sample', detail: `the tip is a sample ${fileName} doesn't hold; not imported` }];
        continue;
      }
      const dualImage = dualTip && dualTip.kind !== 'unsupported' ? tipAsset(dualTip, descriptorOf(descriptorOf(preset.dualBrush)?.Brsh), `${slug}.dual`, `${name}'s dual`) : undefined;
      const source: PhotoshopBrushSource<PhotoshopDescriptor> = { preset: sourcePreset(preset), tip: tipImage, ...(dualImage && { dualTip: dualImage }) };
      const patternId = typed.texture?.pattern?.id ?? '', pattern = typed.texture && file.patterns.get(patternId);
      if (pattern) {
        const negate = photoshopPatternNegated(typed);
        const image = writeOnce(`${fileName}|${patternId}|${negate}`, 'grains', stampPackSlug(displayName(pattern.name)) || slug, (out) => writeStampPackGray(pattern.image, STAMP_PACK_GRAIN_MAX, out, { negate }));
        source.pattern = { image, width: pattern.image.width };
      }
      brushes[name] = { ...source, file: fileName, ...(group && { group }) };
    }
  }
  if (!Object.keys(brushes).length) throw new Error(`brushes import: ${archive} holds no brush presets`);

  const stored = {
    version: STAMP_PAINT_ASSETS_VERSION,
    app: 'photoshop',
    files: [...files].sort(),
    brushes,
    source: { archive: basename(archive), sha256: sha256OfFile(archive) },
    skipped,
    previews: {},
    palettes: {},
    papers: {},
  };
  writeFileSync(join(dir, STAMP_PAINT_PACK_MANIFEST), `${JSON.stringify(stored, null, 1)}\n`);
  return { manifest: readStampPaintPack(stored) };
}
