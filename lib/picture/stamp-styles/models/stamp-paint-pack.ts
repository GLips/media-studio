// stamp-paint-pack.ts: an imported pack as its manifest holds it, `brushes/<pack>/manifest.json`: each brush's source
// (a Procreate brush's settings, a Photoshop brush's preset) and where its images landed, never the normalized brush.
// A brush is read from its source when a style resolves it (resolveStampPaintPackBrush), by the importer's pure
// normalizers, so a change to a normalizer or its reading reaches every pack without importing it again.
//
// `readStampPaintPack` is the one door a manifest comes in by: it checks the file's shape and version and returns the
// typed pack, and nothing past it casts a manifest.

import { photoshopProbedRanges, photoshopUnprobedFields } from '#lib/picture/photoshop-brushes/models/photoshop-probed-ranges.ts';
import { normalizePhotoshopBrush, type PhotoshopBrushSource } from '#lib/picture/photoshop-brushes/models/photoshop-brush.ts';
import type { PhotoshopDescriptor } from '#lib/picture/photoshop-brushes/models/photoshop-descriptor.ts';
import { readPhotoshopPreset, type PhotoshopPreset } from '#lib/picture/photoshop-brushes/models/photoshop-preset.ts';
import { normalizeProcreateBrush, type ProcreateBrushSource } from '#lib/picture/procreate-brushes/models/procreate-brush.ts';
import type { StampBrush, StampBrushAsset, StampBrushSupportNote } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import type { StampPaintColor } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';

/**
 * The version of the imported assets this studio reads. An import writes it into each pack's manifest; when the
 * manifest's format changes this goes up, and the studio refuses a pack until it's imported again.
 */
export const STAMP_PAINT_ASSETS_VERSION = 5;

/** The file an import writes in each pack's folder, `brushes/<pack>/`, listing what it wrote there. */
export const STAMP_PAINT_PACK_MANIFEST = 'manifest.json';

/**
 * A brush's own preview from its source: the image (relative to the pack's folder), and whether it shows a stroke or,
 * for a brush its source previews that way, one stamp.
 */
export type StampPaintPackPreview = { image: string; shows: 'stroke' | 'stamp' };

/** A paper from the pack: a photograph of it, its tooth as a grain (dark is where pigment settles), its mean colour. */
export type StampPaintPackPaper = { image: string; grain: string; color: StampPaintColor };

/**
 * A Procreate brush's source: its settings and images, and its dual's (its Sub01); `dropped` is what the import itself
 * couldn't carry (a dual whose tip the pack lacks).
 */
export type ProcreatePackBrush = { main: ProcreateBrushSource; dual?: ProcreateBrushSource; dropped?: readonly StampBrushSupportNote[] };

/**
 * A Photoshop brush's source: its preset and images, and the file in the archive it came from, in its group. The
 * manifest stores the .abr's descriptor (`Preset`), which readStampPaintPack reads into the typed preset.
 */
export type PhotoshopPackBrush<Preset = PhotoshopPreset> = PhotoshopBrushSource<Preset> & { file: string; group?: string };

/**
 * `brushes/<pack>/manifest.json`, as the importer writes it. `files` lists every image it wrote (relative to the
 * pack's folder), which the bundle checks; `source` is the archive it came from; `skipped` says why each brush the
 * archive held wasn't imported. Each brush's source is its app's; previews, palettes and papers come only from a
 * Procreate pack.
 */
export type StampPaintPack = {
  version: typeof STAMP_PAINT_ASSETS_VERSION;
  files: readonly string[];
  source: { archive: string; sha256: string };
  skipped: Readonly<Record<string, readonly StampBrushSupportNote[]>>;
  previews: Readonly<Record<string, StampPaintPackPreview>>;
  palettes: Readonly<Record<string, readonly StampPaintColor[]>>;
  papers: Readonly<Record<string, StampPaintPackPaper>>;
} & (
  | { app: 'procreate'; brushes: Readonly<Record<string, ProcreatePackBrush>> }
  | { app: 'photoshop'; brushes: Readonly<Record<string, PhotoshopPackBrush>> }
);

const fail = (problem: string): never => {
  throw new Error(problem);
};
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const record = (value: unknown, at: string) => (isRecord(value) ? value : fail(`${at} isn't an object`));
const text = (value: unknown, at: string) => (typeof value === 'string' ? value : fail(`${at} isn't a string`));
const asset = (value: unknown, at: string): StampBrushAsset => {
  const a = record(value, at);
  return { style: text(a.style, `${at}.style`), pack: text(a.pack, `${at}.pack`), file: text(a.file, `${at}.file`) };
};

function procreateSource(value: unknown, at: string): ProcreateBrushSource {
  const s = record(value, at);
  return { settings: record(s.settings, `${at}.settings`), tip: asset(s.tip, `${at}.tip`), ...(s.grain !== undefined && { grain: asset(s.grain, `${at}.grain`) }) };
}

