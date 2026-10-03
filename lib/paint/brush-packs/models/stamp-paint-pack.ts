// stamp-paint-pack.ts: an imported pack as its manifest holds it, `brushes/<pack>/manifest.json`: each brush's source
// (a Procreate brush's settings, a Photoshop brush's preset) and where its images landed, never the normalized brush.
// A brush is read from its source when a style resolves it (resolveStampPaintPackBrush), by the importer's pure
// normalizers, so a change to a normalizer or its reading reaches every pack without importing it again.
//
// `readStampPaintPack` is the one door a manifest comes in by: it parses the file whole, field by field, and returns
// the typed pack, and nothing past it casts a manifest.

import { photoshopProbedRanges, photoshopUnprobedFields } from '#lib/paint/photoshop-brushes/models/photoshop-probed-ranges.ts';
import {
  normalizePhotoshopBrush, photoshopTipAssetKind, type PhotoshopBrushSource, type PhotoshopTipAsset,
} from '#lib/paint/photoshop-brushes/models/photoshop-brush.ts';
import { parsePhotoshopDescriptor, type PhotoshopDescriptor } from '#lib/paint/photoshop-brushes/models/photoshop-descriptor.ts';
import { photoshopPaintablePreset, readPhotoshopPreset, type PhotoshopPresetTip } from '#lib/paint/photoshop-brushes/models/photoshop-preset.ts';
import { normalizeProcreateBrush, type ProcreateBrushSource } from '#lib/paint/procreate-brushes/models/procreate-brush.ts';
import type {
  StampBrush, StampBrushAsset, StampBrushEdgeSample, StampBrushMeasuredProfile, StampBrushProfile, StampBrushProfileKey, StampBrushProfileProvenance,
  StampBrushProfileSample, StampBrushSupportNote, StampTipSupport,
} from '#lib/paint/brush/models/stamp-brush.ts';
import {
  STAMP_BRUSH_PROFILE_HEADINGS, STAMP_BRUSH_PROFILE_PROTOCOL, stampBrushEvenEdge, stampBrushProfileSettingsHash,
} from '#lib/paint/brush/models/stamp-brush-profile.ts';
import type { StampPaintColor } from '#lib/paint/materials/models/paint-material.ts';

/** Longest side of each stored image, in pixels: tips stamp at a few hundred, grains tile, papers span a frame. */
export const STAMP_PACK_TIP_MAX = 512, STAMP_PACK_GRAIN_MAX = 1024, STAMP_PACK_PAPER_MAX = 2560;

/**
 * The version of the imported assets this studio reads. An import writes it into each pack's manifest; when the
 * manifest's format changes this goes up, and the studio refuses a pack until it's imported again.
 */
export const STAMP_PAINT_ASSETS_VERSION = 8;

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
 * A brush's profile as its import measured it, or why it couldn't be measured, kept with what it was measured from so
 * the next import measures only what changed. One of another protocol is refused with no key, as its key's fields may
 * differ: the next import measures it.
 */
export type StampPaintPackProfile = StampBrushMeasuredProfile | { kind: 'refused'; key: StampBrushProfileKey | null; why: string };

/**
 * A profile as the manifest stores it: a sample's edge as one offset where every heading and side reads alike, and
 * so does every refusal it keeps.
 */
export type StoredStampPaintPackProfile = { key: StampBrushProfileKey } & (
  | { kind: 'measured'; provenance: StampBrushProfileProvenance; samples: readonly (Omit<StampBrushProfileSample, 'edge'> & { edge: number | StampBrushEdgeSample })[] }
  | { kind: 'refused'; why: string }
);

/**
 * `brushes/<pack>/manifest.json`, as the importer writes it. `files` lists every file it wrote (relative to the
 * pack's folder), which the bundle checks; `skipped` says why each archive brush wasn't imported. Previews, palettes
 * and papers come only from a Procreate pack. `profiles` is empty in a pack no import has measured.
 */
export type StampPaintPack = {
  version: typeof STAMP_PAINT_ASSETS_VERSION;
  files: readonly string[];
  source: { archive: string; sha256: string };
  skipped: Readonly<Record<string, readonly StampBrushSupportNote[]>>;
  previews: Readonly<Record<string, StampPaintPackPreview>>;
  palettes: Readonly<Record<string, readonly StampPaintColor[]>>;
  papers: Readonly<Record<string, StampPaintPackPaper>>;
  profiles: Readonly<Record<string, StampPaintPackProfile>>;
} & (
  | { app: 'procreate'; brushes: Readonly<Record<string, ProcreatePackBrush>> }
  | { app: 'photoshop'; brushes: Readonly<Record<string, PhotoshopPackBrush>> }
);

/**
 * A manifest as its file holds it, which readStampPaintPack reads: a Photoshop brush's preset as the .abr's
 * descriptor. An importer writes its assets' part, and the profiles are measured from that.
 */
