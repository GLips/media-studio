// stamp-paint-pack.ts: an imported pack as its manifest holds it, `brushes/<pack>/manifest.json`: each brush's source
// (a Procreate brush's settings, a Photoshop brush's preset) and where its images landed, never the normalized brush.
// A brush is read from its source when a style resolves it (resolveStampPaintPackBrush), by the importer's pure
// normalizers, so a change to a normalizer or its reading reaches every pack without importing it again.
//
// `readStampPaintPack` is the one door a manifest comes in by: it parses the file whole, field by field, and returns
// the typed pack, and nothing past it casts a manifest.

import { photoshopProbedRanges, photoshopUnprobedFields } from '#lib/picture/photoshop-brushes/models/photoshop-probed-ranges.ts';
import {
  normalizePhotoshopBrush, photoshopTipAssetKind, type PhotoshopBrushSource, type PhotoshopTipAsset,
} from '#lib/picture/photoshop-brushes/models/photoshop-brush.ts';
import { parsePhotoshopDescriptor } from '#lib/picture/photoshop-brushes/models/photoshop-descriptor.ts';
import { photoshopPaintablePreset, readPhotoshopPreset, type PhotoshopPresetTip } from '#lib/picture/photoshop-brushes/models/photoshop-preset.ts';
import { normalizeProcreateBrush, type ProcreateBrushSource } from '#lib/picture/procreate-brushes/models/procreate-brush.ts';
import type { StampBrush, StampBrushAsset, StampBrushSupportNote } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import type { StampPaintColor } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';

/**
 * The version of the imported assets this studio reads. An import writes it into each pack's manifest; when the
 * manifest's format changes this goes up, and the studio refuses a pack until it's imported again.
 */
export const STAMP_PAINT_ASSETS_VERSION = 6;

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
export type PhotoshopPackBrush<Preset = PhotoshopBrushSource['preset']> = PhotoshopBrushSource<Preset> & { file: string; group?: string };

/**
 * `brushes/<pack>/manifest.json`, as the importer writes it. `files` lists every file it wrote (relative to the
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

// -- Parsing: each reader takes JSON as parsed and the path it sits at, and throws naming the first thing that's wrong --

const fail = (problem: string): never => {
  throw new Error(problem);
};
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const record = (value: unknown, at: string) => (isRecord(value) ? value : fail(`${at} isn't an object`));
const text = (value: unknown, at: string) => (typeof value === 'string' ? value : fail(`${at} isn't a string`));
const count = (value: unknown, at: string) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fail(`${at} isn't a whole number above 0`));
const list = <T>(value: unknown, at: string, item: (v: unknown, at: string) => T): T[] =>
  Array.isArray(value) ? value.map((v, i) => item(v, `${at}[${i}]`)) : fail(`${at} isn't a list`);
const entries = <T>(value: unknown, at: string, item: (v: unknown, at: string) => T): Record<string, T> =>
  Object.fromEntries(Object.entries(record(value, at)).map(([name, v]) => [name, item(v, `${at}.${name}`)]));
const oneOf = <const T extends string>(value: unknown, at: string, options: readonly T[]): T =>
  options.find((option) => option === value) ?? fail(`${at} is ${JSON.stringify(value)}, not one of ${options.join(', ')}`);

const isColor = (value: string): value is StampPaintColor => /^#[0-9a-f]{6}$/i.test(value);
const color = (value: unknown, at: string): StampPaintColor => {
  const hex = text(value, at);
  return isColor(hex) ? hex : fail(`${at} isn't a #rrggbb colour`);
};
const asset = (value: unknown, at: string): StampBrushAsset => {
  const a = record(value, at);
  return { style: text(a.style, `${at}.style`), pack: text(a.pack, `${at}.pack`), file: text(a.file, `${at}.file`) };
};
const note = (value: unknown, at: string): StampBrushSupportNote => {
  const n = record(value, at);
  return { level: oneOf(n.level, `${at}.level`, ['approximated', 'unsupported', 'inapplicable', 'unprobed']), setting: text(n.setting, `${at}.setting`), detail: text(n.detail, `${at}.detail`) };
};
const notes = (value: unknown, at: string) => list(value, at, note);
const preview = (value: unknown, at: string): StampPaintPackPreview => {
  const p = record(value, at);
  return { image: text(p.image, `${at}.image`), shows: oneOf(p.shows, `${at}.shows`, ['stroke', 'stamp']) };
};
const paper = (value: unknown, at: string): StampPaintPackPaper => {
  const p = record(value, at);
  return { image: text(p.image, `${at}.image`), grain: text(p.grain, `${at}.grain`), color: color(p.color, `${at}.color`) };
};

function procreateSource(value: unknown, at: string): ProcreateBrushSource {
  const s = record(value, at);
  return { settings: record(s.settings, `${at}.settings`), tip: asset(s.tip, `${at}.tip`), ...(s.grain !== undefined && { grain: asset(s.grain, `${at}.grain`) }) };
}

function procreateBrush(value: unknown, at: string): ProcreatePackBrush {
  const b = record(value, at);
  return {
    main: procreateSource(b.main, `${at}.main`),
    ...(b.dual !== undefined && { dual: procreateSource(b.dual, `${at}.dual`) }),
    ...(b.dropped !== undefined && { dropped: notes(b.dropped, `${at}.dropped`) }),
  };
}

/** A tip's asset, which must be the kind its preset tip lands as (photoshopTipAssetKind). */
function tipAsset(value: unknown, at: string, tip: PhotoshopPresetTip): PhotoshopTipAsset {
  const a = record(value, at), image = asset(a.image, `${at}.image`);
  const kind = oneOf(a.kind, `${at}.kind`, tip.kind === 'unsupported' ? [] : [photoshopTipAssetKind(tip)]);
  if (kind === 'round') return { kind, image };
  if (kind === 'erodible') return { kind, image, heightMap: asset(a.heightMap, `${at}.heightMap`) };
  const sample = record(a.sample, `${at}.sample`);
  return { kind, image, sample: { width: count(sample.width, `${at}.sample.width`), height: count(sample.height, `${at}.sample.height`) } };
}

