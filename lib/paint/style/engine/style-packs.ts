// style-packs.ts: a style's packs as imported on this machine, read in Node with the profile stored for each brush
// the style names, at its key now (lib/paint/brush-packs/engine/stamp-brush-profile-store.ts). A key hashes the brush's
// images, so it's found here, where the files are, and a bundle carries the profiles found: a project's bundle, Node's
// styles module and a workspace style all resolve their brushes from this.
//
// Stays free of import.meta, as project-styles.ts, which imports it, must.

import { readStampPackBrushProfiles, type StampPaintPackGeneration } from '#lib/paint/brush-packs/engine/stamp-brush-profile-store.ts';
import { stampPaintPackDir } from '#lib/paint/brush-packs/engine/stamp-paint-pack-files.ts';
import type { ProfiledStampPaintPack } from '#lib/paint/brush-packs/models/stamp-paint-pack.ts';
import { stampPaintStyleProbeMediumKey, type StampPaintStyle } from '../models/style.ts';

/** One of a style's packs as read: its generation's folder, the pack as the style paints from it, and each profile's file. */
export type StampPaintStylePackRead = { dir: string; profiled: ProfiledStampPaintPack; profileFiles: Readonly<Record<string, string>> };

/**
 * `style`, named `name` in `stylesDir`, its packs imported as `generations` (one not imported left out): each with the
 * profile stored for every brush the style names from it at its key now, in the medium the style probes in.
 */
export function readStampPaintStylePacks(
  stylesDir: string, name: string, style: StampPaintStyle, generations: Readonly<Record<string, StampPaintPackGeneration>>,
): Record<string, StampPaintStylePackRead> {
  const mediumKey = stampPaintStyleProbeMediumKey(name, style, Object.fromEntries(Object.entries(generations).map(([pack, { manifest }]) => [pack, manifest])));
  return Object.fromEntries(Object.entries(generations).map(([pack, generation]) => {
    const names = [...new Set(Object.values(style.brushes).flatMap((role) => (role.pack === pack ? [role.brush] : [])))];
    const found = Object.entries(readStampPackBrushProfiles(stampPaintPackDir({ stylesDir, style: name, pack }), generation, mediumKey, names));
    const profiled = { style: name, pack, manifest: generation.manifest, profiles: Object.fromEntries(found.map(([brush, { profile }]) => [brush, profile])) };
    return [pack, { dir: generation.dir, profiled, profileFiles: Object.fromEntries(found.map(([brush, { file }]) => [brush, file])) }];
  }));
}

/** Each pack of `read` as its style paints from it. */
export const stampPaintStyleProfiledPacks = (read: Readonly<Record<string, StampPaintStylePackRead>>): Record<string, ProfiledStampPaintPack> =>
  Object.fromEntries(Object.entries(read).map(([pack, { profiled }]) => [pack, profiled]));