function photoshopSource(value: unknown, at: string): PhotoshopPackBrush {
  const s = record(value, at);
  record(s.preset, `${at}.preset`);
  asset(s.tip, `${at}.tip`);
  if (s.dualTip !== undefined) asset(s.dualTip, `${at}.dualTip`);
  if (s.pattern !== undefined) asset(record(s.pattern, `${at}.pattern`).image, `${at}.pattern.image`);
  text(s.file, `${at}.file`);
  // What the descriptor lacks, the typed preset reads as Photoshop's default.
  const stored = s as PhotoshopPackBrush<PhotoshopDescriptor>;
  return { ...stored, preset: readPhotoshopPreset(stored.preset) };
}

/**
 * `value`, a pack's manifest as JSON parsed it, checked and typed. Throws naming what's wrong: a manifest from another
 * version of the studio (`imported as version …`), or one whose shape isn't a pack's.
 */
export function readStampPaintPack(value: unknown): StampPaintPack {
  const m = record(value, 'the manifest');
  if (m.version !== STAMP_PAINT_ASSETS_VERSION) throw new Error(`imported as version ${String(m.version)}, and the studio reads version ${STAMP_PAINT_ASSETS_VERSION}`);
  const files = Array.isArray(m.files) ? m.files.map((file, i) => text(file, `files[${i}]`)) : fail('files isn\'t a list');
  const source = record(m.source, 'source');
  const brushes = record(m.brushes, 'brushes');
  const common = {
    version: STAMP_PAINT_ASSETS_VERSION as typeof STAMP_PAINT_ASSETS_VERSION,
    files,
    source: { archive: text(source.archive, 'source.archive'), sha256: text(source.sha256, 'source.sha256') },
    skipped: record(m.skipped, 'skipped') as StampPaintPack['skipped'],
    previews: record(m.previews, 'previews') as StampPaintPack['previews'],
    palettes: record(m.palettes, 'palettes') as StampPaintPack['palettes'],
    papers: record(m.papers, 'papers') as StampPaintPack['papers'],
  };
  if (m.app === 'procreate') {
    return { ...common, app: 'procreate', brushes: Object.fromEntries(Object.entries(brushes).map(([name, b]) => {
      const brush = record(b, `brushes.${name}`);
      return [name, {
        main: procreateSource(brush.main, `brushes.${name}.main`),
        ...(brush.dual !== undefined && { dual: procreateSource(brush.dual, `brushes.${name}.dual`) }),
        ...(brush.dropped !== undefined && { dropped: brush.dropped as StampBrushSupportNote[] }),
      }];
    })) };
  }
  if (m.app === 'photoshop') return { ...common, app: 'photoshop', brushes: Object.fromEntries(Object.entries(brushes).map(([name, b]) => [name, photoshopSource(b, `brushes.${name}`)])) };
  return fail(`app is ${JSON.stringify(m.app)}, neither procreate nor photoshop`);
}

/** `name` read from its source into a StampBrush, and what didn't carry over; nothing when the pack lacks it. */
export function resolveStampPaintPackBrush(pack: StampPaintPack, name: string): { brush: StampBrush; support: StampBrushSupportNote[] } | undefined {
  if (pack.app === 'procreate') {
    const source = pack.brushes[name];
    if (!source) return undefined;
    const read = normalizeProcreateBrush(name, source.main, source.dual);
    return { brush: read.brush, support: [...read.support, ...(source.dropped ?? [])] };
  }
  const source = pack.brushes[name];
  return source && normalizePhotoshopBrush(name, source);
}

/** Every brush of `pack`, read from its source, by name. */
export const resolveStampPaintPackBrushes = (pack: StampPaintPack): Record<string, StampBrush> =>
  Object.fromEntries(Object.keys(pack.brushes).map((name) => [name, resolveStampPaintPackBrush(pack, name)!.brush]));

/**
 * What didn't carry over, brush by brush: the normalizer's notes, a Photoshop brush's settings past what the probes
 * covered, and why each skipped brush wasn't imported.
 */
export function stampPaintPackSupport(pack: StampPaintPack): Record<string, StampBrushSupportNote[]> {
  const probed = pack.app === 'photoshop' ? photoshopProbedRanges() : undefined;
  const read = Object.fromEntries(Object.keys(pack.brushes).map((name) => {
    const notes = resolveStampPaintPackBrush(pack, name)!.support;
    if (pack.app !== 'photoshop') return [name, notes];
    const unprobed = photoshopUnprobedFields(pack.brushes[name].preset, probed!).map(({ path, value, probed: range }): StampBrushSupportNote => ({ level: 'unprobed', setting: path, detail: `${value}, where the probes gave ${range}` }));
    return [name, [...notes, ...unprobed]];
  }));
  return { ...read, ...Object.fromEntries(Object.entries(pack.skipped).map(([name, notes]) => [name, [...notes]])) };
}

/**
 * The diameter, in pixels, a brush's source presets it at; none for a source whose brushes have no size of their own
 * (Procreate's are sized by the canvas). The sheet paints a brush without a preview or reference at it.
 */
export function stampPaintPackDiameter(pack: StampPaintPack, name: string): number | undefined {
  return pack.app === 'photoshop' && pack.brushes[name] ? pack.brushes[name].preset.tip.diameter : undefined;
}
