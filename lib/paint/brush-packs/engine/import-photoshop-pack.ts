// import-photoshop-pack.ts: `studio brushes import` for Photoshop. Turns an .abr, a .tpl, or a zip of either into
// work/styles/<style>/brushes/<pack>/, laid out as a Procreate pack: each brush's tip, dual tip and texture as
// dark-is-paint, and a manifest (StampPaintPack) of each brush's preset, images and source file. Photoshop files carry
// no rendered previews, so the manifest's stay empty; Photoshop's renders come from the capture rig.
//
// A computed tip is drawn by Photoshop's profile (tips/round-<hardness>-<diameter>.png), an airbrush as its spray, an
// erodible tip as footprint and contact; a bristle tip isn't written, as it's drawn at the size it paints. A sample is
// written once per file and flip, a pattern once per polarity. A brush of an unread tip class is skipped.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  drawPhotoshopTipImage, photoshopPatternNegated, photoshopSampleWithBorder, photoshopTipImage, type PhotoshopBrushSource, type PhotoshopTipAsset,
} from '#lib/paint/photoshop-brushes/models/photoshop-brush.ts';
import { photoshopTagged, type PhotoshopDescriptor, type PhotoshopValue } from '#lib/paint/photoshop-brushes/models/photoshop-descriptor.ts';
import { drawPhotoshopErodibleTip } from '#lib/paint/photoshop-brushes/models/photoshop-erodible.ts';
import { readPhotoshopPreset, type PhotoshopKnownTip } from '#lib/paint/photoshop-brushes/models/photoshop-preset.ts';
import type { StampBrushAsset, StampBrushSupportNote } from '#lib/paint/brush/models/stamp-brush.ts';
import { STAMP_PACK_GRAIN_MAX, STAMP_PACK_TIP_MAX, STAMP_PAINT_ASSETS_VERSION, type PhotoshopPackBrush, type StoredStampPaintPack } from '../models/stamp-paint-pack.ts';
import { displayName, readPhotoshopAbr, readPhotoshopTpl, type PhotoshopBrushFile } from '#lib/paint/photoshop-brushes/engine/photoshop-abr.ts';
import { stampPackSlug, writeStampPackGray, type ImportStampPaintPackOptions } from './stamp-paint-pack-files.ts';
import { sha256OfFile } from '#lib/platform/files/engine/file-sha256.ts';
import { openZipFile } from '#lib/platform/zip/engine/zip-archive.ts';


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

/** Writes a Photoshop pack's images into `dir`, a new generation, and returns its manifest for the profiles to be measured into. */
export function writePhotoshopPackAssets({ archive, style, pack }: ImportStampPaintPackOptions, dir: string): StoredStampPaintPack {
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
      if (tip.kind === 'erodible') {
        const heights = erodibleHeights(raw, tip.gridSize, at);
        const heightMap = writeOnce(`heights|${heights.toString('hex')}`, 'tips', `${slug}.heights`, (out) => writeFileSync(out, heights), 'f32');
        const values = Float32Array.from({ length: tip.gridSize ** 2 }, (_, i) => heights.readFloatLE(4 * i));
        const { size, image, contact } = drawPhotoshopErodibleTip(tip, values, STAMP_PACK_TIP_MAX);
        const key = `${tip.customized ? heights.toString('hex') : tip.gridSize}|${tip.shape}|${tip.geometry.diameter}`;
        const gray = (pixels: Uint8Array) => (out: string) => writeStampPackGray({ width: size, height: size, pixels }, STAMP_PACK_TIP_MAX, out);
        return { kind: 'erodible', image: writeOnce(`erodible|${key}`, 'tips', slug, gray(image)), contact: writeOnce(`contact|${key}`, 'tips', `${slug}.contact`, gray(contact)), heightMap };
      }
      // A bristle tip is drawn at the diameter it's painted at, so the pack holds no image of it.
      if (tip.kind === 'bristle') return { kind: 'bristle' };
      const image = photoshopTipImage(tip);
      if (image.kind === 'sampled') {
        const sample = file.tips.get(image.id);
        if (!sample) return undefined;
        const sampledTipAsset = writeOnce(`${fileName}|${image.id}|${image.flipX}|${image.flipY}`, 'tips', slug, (out) => writeStampPackGray(photoshopSampleWithBorder(sample), STAMP_PACK_TIP_MAX, out, { negate: true, flipX: image.flipX, flipY: image.flipY }));
        return { kind: 'sampled', image: sampledTipAsset, sample: { width: sample.width, height: sample.height } };
      }
      const { key, size, pixels } = drawPhotoshopTipImage(image, STAMP_PACK_TIP_MAX);
      return { kind: 'round', image: writeOnce(`drawn|${key}`, 'tips', key, (out) => writeStampPackGray({ width: size, height: size, pixels }, STAMP_PACK_TIP_MAX, out)) };
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

  return {
    version: STAMP_PAINT_ASSETS_VERSION,
    app: 'photoshop',
    files: [...files].toSorted(),
    brushes,
    source: { archive: basename(archive), sha256: sha256OfFile(archive) },
    skipped,
    previews: {},
    palettes: {},
    papers: {},
  };
}
