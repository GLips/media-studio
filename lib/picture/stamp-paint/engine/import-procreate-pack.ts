// import-procreate-pack.ts: `studio brushes import`. Turns a bought Procreate pack (a .brushset, or the zip it came in,
// which may also hold .swatches palettes and .procreate paper canvases) into a style's assets in
// work/styles/<style>/brushes/<pack>/: each brush's tip and grain turned to dark-is-paint and downsized, its dual's
// likewise, its Procreate preview, the papers and a manifest (StampPaintPackManifest) holding the normalized brushes
// and what didn't carry over; and procreate-sources.json, each brush's own settings and images, which `studio brushes
// fit` reads again with other constants. An import replaces the pack's folder whole, and only once it has succeeded.
//
// A .brushset is a zip of one folder per brush, named by UUID, in the order brushset.plist lists: Brush.archive (an
// NSKeyedArchiver plist of settings), Shape.png, Grain.png, QuickLook/Thumbnail.png and, for a dual brush, Sub01/
// holding a whole second brush. Reset/ keeps the brush as first shipped, and is ignored.

import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { runFfmpeg } from '#lib/output/ffmpeg/engine/ffmpeg.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import {
  normalizeProcreateBrush, procreateGrainNegated, procreateTipNegated, type ProcreateBrushSettings, type ProcreateBrushSource,
} from '../models/procreate-brush.ts';
import type { StampBrush } from '../models/stamp-brush.ts';
import type { StampPaintColor } from '../models/stamp-paint-recipe.ts';
import {
  STAMP_PAINT_ASSETS_VERSION, STAMP_PAINT_PACK_MANIFEST,
  type StampBrushSupportNote, type StampPaintPackManifest, type StampPaintPackPaper, type StampPaintPackPreview,
} from '../models/style.ts';
import { parseBinaryPlist, unarchiveKeyedPlist } from './binary-plist.ts';
import { readProcreateComposite } from './procreate-canvas.ts';
import { openZipBytes, openZipFile, type ZipArchive } from './zip-archive.ts';

/** Longest side of each stored image, in pixels: tips stamp at a few hundred, grains tile, papers span a frame. */
const TIP_MAX = 512, GRAIN_MAX = 1024, PAPER_MAX = 2560;

/**
 * How ffmpeg turns a stored composite to the way Procreate shows it, by the document's orientation. Only the ones
 * seen are listed, each checked against the document's own thumbnail.
 */
const PROCREATE_ORIENTATION_TRANSPOSE: Readonly<Record<number, string>> = { 3: 'clock_flip', 4: 'cclock_flip' };

/** A pack's procreate-sources.json: each imported brush's settings and images, and its dual's, by its name. */
export const PROCREATE_SOURCES = 'procreate-sources.json';
export type ProcreatePackSources = Record<string, { main: ProcreateBrushSource; dual?: ProcreateBrushSource }>;

