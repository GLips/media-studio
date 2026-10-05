// import-stamp-paint-pack.ts: `studio brushes import`, whichever app the pack is for. A .brushset (or a zip holding
// one) is Procreate's (import-procreate-pack.ts); an .abr or .tpl (or a zip holding them and no .brushset) is
// Photoshop's (import-photoshop-pack.ts). Both write the same pack layout, its manifest saying which app it is.
//
// Every import measures each brush whose key has no profile stored (stamp-brush-profile-store.ts), storing each as
// it's measured, before it publishes. Without an archive, it only measures, into the pack as it's published now:
// it never writes a generation or a manifest, so what's measured is all it adds.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPhotoshopBrushFile, writePhotoshopPackAssets } from './import-photoshop-pack.ts';
import { writeProcreatePackAssets } from './import-procreate-pack.ts';
import { measureStampBrushProfiles, type MeasureStampBrushProfiles } from './measure-stamp-brush-profiles.ts';
import { readStampBrushProfileFile, stampPackBrushesKeyed, stampPackProbeMediumKey, writeStampBrushProfile, type StampPaintPackGeneration } from './stamp-brush-profile-store.ts';
import {
  checkStampPaintPackArchive, readStampPaintPackGeneration, replaceStampPaintPack, stampPaintPackDir, withStampPackLock,
  type ImportStampPaintPackOptions, type StampPaintPackPlace,
} from './stamp-paint-pack-files.ts';
import { readStampPaintPack, STAMP_PAINT_PACK_MANIFEST, type StampPaintPack, type StampPaintPackProfile } from '../models/stamp-paint-pack.ts';
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
 * How each brush's profile came to be: measured now, found stored at its key, or refused; or that its measuring
 * failed and starts again in a fresh browser, heard before its outcome.
 */
export type StampBrushProfileOutcome = 'measured' | 'kept' | 'refused' | 'retrying';

/**
 * How an import measures profiles: in its style's `medium`, by `measure` (the browser's unless a test stands in),
 * hearing of each brush as it's done.
 */
export type StampPaintPackMeasuring = {
  medium: StampBrushProbeMedium;
  measure?: MeasureStampBrushProfiles;
  onBrush?: (name: string, outcome: StampBrushProfileOutcome, why?: string) => void;
};

/** A pack as an import leaves it: its folder, its manifest, and every brush's profile at its key now, by name. */
export type ImportedStampPaintPack = { dir: string; manifest: StampPaintPack; profiles: Record<string, StampPaintPackProfile> };

/**
 * Every brush of `generation`, of the pack at `place`, with its profile at its key now: found stored, or measured and
 * stored as it's heard. Run under the pack's lock, so what's missing is read once another import into the pack has
 * stored what it measured.
 */
async function measureUnstoredStampProfiles(
  place: StampPaintPackPlace, generation: StampPaintPackGeneration, { medium, measure = measureStampBrushProfiles, onBrush }: StampPaintPackMeasuring,
): Promise<Record<string, StampPaintPackProfile>> {
  const packDir = stampPaintPackDir(place), mediumKey = stampPackProbeMediumKey(place, generation.manifest.source.sha256, medium);
  const brushes = stampPackBrushesKeyed(packDir, generation, mediumKey, Object.keys(generation.manifest.brushes));
  const profiles = new Map<string, StampPaintPackProfile>();
  for (const { name, key, file } of brushes) {
    const stored = readStampBrushProfileFile(file, name, key);
    if (!stored) continue;
    profiles.set(name, stored);
    onBrush?.(name, 'kept');
  }
  const wanted = brushes.filter(({ name }) => !profiles.has(name)), keys = new Map(wanted.map(({ name, key }) => [name, key]));
  if (wanted.length) {
    await measure({
      ...place, generation: generation.dir, medium, brushes: wanted,
      onMeasured: (name, measurement) => {
        const profile: StampPaintPackProfile = { ...measurement, key: keys.get(name)! };
        writeStampBrushProfile(packDir, name, profile);
        profiles.set(name, profile);
        onBrush?.(name, measurement.kind);
      },
      onRetrying: (name, why) => onBrush?.(name, 'retrying', why),
    });
  }
  return Object.fromEntries(brushes.map(({ name }) => [name, profiles.get(name)!]));
}

/** Imports `archive` as its app's pack, its unstored profiles measured, replacing what an import writes only once it has succeeded. */
export async function importStampPaintPack(options: ImportStampPaintPackOptions, measuring: StampPaintPackMeasuring): Promise<ImportedStampPaintPack> {
  checkStampPaintPackArchive(options);
  const app = sourceAppOf(options.archive);
  return replaceStampPaintPack(options, async (dir) => {
    const stored = app === 'procreate' ? writeProcreatePackAssets(options, dir) : writePhotoshopPackAssets(options, dir);
    writeFileSync(join(dir, STAMP_PAINT_PACK_MANIFEST), `${JSON.stringify(stored, null, 1)}\n`);
    const manifest = readStampPaintPack(stored);
    return { manifest, profiles: await measureUnstoredStampProfiles(options, { dir, manifest }, measuring) };
  });
}

/**
 * Measures each brush of the pack published at `place` whose key has no profile stored, and stores it: `studio brushes
 * import` without an archive. The pack itself is left as it is.
 */
export function measureStampPaintPackProfiles(place: StampPaintPackPlace, measuring: StampPaintPackMeasuring): Promise<ImportedStampPaintPack> {
  return withStampPackLock(place, async () => {
    const dir = stampPaintPackDir(place), current = readStampPaintPackGeneration(dir);
    return { dir, manifest: current.manifest, profiles: await measureUnstoredStampProfiles(place, current, measuring) };
  });
}
