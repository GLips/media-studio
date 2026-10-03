// import-stamp-paint-pack.ts: `studio brushes import`, whichever app the pack is for. A .brushset (or a zip holding
// one) is Procreate's (import-procreate-pack.ts); an .abr or .tpl (or a zip holding them and no .brushset) is
// Photoshop's (import-photoshop-pack.ts). Both write the same pack layout, its manifest saying which app it is.
//
// Every import measures its brushes' profiles (measure-stamp-brush-profiles.ts) before it publishes. Imported again
// without an archive, a pack is republished from its own manifest and images, its profiles measured anew where
// what they depend on has changed.

import { linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isPhotoshopBrushFile, writePhotoshopPackAssets } from './import-photoshop-pack.ts';
import { writeProcreatePackAssets } from './import-procreate-pack.ts';
import {
  measureStampBrushProfiles, stampBrushProfileKey, stampPackProbeMediumKey, type MeasureStampBrushProfiles, type MeasureStampBrushProfilesRequest,
} from './measure-stamp-brush-profiles.ts';
import {
  checkStampPaintPackArchive, readImportedStampPaintPack, readStampPaintPackGeneration, replaceStampPaintPack, stampPaintPackDir,
  type ImportStampPaintPackOptions, type StampPaintPackPlace,
} from './stamp-paint-pack-files.ts';
import {
  readStampPaintPack, readStampPaintPackBrushSource, STAMP_PAINT_PACK_MANIFEST, storedStampPaintPackProfile, type StampPaintPack, type StampPaintPackProfile,
  type StoredStampPaintPack,
} from '../models/stamp-paint-pack.ts';
import type { StampBrushProfileKey } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampBrushProbeMedium } from '../models/stamp-brush-profile-probes.ts';
import { openZipFile } from '#lib/platform/zip/engine/zip-archive.ts';

function sourceAppOf(archive: string): 'procreate' | 'photoshop' {
  if (archive.endsWith('.brushset')) return 'procreate';
  if (isPhotoshopBrushFile(archive)) return 'photoshop';
  const zip = openZipFile(archive);
  try {
    if (zip.names.some((name) => name.endsWith('.brushset'))) return 'procreate';
    if (zip.names.some(isPhotoshopBrushFile)) return 'photoshop';
  } finally {
    zip.close();
  }
  throw new Error(`brushes import: ${archive} holds neither a Procreate .brushset nor a Photoshop .abr or .tpl`);
}

/**
 * How an import measures profiles: in its style's `medium`, by `measure` (the browser's unless a test stands in),
 * hearing of each brush as it's done.
 */
export type StampPaintPackMeasuring = { medium: StampBrushProbeMedium; measure?: MeasureStampBrushProfiles; onBrush?: MeasureStampBrushProfilesRequest['onBrush'] };

export type ImportedStampPaintPack = { dir: string; manifest: StampPaintPack };

/** `kept` where its key is `key` still, so measuring again would read the same; else null. */
function keptStampProfile(kept: StampPaintPackProfile | undefined, key: StampBrushProfileKey): (StampPaintPackProfile & { key: StampBrushProfileKey }) | null {
  const was = kept?.key;
  return kept && was && was.protocol === key.protocol && was.settings === key.settings && was.assets === key.assets && was.medium === key.medium ? { ...kept, key: was } : null;
}

/**
 * `stored` with each brush's profile, kept from `previous` where its key still matches and measured otherwise, its
 * manifest written into `generation`.
 */
async function publishStampPaintPack(
  { stylesDir, style, pack }: StampPaintPackPlace, generation: string, stored: StoredStampPaintPack, previous: StampPaintPack['profiles'],
  { medium, measure = measureStampBrushProfiles, onBrush }: StampPaintPackMeasuring,
) {
  const unmeasured = readStampPaintPack({ ...stored, profiles: {} }), mediumKey = stampPackProbeMediumKey({ stylesDir, style, pack }, stored.source.sha256, medium);
  const brushes = Object.keys(unmeasured.brushes).map((name) => {
    const { brush } = readStampPaintPackBrushSource(unmeasured, name)!, key = stampBrushProfileKey(brush, generation, mediumKey);
    return { name, brush, key, kept: keptStampProfile(previous[name], key) };
  });
  const wanted = brushes.filter(({ kept }) => !kept);
  for (const { name, kept } of brushes) if (kept) onBrush?.(name, 'kept');
  const measured = wanted.length ? await measure({ stylesDir, style, pack, generation, medium, brushes: wanted, onBrush }) : {};
  const profiles = Object.fromEntries(brushes.map(({ name, key, kept }) => [name, storedStampPaintPackProfile(kept ?? { key, ...measured[name] })]));
  const manifest = { ...stored, profiles };
  writeFileSync(join(generation, STAMP_PAINT_PACK_MANIFEST), `${JSON.stringify(manifest, null, 1)}\n`);
  return { manifest: readStampPaintPack(manifest) };
}

/** The profiles of the pack now at `place`, which an import keeps where their keys still match; none before its first. */
const previousProfiles = (place: StampPaintPackPlace) => readImportedStampPaintPack(stampPaintPackDir(place))?.manifest.profiles ?? {};

/** Imports `archive` as its app's pack, its profiles measured, replacing what an import writes only once it has succeeded. */
export async function importStampPaintPack(options: ImportStampPaintPackOptions, measuring: StampPaintPackMeasuring): Promise<ImportedStampPaintPack> {
  checkStampPaintPackArchive(options);
  const app = sourceAppOf(options.archive), previous = previousProfiles(options);
  return replaceStampPaintPack(options, (generation) => publishStampPaintPack(options, generation, app === 'procreate' ? writeProcreatePackAssets(options, generation) : writePhotoshopPackAssets(options, generation), previous, measuring));
}

/**
 * Republishes the pack at `place` from its own manifest and images (linked, so unchanged), its profiles measured where
 * their keys have changed: `studio brushes import` without an archive.
 */
export async function reimportStampPaintPack(place: StampPaintPackPlace, measuring: StampPaintPackMeasuring): Promise<ImportedStampPaintPack> {
  const current = readStampPaintPackGeneration(stampPaintPackDir(place));
  // SAFETY: readStampPaintPackGeneration has just read this very file whole through readStampPaintPack.
  const stored = JSON.parse(readFileSync(join(current.dir, STAMP_PAINT_PACK_MANIFEST), 'utf8')) as StoredStampPaintPack;
  return replaceStampPaintPack(place, (generation) => {
    for (const file of current.manifest.files) {
      mkdirSync(dirname(join(generation, file)), { recursive: true });
      linkSync(join(current.dir, file), join(generation, file));
    }
    return publishStampPaintPack(place, generation, stored, current.manifest.profiles, measuring);
  });
}
