// workspace-style-brush-numbers.ts: `studio brushes describe`'s reading of a workspace style, its brushes resolved
// from the packs imported on this machine, as a painting resolves them.

import { readStampPaintPackDir, stampPaintPackDir } from '#lib/paint/brush-packs/engine/stamp-paint-pack-files.ts';
import { resolveStampPaintStyle } from '../models/style.ts';
import { stampStyleBrushNumbers, type StampStyleBrushNumbers } from '../models/style-brush-numbers.ts';
import { importStampPaintStyle } from './style-probe-medium.ts';

/** `name`, a style in `stylesDir`, its roles as numbers to plan by. Throws for a style with no style.ts or a pack not imported. */
export async function readWorkspaceStyleBrushNumbers(stylesDir: string, name: string): Promise<StampStyleBrushNumbers[]> {
  const style = await importStampPaintStyle(stylesDir, name);
  if (!style) throw new Error(`brushes describe: ${name} has no style.ts in ${stylesDir}`);
  const packs = Object.fromEntries(Object.keys(style.packs).map((pack) => [pack, readStampPaintPackDir(stampPaintPackDir({ stylesDir, style: name, pack }))]));
  return stampStyleBrushNumbers(style, resolveStampPaintStyle(name, style, packs));
}
