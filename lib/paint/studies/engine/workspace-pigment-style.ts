// workspace-pigment-style.ts: a workspace style read from disk for a study sheet that paints in pigment, its packs as
// served to the sheet's page. Each sheet picks its own brushes and adjusts its paper; the reading is shared.

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { readServedStampPaintPack } from '#lib/paint/brush-packs/engine/stamp-paint-pack-files.ts';
import { stampPaintPackKey, type StampPaintPackUrls } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';
import type { StampPaintPaper } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { StampPigmentMixing } from '#lib/paint/painting/models/stamp-pigment-paint.ts';
import { importStampPaintStyle } from '#lib/paint/style/engine/style-probe-medium.ts';
import { resolveStampPaintStyle } from '#lib/paint/style/models/style.ts';

/** A workspace style painting in pigment, as a study sheet's page paints with it. `brushOf` throws for a brush it lacks. */
export type WorkspacePigmentStyle = { brushOf: (brush: string) => StampBrush; paper: StampPaintPaper; mixing: StampPigmentMixing; packUrls: StampPaintPackUrls };

/** `name`, a style in `stylesDir`, which `sheet` (named in errors) needs to paint in pigment. */
export async function readWorkspacePigmentStyle(stylesDir: string, name: string, sheet: string): Promise<WorkspacePigmentStyle> {
  const style = await importStampPaintStyle(stylesDir, name);
  if (!style) throw new Error(`${sheet}: ${name} has no style.ts in ${stylesDir}`);
  const packs = Object.keys(style.packs).map((pack) => { const { manifest, url } = readServedStampPaintPack(stylesDir, name, pack); return { pack, manifest, url }; });
  const resolved = resolveStampPaintStyle(name, style, Object.fromEntries(packs.map(({ pack, manifest }) => [pack, manifest])));
  if (resolved.mixing.kind !== 'pigment') throw new Error(`${sheet}: ${name} paints in flat colour, and the sheet paints in pigment`);
  return {
    brushOf: (brush) => {
      const found = resolved.brushes[brush];
      if (!found) throw new Error(`${sheet}: ${name} has no brush ${brush}`);
      return found;
    },
    paper: resolved.paper, mixing: resolved.mixing,
    packUrls: Object.fromEntries(packs.map(({ pack, url }) => [stampPaintPackKey(name, pack), url])),
  };
}