function photoshopBrush(value: unknown, at: string): PhotoshopPackBrush {
  const s = record(value, at);
  // What the descriptor lacks, the typed preset reads as Photoshop's default.
  const read = readPhotoshopPreset(parsePhotoshopDescriptor(s.preset, `${at}.preset`));
  const preset = photoshopPaintablePreset(read) ?? fail(`${at}.preset's tip is a ${read.tip.kind === 'unsupported' ? read.tip.classId : read.tip.kind}, which the importer skips`);
  const pattern = s.pattern === undefined ? undefined : record(s.pattern, `${at}.pattern`);
  const dualTip = read.dual?.tip;
  if (s.dualTip !== undefined && !dualTip) fail(`${at}.dualTip belongs to no dual`);
  return {
    preset,
    tip: tipAsset(s.tip, `${at}.tip`, preset.tip),
    ...(s.dualTip !== undefined && dualTip && { dualTip: tipAsset(s.dualTip, `${at}.dualTip`, dualTip) }),
    ...(pattern && { pattern: { image: asset(pattern.image, `${at}.pattern.image`), width: count(pattern.width, `${at}.pattern.width`) } }),
    file: text(s.file, `${at}.file`),
    ...(s.group !== undefined && { group: text(s.group, `${at}.group`) }),
  };
}

/**
 * `value`, a pack's manifest as JSON parsed it, checked and typed. Throws naming what's wrong: a manifest from another
 * version of the studio (`imported as version …`), or one whose shape isn't a pack's.
 */
export function readStampPaintPack(value: unknown): StampPaintPack {
  const m = record(value, 'the manifest');
  if (m.version !== STAMP_PAINT_ASSETS_VERSION) throw new Error(`imported as version ${String(m.version)}, and the studio reads version ${STAMP_PAINT_ASSETS_VERSION}`);
  const source = record(m.source, 'source');
  const common = {
    version: STAMP_PAINT_ASSETS_VERSION,
    files: list(m.files, 'files', text),
    source: { archive: text(source.archive, 'source.archive'), sha256: text(source.sha256, 'source.sha256') },
    skipped: entries(m.skipped, 'skipped', notes),
    previews: entries(m.previews, 'previews', preview),
    palettes: entries(m.palettes, 'palettes', (colors, at) => list(colors, at, color)),
    papers: entries(m.papers, 'papers', paper),
  } as const;
  const app = oneOf(m.app, 'app', ['procreate', 'photoshop']);
  if (app === 'procreate') return { ...common, app, brushes: entries(m.brushes, 'brushes', procreateBrush) };
  return { ...common, app, brushes: entries(m.brushes, 'brushes', photoshopBrush) };
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

/** Every brush of `pack` read from its source, by name, with what didn't carry over. */
function resolveEveryStampPaintPackBrush(pack: StampPaintPack): [string, { brush: StampBrush; support: StampBrushSupportNote[] }][] {
  if (pack.app === 'procreate') {
    return Object.entries(pack.brushes).map(([name, source]) => {
      const read = normalizeProcreateBrush(name, source.main, source.dual);
      return [name, { brush: read.brush, support: [...read.support, ...(source.dropped ?? [])] }];
    });
  }
  const probed = photoshopProbedRanges();
  return Object.entries(pack.brushes).map(([name, source]) => {
    const read = normalizePhotoshopBrush(name, source);
    const unprobed = photoshopUnprobedFields(source.preset, probed).map(({ path, value, probed: range }): StampBrushSupportNote => ({ level: 'unprobed', setting: path, detail: `${value}, where the probes gave ${range}` }));
    return [name, { brush: read.brush, support: [...read.support, ...unprobed] }];
  });
}

/** Every brush of `pack`, read from its source, by name. */
export const resolveStampPaintPackBrushes = (pack: StampPaintPack): Record<string, StampBrush> =>
  Object.fromEntries(resolveEveryStampPaintPackBrush(pack).map(([name, { brush }]) => [name, brush]));

/**
 * What didn't carry over, brush by brush: the normalizer's notes, a Photoshop brush's settings past what the probes
 * covered, and why each skipped brush wasn't imported.
 */
export function stampPaintPackSupport(pack: StampPaintPack): Record<string, StampBrushSupportNote[]> {
  const read = Object.fromEntries(resolveEveryStampPaintPackBrush(pack).map(([name, { support }]) => [name, support]));
  return { ...read, ...Object.fromEntries(Object.entries(pack.skipped).map(([name, skipNotes]) => [name, [...skipNotes]])) };
}

/**
 * The diameter, in pixels, a brush's source presets it at; none for a source whose brushes have no size of their own
 * (Procreate's are sized by the canvas). The sheet paints a brush without a preview or reference at it.
 */
export function stampPaintPackDiameter(pack: StampPaintPack, name: string): number | undefined {
  return pack.app === 'photoshop' && pack.brushes[name] ? pack.brushes[name].preset.tip.geometry.diameter : undefined;
}
