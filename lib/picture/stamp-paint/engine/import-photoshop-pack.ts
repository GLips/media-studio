// import-photoshop-pack.ts: `studio brushes import` for Photoshop. Turns an .abr, a .tpl, or a pack's zip holding
// either or both, into a style's assets in work/styles/<style>/brushes/<pack>/, the same layout a Procreate pack
// imports to: each brush's tip, dual tip and texture turned to dark-is-paint, and a manifest (StampPaintPack) holding
// each brush's preset, its images and the file it came from, which a style reads into a brush when it resolves.
// Photoshop files carry no rendered previews, so the manifest's previews stay empty: Photoshop's own renders come
// from the capture rig (vid-100).
//
// A computed tip (and a bristle or erodible one, read as round) is drawn by Photoshop's profile at its hardness and
// diameter, over the span its soft edge reaches, and shared by every brush alike, as tips/round-<hardness>-<diameter>.png; a sampled tip is written once per file and flip, as the first brush
// that uses it names it; a pattern likewise, once per polarity.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { photoshopPatternNegated, photoshopSampleWithBorder, photoshopTipImage, type PhotoshopBrushSource } from '../models/photoshop-brush.ts';
import { drawPhotoshopComputedTip } from '../models/photoshop-computed-tip.ts';
import { photoshopFlag, photoshopObject, type PhotoshopDescriptor } from '../models/photoshop-descriptor.ts';
import type { StampBrushAsset } from '../models/stamp-brush.ts';
import { STAMP_PAINT_ASSETS_VERSION, STAMP_PAINT_PACK_MANIFEST, type PhotoshopPackBrush, type StampBrushSupportNote, type StampPaintPack } from '../models/stamp-paint-pack.ts';
import { displayName, readPhotoshopAbr, readPhotoshopTpl, type PhotoshopBrushFile } from './photoshop-abr.ts';
import {
  replaceStampPaintPack, sha256OfFile, stampPackSlug, STAMP_PACK_GRAIN_MAX, STAMP_PACK_TIP_MAX, writeStampPackGray, type ImportStampPaintPackOptions,
} from './stamp-paint-pack-files.ts';
import { openZipFile } from './zip-archive.ts';

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

/** A preset for the manifest: its bristle and erodible tips' height maps dropped, which only a simulation reads. */
function sourcePreset(preset: PhotoshopDescriptor): PhotoshopDescriptor {
  return JSON.parse(JSON.stringify(preset, (key, value) => (key === 'dtipsErodibleTipHeightMap' ? undefined : value)));
}

/** Imports a Photoshop pack, replacing what an import writes only once it has succeeded (replaceStampPaintPack). */
export function importPhotoshopPack(options: ImportStampPaintPackOptions): ImportedPhotoshopPack {
  return replaceStampPaintPack(options, (staging) => writePackAssets(options, staging));
}