export type StoredStampPaintPack = Omit<StampPaintPack, 'app' | 'brushes' | 'profiles'> & { profiles?: Readonly<Record<string, StoredStampPaintPackProfile>> } & (
  | { app: 'procreate'; brushes: Readonly<Record<string, ProcreatePackBrush>> }
  | { app: 'photoshop'; brushes: Readonly<Record<string, PhotoshopPackBrush<PhotoshopDescriptor>>> }
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

// The profile's readers take the object a field sits in, keyed by the fields they read, so only the shared readers
// above take a bare value.
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const finiteAt = <F extends string>(r: Readonly<Partial<Record<F, unknown>>>, field: F, at: string) => {
  const value = r[field];
  return isFiniteNumber(value) ? value : fail(`${at}.${field} isn't a number`);
};
const finitesAt = <F extends string>(r: Readonly<Partial<Record<F, unknown>>>, field: F, at: string) => list(r[field], `${at}.${field}`, (v, where) => (isFiniteNumber(v) ? v : fail(`${where} isn't a number`)));
const headingsAt = <F extends string>(r: Readonly<Partial<Record<F, unknown>>>, field: F, at: string) => {
  const read = finitesAt(r, field, at);
  return read.length === STAMP_BRUSH_PROFILE_HEADINGS ? read : fail(`${at}.${field} holds ${read.length} headings, not ${STAMP_BRUSH_PROFILE_HEADINGS}`);
};
/** An edge as a profile reads it, each side by heading, from the one offset a manifest keeps where they're alike. */
const edgeAt = <F extends string>(r: Readonly<Partial<Record<F, unknown>>>, field: F, at: string): StampBrushEdgeSample => {
  const value = r[field];
  if (isFiniteNumber(value)) return stampBrushEvenEdge(value);
  const e = record(value, `${at}.${field}`);
  return { left: headingsAt(e, 'left', `${at}.${field}`), right: headingsAt(e, 'right', `${at}.${field}`) };
};
const tipSupportAt = <F extends string>(r: Readonly<Partial<Record<F, unknown>>>, field: F, at: string): StampTipSupport => {
  const t = record(r[field], `${at}.${field}`), where = `${at}.${field}`, reach = finitesAt(t, 'reach', where);
  if (!reach.length) fail(`${where}.reach holds no levels`);
  return { width: finiteAt(t, 'width', where), height: finiteAt(t, 'height', where), span: finiteAt(t, 'span', where), roundness: finiteAt(t, 'roundness', where), reach };
};
const profileSample = (s: Readonly<Partial<Record<'diameter' | 'edge' | 'edgeNoise' | 'support', unknown>>>, at: string): StampBrushProfileSample => {
  const support = record(s.support, `${at}.support`);
  return {
    diameter: finiteAt(s, 'diameter', at), edge: edgeAt(s, 'edge', at), edgeNoise: finiteAt(s, 'edgeNoise', at),
    support: { main: tipSupportAt(support, 'main', `${at}.support`), dual: support.dual === null ? null : tipSupportAt(support, 'dual', `${at}.support`) },
  };
};
/** A stored profile, typed; one of another protocol refused by its key alone, as the rest may hold other fields. */
function packProfile(p: Readonly<Partial<Record<'key' | 'kind' | 'why' | 'provenance' | 'samples', unknown>>>, at: string): StampPaintPackProfile {
  const k = record(p.key, `${at}.key`), protocol = count(k.protocol, `${at}.key.protocol`);
  if (protocol !== STAMP_BRUSH_PROFILE_PROTOCOL) return { kind: 'refused', key: null, why: `it was measured by protocol ${protocol}, and the studio reads ${STAMP_BRUSH_PROFILE_PROTOCOL}; import its pack again` };
  const key = { protocol, settings: text(k.settings, `${at}.key.settings`), assets: text(k.assets, `${at}.key.assets`), medium: text(k.medium, `${at}.key.medium`) };
  const kind = oneOf(p.kind, `${at}.kind`, ['measured', 'refused']);
  if (kind === 'refused') return { kind, key, why: text(p.why, `${at}.why`) };
  const v = record(p.provenance, `${at}.provenance`);
  const provenance = {
    adapter: text(v.adapter, `${at}.provenance.adapter`), browser: text(v.browser, `${at}.provenance.browser`), renderer: text(v.renderer, `${at}.provenance.renderer`),
    seeds: list(v.seeds, `${at}.provenance.seeds`, text), measuredAt: text(v.measuredAt, `${at}.provenance.measuredAt`),
  };
  const samples = list(p.samples, `${at}.samples`, (sample, where) => profileSample(record(sample, where), where));
  if (!samples.length || samples.some((sample, i) => i > 0 && sample.diameter <= samples[i - 1].diameter)) fail(`${at}.samples aren't diameters rising from at least one`);
  return { kind, key, provenance, samples };
}

/** `edge` as the manifest stores it: one offset where every heading and side reads alike. */
const storedEdge = ({ left, right }: StampBrushEdgeSample) => ([...left, ...right].every((v) => v === left[0]) ? left[0] : { left, right });

/** `profile` as the manifest stores it (StoredStampPaintPackProfile), from a key that's current. */
export function storedStampPaintPackProfile(profile: StampPaintPackProfile & { key: StampBrushProfileKey }): StoredStampPaintPackProfile {
  if (profile.kind === 'refused') return profile;
  return { ...profile, samples: profile.samples.map((sample) => Object.assign({}, sample, { edge: storedEdge(sample.edge) })) };
}

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

/** A tip's asset, which must be the kind its preset tip lands as (photoshopTipAssetKind). A bristle tip has no image. */
function tipAsset(value: unknown, at: string, tip: PhotoshopPresetTip): PhotoshopTipAsset {
  const a = record(value, at);
  const kind = oneOf(a.kind, `${at}.kind`, tip.kind === 'unsupported' ? [] : [photoshopTipAssetKind(tip)]);
  if (kind === 'bristle') return { kind };
  const image = asset(a.image, `${at}.image`);
  if (kind === 'round') return { kind, image };
  if (kind === 'erodible') return { kind, image, contact: asset(a.contact, `${at}.contact`), heightMap: asset(a.heightMap, `${at}.heightMap`) };
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
    // A pack no import has measured holds none, and a consumer of a brush's profile refuses it.
    profiles: m.profiles === undefined ? {} : entries(m.profiles, 'profiles', (v, at) => packProfile(record(v, at), at)),
  } as const;
  const app = oneOf(m.app, 'app', ['procreate', 'photoshop']);
  if (app === 'procreate') return { ...common, app, brushes: entries(m.brushes, 'brushes', procreateBrush) };
  return { ...common, app, brushes: entries(m.brushes, 'brushes', photoshopBrush) };
}

