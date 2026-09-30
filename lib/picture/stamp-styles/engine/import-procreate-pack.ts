// import-procreate-pack.ts: `studio brushes import`. Turns a bought Procreate pack (a .brushset, or the zip it came in,
// which may also hold .swatches palettes and .procreate paper canvases) into a style's assets in
// work/styles/<style>/brushes/<pack>/: each brush's tip and grain turned to dark-is-paint and downsized, its dual's
// likewise, its Procreate preview, the papers and a manifest (StampPaintPack) holding each brush's own settings and
// images, which a style reads into a brush when it resolves. An import replaces what it writes whole, and only once it
// has succeeded.
//
// A .brushset is a zip of one folder per brush, named by UUID, in the order brushset.plist lists: Brush.archive (an
// NSKeyedArchiver plist of settings), Shape.png, Grain.png, QuickLook/Thumbnail.png and, for a dual brush, Sub01/
// holding a whole second brush. Reset/ keeps the brush as first shipped, and is ignored.

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { procreateGrainNegated, procreateTipNegated, type ProcreateBrushSettings, type ProcreateBrushSource } from '#lib/picture/procreate-brushes/models/procreate-brush.ts';
import {
  STAMP_PAINT_ASSETS_VERSION, STAMP_PAINT_PACK_MANIFEST,
  type ProcreatePackBrush, type StampPaintPack, type StampPaintPackPaper, type StampPaintPackPreview,
} from '../models/stamp-paint-pack.ts';
import type { StampBrushSupportNote } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import type { StampPaintColor } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import { parseBinaryPlist, unarchiveKeyedPlist } from '#lib/picture/procreate-brushes/engine/binary-plist.ts';
import { readProcreateComposite } from '#lib/picture/procreate-brushes/engine/procreate-canvas.ts';
import {
  fitWithin, replaceStampPaintPack, sha256OfFile, stampPackSlug as slugOf, STAMP_PACK_GRAIN_MAX as GRAIN_MAX, STAMP_PACK_PAPER_MAX as PAPER_MAX,
  STAMP_PACK_TIP_MAX as TIP_MAX, writeStampPackPng as writeBrushImage, type ImportStampPaintPackOptions,
} from './stamp-paint-pack-files.ts';
import { openZipBytes, openZipFile, type ZipArchive } from '#lib/platform/zip/engine/zip-archive.ts';

/**
 * How ffmpeg turns a stored composite to the way Procreate shows it, by the document's orientation. Only the ones
 * seen are listed, each checked against the document's own thumbnail.
 */
const PROCREATE_ORIENTATION_TRANSPOSE: Readonly<Record<number, string>> = { 3: 'clock_flip', 4: 'cclock_flip' };

/** Settings as JSON keeps them: numbers, booleans, strings and pressure curves; bytes and dates aren't a brush's painting. */
const jsonSettings = (settings: ProcreateBrushSettings): ProcreateBrushSettings => Object.fromEntries(Object.entries(settings).filter(([key, value]) =>
  typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' || (key.endsWith('Curve') && value !== null && typeof value === 'object')));

export type ImportedProcreatePack = { dir: string; manifest: StampPaintPack };

/** Brushes in the order brushset.plist lists them, by folder, with the set's name. */
function readBrushsetOrder(brushset: ZipArchive): { name: string; folders: string[] } {
  const plist = brushset.read('brushset.plist');
  if (plist.subarray(0, 8).toString() === 'bplist00') {
    const root = parseBinaryPlist(plist) as { name?: string; brushes: string[] };
    return { name: root.name ?? '', folders: root.brushes };
  }
  const xml = plist.toString('utf8');
  const array = /<key>brushes<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)?.[1] ?? '';
  return { name: /<key>name<\/key>\s*<string>([^<]*)<\/string>/.exec(xml)?.[1] ?? '', folders: [...array.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]) };
}