function writePackAssets({ archive, style, pack }: ImportStampPaintPackOptions, dir: string): Omit<ImportedPhotoshopPack, 'dir'> {
  const brushFiles = readBrushFiles(archive);
  for (const sub of ['tips', 'grains']) mkdirSync(join(dir, sub), { recursive: true });

  const brushes: Record<string, PhotoshopPackBrush> = {}, skipped: Record<string, StampBrushSupportNote[]> = {};
  const files = new Set<string>(), written = new Map<string, StampBrushAsset>();
  /** An image written once under `key`, at a file named from `slug` that no other image has taken. */
  const writeOnce = (key: string, folder: string, slug: string, body: (out: string) => void): StampBrushAsset => {
    const known = written.get(key);
    if (known) return known;
    let file = `${folder}/${slug}.png`;
    for (let n = 2; files.has(file); n++) file = `${folder}/${slug}-${n}.png`;
    body(join(dir, file));
    files.add(file);
    const asset = { style, pack, file };
    written.set(key, asset);
    return asset;
  };

  for (const { name: fileName, file } of brushFiles) {
    /** A sampled tip's own size, which its centre is read from, keyed as the source keys it; nothing for a computed tip. */
    const sampleSize = (key: 'tipSample' | 'dualTipSample', tip: PhotoshopDescriptor | undefined) => {
      const image = tip && photoshopTipImage(tip), sample = image?.kind === 'sampled' ? file.tips.get(image.id) : undefined;
      return sample ? { [key]: { width: sample.width, height: sample.height } } : {};
    };
    const tipAsset = (tip: PhotoshopDescriptor | undefined, slug: string): StampBrushAsset | undefined => {
      if (!tip) return undefined;
      const image = photoshopTipImage(tip);
      if (image.kind === 'round') {
        const hardness = Math.round(image.hardness * 100), key = `${hardness}-${stampPackSlug(String(image.diameter))}`;
        return writeOnce(`round|${key}`, 'tips', `round-${key}`, (out) => {
          const { size, pixels } = drawPhotoshopComputedTip(image.diameter, image.hardness, image.span, STAMP_PACK_TIP_MAX);
          writeStampPackGray({ width: size, height: size, pixels }, STAMP_PACK_TIP_MAX, out);
        });
      }
      const sample = file.tips.get(image.id);
      if (!sample) return undefined;
      return writeOnce(`${fileName}|${image.id}|${image.flipX}|${image.flipY}`, 'tips', slug, (out) => writeStampPackGray(photoshopSampleWithBorder(sample), STAMP_PACK_TIP_MAX, out, { negate: true, flipX: image.flipX, flipY: image.flipY }));
    };

    for (const { descriptor: preset, group } of file.presets) {
      const shown = displayName(String(preset['Nm  '] ?? '')).trim() || 'Untitled';
      // Legacy sets repeat names across their groups, and a manifest keys brushes by name.
      let name = shown in brushes || shown in skipped ? (group ? `${shown} (${group})` : shown) : shown;
      for (let n = 2; name in brushes || name in skipped; n++) name = `${shown} ${n}`;
      const slug = stampPackSlug(name) || `brush-${Object.keys(brushes).length + 1}`;

      const tip = photoshopObject(preset, 'Brsh'), dual = photoshopObject(preset, 'dualBrush');
      const dualTip = photoshopFlag(dual, 'useDualBrush') ? photoshopObject(dual, 'Brsh') : undefined;
      const tipImage = tipAsset(tip, slug);
      if (!tipImage) {
        skipped[name] = [{ level: 'unsupported', setting: 'Brsh.sampledData', detail: `the tip is a sample ${fileName} doesn't hold; not imported` }];
        continue;
      }
      const source: PhotoshopBrushSource = {
        preset: sourcePreset(preset),
        tip: tipImage,
        ...sampleSize('tipSample', tip),
        ...(dualTip && { dualTip: tipAsset(dualTip, `${slug}.dual`), ...sampleSize('dualTipSample', dualTip) }),
      };
      const texture = photoshopFlag(preset, 'useTexture') ? photoshopObject(preset, 'Txtr') : undefined;
      const pattern = texture && file.patterns.get(String(texture.Idnt ?? ''));
      if (pattern) {
        const negate = photoshopPatternNegated(preset);
        const image = writeOnce(`${fileName}|${String(texture.Idnt)}|${negate}`, 'grains', stampPackSlug(displayName(pattern.name)) || slug, (out) => writeStampPackGray(pattern.image, STAMP_PACK_GRAIN_MAX, out, { negate }));
        source.pattern = { image, width: pattern.image.width };
      }
      brushes[name] = { ...source, file: fileName, ...(group && { group }) };
    }
  }
  if (!Object.keys(brushes).length) throw new Error(`brushes import: ${archive} holds no brush presets`);

  const manifest: StampPaintPack = {
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
  writeFileSync(join(dir, STAMP_PAINT_PACK_MANIFEST), `${JSON.stringify(manifest, null, 1)}\n`);
  return { manifest };
}