/** Settings as JSON keeps them: numbers, booleans, strings and pressure curves; bytes and dates aren't a brush's painting. */
const jsonSettings = (settings: ProcreateBrushSettings): ProcreateBrushSettings => Object.fromEntries(Object.entries(settings).filter(([key, value]) =>
  typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' || (key.endsWith('Curve') && value !== null && typeof value === 'object')));

export type ImportProcreatePackOptions = { archive: string; stylesDir: string; style: string; pack: string };
export type ImportedProcreatePack = { dir: string; manifest: StampPaintPackManifest; skipped: readonly string[] };

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function sha256OfFile(file: string): string {
  const hash = createHash('sha256'), fd = openSync(file, 'r'), chunk = Buffer.alloc(1 << 22);
  for (let read; (read = readSync(fd, chunk, 0, chunk.length, null)) > 0;) hash.update(chunk.subarray(0, read));
  closeSync(fd);
  return hash.digest('hex');
}

/** A PNG's size, from its IHDR chunk. */
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

function fitWithin(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A brush image as a grey PNG, downsized to fit `max` and negated when asked (to make dark paint). */
function writeBrushImage(png: Buffer, max: number, negate: boolean, out: string) {
  const { width, height } = fitWithin(pngSize(png).width, pngSize(png).height, max);
  withStudioTemp('brush-image', (dir) => {
    writeFileSync(join(dir, 'in.png'), png);
    const filters = [`scale=${width}:${height}:flags=area`, 'format=gray', ...(negate ? ['negate'] : [])].join(',');
    runFfmpeg(['-nostdin', '-v', 'error', '-i', join(dir, 'in.png'), '-vf', filters, '-y', out]);
  });
}

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

/**
 * Writes into a staging folder beside the pack's, and swaps it in only once the manifest is written, so an import that
 * fails leaves the previous one whole. Refuses an archive kept inside the pack's folder, which the swap would delete.
 */
export function importProcreatePack({ archive, stylesDir, style, pack }: ImportProcreatePackOptions): ImportedProcreatePack {
  if (!existsSync(archive)) throw new Error(`brushes import: ${archive} doesn't exist`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pack) || !/^[a-z0-9][a-z0-9-]*$/.test(style)) throw new Error('brushes import: --style and --pack are lowercase names: letters, digits and dashes');
  const dir = join(stylesDir, style, 'brushes', pack), staging = join(stylesDir, style, 'brushes', `.${pack}.importing`);
  if (resolve(archive).startsWith(`${resolve(dir)}${sep}`)) throw new Error(`brushes import: ${archive} is inside ${dir}, which an import replaces; keep the pack elsewhere`);
  rmSync(staging, { recursive: true, force: true });
  try {
    const written = writePackAssets(archive, staging, style, pack);
    rmSync(dir, { recursive: true, force: true });
    renameSync(staging, dir);
    return { dir, ...written };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function writePackAssets(archive: string, dir: string, style: string, pack: string): Omit<ImportedProcreatePack, 'dir'> {
  const outer = archive.endsWith('.brushset') ? undefined : openZipFile(archive);
  const brushsets = outer ? outer.names.filter((name) => name.endsWith('.brushset')) : [archive];
  if (!brushsets.length) throw new Error(`brushes import: ${archive} holds no .brushset`);
  for (const sub of ['tips', 'grains', 'previews', 'papers']) mkdirSync(join(dir, sub), { recursive: true });

  const sources: ProcreatePackSources = {};
  const brushes: Record<string, StampBrush> = {}, support: Record<string, StampBrushSupportNote[]> = {}, previews: Record<string, StampPaintPackPreview> = {};
  const skipped: string[] = [];
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
      if (brushes[name] || support[name]) throw new Error(`brushes import: two brushes are named ${JSON.stringify(name)}, and a pack's manifest keys brushes by name`);
      if (!has(`${folder}/Shape.png`)) {
        support[name] = [{ level: 'unsupported', setting: 'bundledShapePath', detail: `the tip is Procreate's own ${String(settings.bundledShapePath)}, which the pack doesn't hold; not imported` }];
        skipped.push(name);
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
      const normalized = normalizeProcreateBrush(name, main, dual);
      sources[name] = { main: { ...main, settings: jsonSettings(main.settings) }, ...(dual && { dual: { ...dual, settings: jsonSettings(dual.settings) } }) };
      brushes[name] = normalized.brush;
      support[name] = dualShapeMissing
        ? [...normalized.support, { level: 'unsupported', setting: 'Sub01 bundledShapePath', detail: `the dual's tip is Procreate's own ${String(dualSettings?.bundledShapePath)}, which the pack doesn't hold; imported without its dual` }]
        : normalized.support;
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

  const manifest: StampPaintPackManifest = {
    version: STAMP_PAINT_ASSETS_VERSION,
    files: [...files].sort(),
    brushes,
    source: { archive: basename(archive), sha256: sha256OfFile(archive) },
    previews,
    support,
    palettes,
    papers,
  };
  writeFileSync(join(dir, PROCREATE_SOURCES), `${JSON.stringify(sources, null, 1)}\n`);
  writeFileSync(join(dir, STAMP_PAINT_PACK_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, skipped };
}
