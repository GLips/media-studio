// node-stamp-paint-styles.ts: `@stamp-paint-styles` for code that loads a video in Node (a timeline test, the clock,
// the sound check), where no bundle wrote one. A scene reads its style's brushes and palette when it's defined, so
// every style in work/styles/ is here, each image its file URL, as tsx-test-hooks.ts gives any asset. The hooks
// resolve `@stamp-paint-styles` to this module.
//
// Negative space: it doesn't check a style's packs as a bundle does. Nothing in Node paints; a pack that isn't
// imported leaves its manifest out, and a scene asking for the style throws naming the brush it lacks.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { STUDIO_STYLES_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { readImportedStampPaintPack } from './stamp-paint-pack-files.ts';
import type { BundledStampPaintStyles, StampPaintStyle } from '../models/style.ts';

/** Every workspace style, as a bundle would serve it, with every file its imported packs list. */
async function readNodeStampPaintStyles(stylesDir: string): Promise<BundledStampPaintStyles> {
  const names = existsSync(stylesDir) ? readdirSync(stylesDir).filter((name) => existsSync(join(stylesDir, name, 'style.ts'))) : [];
  return Object.fromEntries(await Promise.all(names.map(async (name) => {
    const dir = join(stylesDir, name);
    const style = (await import(pathToFileURL(join(dir, 'style.ts')).href) as { default: StampPaintStyle }).default;
    const imported = Object.keys(style.packs).flatMap((pack) => {
      const read = readImportedStampPaintPack(join(dir, 'brushes', pack));
      return read ? [{ pack, ...read }] : [];
    });
    const manifests = Object.fromEntries(imported.map(({ pack, manifest }) => [pack, manifest]));
    const images = Object.fromEntries(imported.flatMap(({ pack, dir: generation, manifest }) =>
      manifest.files.map((file) => [`${pack}/${file}`, pathToFileURL(join(generation, file)).href])));
    return [name, { style, manifests, images }];
  })));
}

export default await readNodeStampPaintStyles(STUDIO_STYLES_DIR);