/** A palette's colours in order, each swatch's HSV as #rrggbb; empty slots dropped. */
function readSwatches(bytes: Buffer, label: string): { name: string; colors: StampPaintColor[] } {
  const zip = openZipBytes(label, bytes);
  const json = JSON.parse(zip.read('Swatches.json').toString('utf8')) as { name: string; swatches: ({ hue: number; saturation: number; brightness: number } | null)[] };
  const hex = (value: number) => Math.round(value * 255).toString(16).padStart(2, '0');
  const colors = json.swatches.filter((swatch) => swatch !== null).map(({ hue, saturation, brightness }): StampPaintColor => {
    const channel = (n: number) => {
      const k = (n + hue * 6) % 6;
      return brightness - brightness * saturation * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return `#${hex(channel(5))}${hex(channel(3))}${hex(channel(1))}`;
  });
  return { name: json.name, colors };
}

/** A paper canvas: the composite as Procreate shows it, its grey tooth stretched to the full range, its mean colour. */
function writePaper(bytes: Buffer, label: string, packDir: string, slug: string): StampPaintPackPaper {
  const canvas = readProcreateComposite(label, openZipBytes(label, bytes));
  const transpose = PROCREATE_ORIENTATION_TRANSPOSE[canvas.orientation];
  if (transpose === undefined && canvas.orientation !== 1) throw new Error(`${label} is turned by orientation ${canvas.orientation}, which the importer hasn't seen; it knows 1, ${Object.keys(PROCREATE_ORIENTATION_TRANSPOSE).join(', ')}`);
  const turned = transpose ? { width: canvas.height, height: canvas.width } : canvas;
  const { width, height } = fitWithin(turned.width, turned.height, PAPER_MAX);
  const image = `papers/${slug}.png`, grain = `papers/${slug}.grain.png`;
  const rgb = withStudioTemp('paper', (dir) => {
    writeFileSync(join(dir, 'canvas.raw'), canvas.rgba);
    const filters = [...(transpose ? [`transpose=${transpose}`] : []), `scale=${width}:${height}:flags=area`].join(',');
    runFfmpeg(['-nostdin', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${canvas.width}x${canvas.height}`, '-i', join(dir, 'canvas.raw'), '-vf', `${filters},format=rgb24`, '-y', join(packDir, image)]);
    return runFfmpeg(['-nostdin', '-v', 'error', '-i', join(packDir, image), '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 28 });
  });
  const pixels = rgb.length / 3, mean = [0, 0, 0];
  const luma = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) mean[c] += rgb[i * 3 + c];
    luma[i] = Math.round(0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]);
  }
  // Stretched between its 1st and 99th percentiles, so the tooth's valleys (where pigment settles) read dark.
  const sorted = luma.slice().sort(), low = sorted[Math.floor(pixels * 0.01)], high = Math.max(low + 1, sorted[Math.floor(pixels * 0.99)]);
  withStudioTemp('paper-grain', (dir) => {
    writeFileSync(join(dir, 'grain.raw'), luma.map((value) => Math.round(Math.min(1, Math.max(0, (value - low) / (high - low))) * 255)));
    runFfmpeg(['-nostdin', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${width}x${height}`, '-i', join(dir, 'grain.raw'), '-y', join(packDir, grain)]);
  });
  const color = `#${mean.map((sum) => Math.round(sum / pixels).toString(16).padStart(2, '0')).join('')}` as StampPaintColor;
  return { image, grain, color };
}

/** Imports a Procreate pack, replacing what an import writes only once it has succeeded (replaceStampPaintPack). */
export function importProcreatePack(options: ImportStampPaintPackOptions): ImportedProcreatePack {
  return replaceStampPaintPack(options, (staging) => writePackAssets(options.archive, staging, options.style, options.pack));
}

function writePackAssets(archive: string, dir: string, style: string, pack: string): Omit<ImportedProcreatePack, 'dir'> {
  const outer = archive.endsWith('.brushset') ? undefined : openZipFile(archive);
  const brushsets = outer ? outer.names.filter((name) => name.endsWith('.brushset')) : [archive];
  if (!brushsets.length) throw new Error(`brushes import: ${archive} holds no .brushset`);
  for (const sub of ['tips', 'grains', 'previews', 'papers']) mkdirSync(join(dir, sub), { recursive: true });

  const brushes: Record<string, ProcreatePackBrush> = {}, skipped: Record<string, StampBrushSupportNote[]> = {}, previews: Record<string, StampPaintPackPreview> = {};
  const files = new Set<string>();
  const write = (file: string, body: () => void) => {
    if (files.has(file)) throw new Error(`brushes import: two of the pack's brushes or papers would both write ${file}; their names differ only in punctuation`);
    body();
    files.add(file);
    return { style, pack, file };
  };

  for (const entry of brushsets) {
    const brushset = outer ? openZipBytes(entry, outer.read(entry)) : openZipFile(entry);
    const has = (name: string) => brushset.names.includes(name);
    for (const folder of readBrushsetOrder(brushset).folders) {
      const settings = unarchiveKeyedPlist(brushset.read(`${folder}/Brush.archive`)) as ProcreateBrushSettings;
      const name = String(settings.name ?? '').trim();
      // Procreate's section headers are brushes with a name and nothing to paint; their names hold no letter or digit.
      if (!/[\p{L}\p{N}]/u.test(name)) continue;
      if (brushes[name] || skipped[name]) throw new Error(`brushes import: two brushes are named ${JSON.stringify(name)}, and a pack's manifest keys brushes by name`);
      if (!has(`${folder}/Shape.png`)) {
        skipped[name] = [{ level: 'unsupported', setting: 'bundledShapePath', detail: `the tip is Procreate's own ${String(settings.bundledShapePath)}, which the pack doesn't hold; not imported` }];
        continue;
      }
      // A name in a script slugOf drops (水彩) is filed under its folder's UUID.
      const slug = slugOf(name) || folder.toLowerCase();
      const source = (prefix: string, suffix: string, layerSettings: ProcreateBrushSettings): ProcreateBrushSource => ({
        settings: layerSettings,
        tip: write(`tips/${slug}${suffix}.png`, () => writeBrushImage(brushset.read(`${prefix}Shape.png`), TIP_MAX, procreateTipNegated(layerSettings), join(dir, `tips/${slug}${suffix}.png`))),
        ...(has(`${prefix}Grain.png`) && {
          grain: write(`grains/${slug}${suffix}.png`, () => writeBrushImage(brushset.read(`${prefix}Grain.png`), GRAIN_MAX, procreateGrainNegated(layerSettings), join(dir, `grains/${slug}${suffix}.png`))),
        }),
      });
      const hasDual = has(`${folder}/Sub01/Brush.archive`), dualSettings = hasDual ? unarchiveKeyedPlist(brushset.read(`${folder}/Sub01/Brush.archive`)) as ProcreateBrushSettings : undefined;
      const dualShapeMissing = hasDual && !has(`${folder}/Sub01/Shape.png`);
      const dual = dualSettings && !dualShapeMissing ? source(`${folder}/Sub01/`, '.dual', dualSettings) : undefined;
      const main = source(`${folder}/`, '', settings);
      brushes[name] = {
        main: { ...main, settings: jsonSettings(main.settings) },
        ...(dual && { dual: { ...dual, settings: jsonSettings(dual.settings) } }),
        ...(dualShapeMissing && {
          dropped: [{ level: 'unsupported', setting: 'Sub01 bundledShapePath', detail: `the dual's tip is Procreate's own ${String(dualSettings?.bundledShapePath)}, which the pack doesn't hold; imported without its dual` }],
        }),
      };
      if (has(`${folder}/QuickLook/Thumbnail.png`)) {
        write(`previews/${slug}.png`, () => writeFileSync(join(dir, `previews/${slug}.png`), brushset.read(`${folder}/QuickLook/Thumbnail.png`)));
        // Procreate previews a brush set to `stamp` as a single stamp, not a stroke.
        previews[name] = { image: `previews/${slug}.png`, shows: settings.stamp === true ? 'stamp' : 'stroke' };
      }
    }
    brushset.close();
  }

  const palettes: Record<string, StampPaintColor[]> = {}, papers: Record<string, StampPaintPackPaper> = {};
  for (const entry of outer?.names ?? []) {
    if (entry.endsWith('.swatches')) {
      const { name, colors } = readSwatches(outer!.read(entry), entry);
      palettes[name.trim()] = colors;
    } else if (entry.endsWith('.procreate')) {
      const name = basename(entry, '.procreate').replace(/_/g, ' ');
      const slug = slugOf(name) || `paper-${Object.keys(papers).length + 1}`;
      if (papers[name] || files.has(`papers/${slug}.png`)) throw new Error(`brushes import: two paper canvases are named ${JSON.stringify(name)} or differ only in punctuation`);
      const paper = writePaper(outer!.read(entry), entry, dir, slug);
      files.add(paper.image).add(paper.grain);
      papers[name] = paper;
    }
  }
  outer?.close();

  const manifest: StampPaintPack = {
    version: STAMP_PAINT_ASSETS_VERSION,
    app: 'procreate',
    files: [...files].sort(),
    brushes,
    source: { archive: basename(archive), sha256: sha256OfFile(archive) },
    skipped,
    previews,
    palettes,
    papers,
  };
  writeFileSync(join(dir, STAMP_PAINT_PACK_MANIFEST), `${JSON.stringify(manifest, null, 1)}\n`);
  return { manifest };
}
