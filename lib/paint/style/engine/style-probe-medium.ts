// style-probe-medium.ts: a workspace style read from its style.ts in Node, and the medium its brushes are probed in
// when its packs are imported (vid-119): its own paper and paint, so a brush's visible offset is where its paint reads
// as ended there.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readImportedStampPaintPack, stampPaintPackDir } from '#lib/paint/brush-packs/engine/stamp-paint-pack-files.ts';
import { STAMP_BRUSH_PROBE_BARE_MEDIUM, stampBrushProbeMediumKey, type StampBrushProbeMedium } from '#lib/paint/brush-packs/models/stamp-brush-profile-probes.ts';
import { stampPaintStyleProbeMedium, type StampPaintStyle } from '../models/style.ts';

/** `name`'s style.ts in `stylesDir`, imported; null for a style with none yet. */
export async function importStampPaintStyle(stylesDir: string, name: string): Promise<StampPaintStyle | null> {
  const file = join(stylesDir, name, 'style.ts');
  if (!existsSync(file)) return null;
  // SAFETY: a workspace style's style.ts default-exports a StampPaintStyle (`satisfies StampPaintStyle`), which the workspace typecheck holds.
  return (await import(pathToFileURL(file).href) as { default: StampPaintStyle }).default;
}

/**
 * The medium `style` (a folder of `stylesDir`) probes its brushes in, and its key as its packs are imported now
 * (stampBrushProbeMediumKey): what a profile measured in it is checked against. A style with no style.ts yet has none
 * of its own, so its brushes are probed bare.
 */
export async function readStampPaintStyleProbeMedium(stylesDir: string, style: string): Promise<{ medium: StampBrushProbeMedium; key: string }> {
  const read = await importStampPaintStyle(stylesDir, style);
  const medium = read ? stampPaintStyleProbeMedium(style, read) : STAMP_BRUSH_PROBE_BARE_MEDIUM;
  const archives = Object.fromEntries(Object.keys(read?.packs ?? {}).flatMap((pack) => {
    const imported = readImportedStampPaintPack(stampPaintPackDir({ stylesDir, style, pack }));
    return imported ? [[pack, imported.manifest.source.sha256] as const] : [];
  }));
  return { medium, key: stampBrushProbeMediumKey(medium, archives) };
}
