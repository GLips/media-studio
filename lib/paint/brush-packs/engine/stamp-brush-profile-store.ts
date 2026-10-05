// stamp-brush-profile-store.ts: where a pack's measured profiles live, `brushes/<pack>/profiles/`, beside its
// generations and outliving them: a file a brush and key (stampBrushProfileKey: the probe protocol, its settings, its
// images' bytes, its style's paper and paint). A profile is found by computing its brush's key now and looking for
// that file, so one measured under another key is never read, and an import adds files without replacing any.
//
// Negative space: nothing here deletes a profile. One whose key no brush has any more is a few kilobytes left behind.

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { stampBrushImages, type StampBrush, type StampBrushProfileKey } from '#lib/paint/brush/models/stamp-brush.ts';
import { STAMP_BRUSH_PROFILE_PROTOCOL, stampBrushProfileSettingsHash } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { stampBrushProbeMediumKey, type StampBrushProbeMedium } from '../models/stamp-brush-profile-probes.ts';
import {
  readStampPaintPackBrushSource, readStoredStampBrushProfile, storedStampBrushProfile, type ProfiledStampPaintPack, type StampPaintPack,
  type StampPaintPackProfile,
} from '../models/stamp-paint-pack.ts';
import { readServedStampPaintPack, stampPackSlug, stampPaintPackDir, type StampPaintPackPlace } from './stamp-paint-pack-files.ts';

/** The folder in a pack's folder its profiles are stored in. */
export const STAMP_PACK_PROFILES = 'profiles';

/** A pack's generation as read: its folder, where its images are, and its manifest. */
export type StampPaintPackGeneration = { dir: string; manifest: StampPaintPack };

/** `brush`'s key: the protocol, its settings, its images' bytes as `generation` holds them, and `mediumKey`. */
export function stampBrushProfileKey(brush: StampBrush, generation: string, mediumKey: string): StampBrushProfileKey {
  const assets = createHash('sha256');
  for (const { image } of stampBrushImages(brush)) assets.update(`${image.file}\n`).update(readFileSync(join(generation, image.file)));
  return { protocol: STAMP_BRUSH_PROFILE_PROTOCOL, settings: stampBrushProfileSettingsHash(brush), assets: assets.digest('hex'), medium: mediumKey };
}

/** The packs `medium`'s paper takes its images from. */
export const stampProbePaperPacks = ({ paper }: StampBrushProbeMedium) => [paper.image, paper.grain?.image].flatMap((asset) => (asset ? [asset.pack] : []));

/**
 * `medium`'s key (stampBrushProbeMediumKey) as `pack` is imported from the archive `sha256`, its paper read from its
 * style's packs as they're served now, or from `pack` itself: what a style's reader computes once it's published.
 */
export function stampPackProbeMediumKey({ stylesDir, style, pack }: StampPaintPackPlace, sha256: string, medium: StampBrushProbeMedium): string {
  const others = stampProbePaperPacks(medium).filter((other) => other !== pack);
  const archives = Object.fromEntries(others.map((other) => [other, readServedStampPaintPack(stylesDir, style, other).manifest.source.sha256]));
  return stampBrushProbeMediumKey(medium, { ...archives, [pack]: sha256 });
}

/**
 * The file `brush`'s profile at `key` is stored in, in the pack at `packDir`: its name's slug, for whoever lists the
 * folder, and a hash of the name and key, which is the address.
 */
export function stampBrushProfileFile(packDir: string, brush: string, key: StampBrushProfileKey): string {
  const address = createHash('sha256').update(JSON.stringify([brush, key.protocol, key.settings, key.assets, key.medium])).digest('hex').slice(0, 32);
  const slug = stampPackSlug(brush);
  return join(packDir, STAMP_PACK_PROFILES, `${slug ? `${slug}-` : ''}${address}.json`);
}

const sameStampBrushProfileKey = (a: StampBrushProfileKey, b: StampBrushProfileKey) =>
  a.protocol === b.protocol && a.settings === b.settings && a.assets === b.assets && a.medium === b.medium;

/** The profile in `file`, stored for `brush` at `key`; undefined when there's none. Throws naming a file that's wrong. */
export function readStampBrushProfileFile(file: string, brush: string, key: StampBrushProfileKey): StampPaintPackProfile | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const read = readStoredStampBrushProfile(readFileSync(file, 'utf8'), 'the profile');
    if (read.brush !== brush || !sameStampBrushProfileKey(read.profile.key, key)) throw new Error(`it holds ${JSON.stringify(read.brush)}'s profile at another key than its name says`);
    return read.profile;
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** Stores `profile` as `brush`'s in the pack at `packDir`, whole or not at all; returns its file. */
export function writeStampBrushProfile(packDir: string, brush: string, profile: StampPaintPackProfile): string {
  const file = stampBrushProfileFile(packDir, brush, profile.key);
  mkdirSync(dirname(file), { recursive: true });
  const writing = join(dirname(file), `.${basename(file)}.${randomUUID()}`);
  writeFileSync(writing, `${JSON.stringify(storedStampBrushProfile(brush, profile), null, 1)}\n`);
  renameSync(writing, file);
  return file;
}

/** A brush of a pack read with its key now, and the file its profile is stored in at that key. */
export type StampPackBrushKeyed = { name: string; brush: StampBrush; key: StampBrushProfileKey; file: string };

/** Each of `names` that `generation` holds, read from its source, with its key now in `mediumKey`'s medium. */
export function stampPackBrushesKeyed(packDir: string, generation: StampPaintPackGeneration, mediumKey: string, names: readonly string[]): StampPackBrushKeyed[] {
  return names.flatMap((name) => {
    const read = readStampPaintPackBrushSource(generation.manifest, name);
    if (!read) return [];
    const key = stampBrushProfileKey(read.brush, generation.dir, mediumKey);
    return [{ name, brush: read.brush, key, file: stampBrushProfileFile(packDir, name, key) }];
  });
}

/**
 * Each of `names` of the pack in `packDir`, its current generation `generation`, with the profile stored at its key
 * now in `mediumKey`'s medium and the file it's in; a brush with none stored is left out.
 */
export function readStampPackBrushProfiles(
  packDir: string, generation: StampPaintPackGeneration, mediumKey: string, names: readonly string[],
): Record<string, { file: string; profile: StampPaintPackProfile }> {
  return Object.fromEntries(stampPackBrushesKeyed(packDir, generation, mediumKey, names).flatMap(({ name, key, file }) => {
    const profile = readStampBrushProfileFile(file, name, key);
    return profile ? [[name, { file, profile }]] : [];
  }));
}

/**
 * The pack at `place`, its current generation `generation`, as a style paints from it: with the profiles stored for
 * `names` (every brush, by default) at their keys in `mediumKey`'s medium.
 */
export function readProfiledStampPaintPack(
  place: StampPaintPackPlace, generation: StampPaintPackGeneration, mediumKey: string, names: readonly string[] = Object.keys(generation.manifest.brushes),
): ProfiledStampPaintPack {
  const found = readStampPackBrushProfiles(stampPaintPackDir(place), generation, mediumKey, names);
  return { style: place.style, pack: place.pack, manifest: generation.manifest, profiles: Object.fromEntries(Object.entries(found).map(([name, { profile }]) => [name, profile])) };
}