/**
 * `brush`'s profile as its pack measured it, checked once, here: current for its settings as its source now reads, for
 * `medium` (the key of the medium its style probes in, stampBrushProbeMediumKey) and for its dual; else refused, why.
 */
function stampPackBrushProfile(pack: StampPaintPack, brush: StampBrush, medium: string): StampBrushProfile {
  const stored = pack.profiles[brush.name];
  if (!stored) return { kind: 'refused', why: "its pack's import measured no profile for it; import its pack again" };
  if (stored.kind === 'refused') return { kind: 'refused', why: stored.why };
  if (stored.key.settings !== stampBrushProfileSettingsHash(brush)) return { kind: 'refused', why: 'it was measured from other settings than its source now reads as; import its pack again' };
  if (stored.key.medium !== medium) return { kind: 'refused', why: "it was measured on other paper or paint than its style's now; import its pack again" };
  if (stored.samples.some(({ support }) => !support.dual !== !brush.dual)) return { kind: 'refused', why: "its profile's support doesn't match whether it has a dual; import its pack again" };
  return stored;
}

/**
 * `name` read from its source into a StampBrush, its profile with it as its pack measured it in `medium`'s key
 * (stampPackBrushProfile), and what didn't carry over; nothing when the pack lacks it.
 */
export function resolveStampPaintPackBrush(pack: StampPaintPack, name: string, medium: string): { brush: StampBrush; support: StampBrushSupportNote[] } | undefined {
  const read = readStampPaintPackBrushSource(pack, name);
  return read && { ...read, brush: { ...read.brush, profile: stampPackBrushProfile(pack, read.brush, medium) } };
}

/** `name` read from its source alone, as its profile is measured from; nothing when the pack lacks it. */
export function readStampPaintPackBrushSource(pack: StampPaintPack, name: string): { brush: StampBrush; support: StampBrushSupportNote[] } | undefined {
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

/** Each pack's archive sha256 by its folder: what fixes its images' bytes (stampBrushProbeMediumKey). */
export const stampPaintPackArchives = (packs: Readonly<Record<string, StampPaintPack>>): Record<string, string> =>
  Object.fromEntries(Object.entries(packs).map(([pack, { source }]) => [pack, source.sha256]));

/** Every brush of `pack` read from its source alone, by name, unmeasured: for a reader of its settings, not its profile. */
export const readStampPaintPackBrushSources = (pack: StampPaintPack): Record<string, StampBrush> =>
  Object.fromEntries(resolveEveryStampPaintPackBrush(pack).map(([name, { brush }]) => [name, brush]));

/** Every brush of `pack`, read from its source, by name, each with its profile as resolveStampPaintPackBrush gives it. */
export const resolveStampPaintPackBrushes = (pack: StampPaintPack, medium: string): Record<string, StampBrush> =>
  Object.fromEntries(resolveEveryStampPaintPackBrush(pack).map(([name, { brush }]) => [name, { ...brush, profile: stampPackBrushProfile(pack, brush, medium) }]));

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
