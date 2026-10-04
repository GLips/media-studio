// workspace-pigment-style.ts: a workspace style read from disk, its brushes resolved from the packs imported on this
// machine as served to a page (readWorkspaceStampPaintStyle), and as a page that paints in pigment (a study sheet, a
// painting source's still) takes it. Each page picks its own brushes; the reading is shared.

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { readServedStampPaintPack, type ServedStampPaintPack } from '#lib/paint/brush-packs/engine/stamp-paint-pack-files.ts';
import { stampPaintPackKey, type StampPaintPackUrls } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';
import type { StampPaintPaper } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { StampPigmentMixing } from '#lib/paint/painting/models/stamp-pigment-paint.ts';
import { resolveStampPaintStyle, type ResolvedStampPaintStyle, type StampPaintStyle } from '../models/style.ts';
import { importStampPaintStyle } from './style-probe-medium.ts';

/** A workspace style read: its style.ts, it resolved, and each of its packs as served, by pack. */
export type WorkspaceStampPaintStyle = { style: StampPaintStyle; resolved: ResolvedStampPaintStyle; served: Readonly<Record<string, ServedStampPaintPack>> };

/**
 * `name`, a style in `stylesDir`, which `who` (named in errors) reads. Throws for a style with no style.ts, a pack not
 * imported, or a brush its pack lacks.
 */
export async function readWorkspaceStampPaintStyle(stylesDir: string, name: string, who: string): Promise<WorkspaceStampPaintStyle> {
  const style = await importStampPaintStyle(stylesDir, name);
  if (!style) throw new Error(`${who}: ${name} has no style.ts in ${stylesDir}`);
  const served = Object.fromEntries(Object.keys(style.packs).map((pack) => [pack, readServedStampPaintPack(stylesDir, name, pack)]));
  const resolved = resolveStampPaintStyle(name, style, Object.fromEntries(Object.entries(served).map(([pack, { manifest }]) => [pack, manifest])));
  return { style, resolved, served };
}

/** A workspace style painting in pigment, as a page paints with it. `brushOf` throws for a brush it lacks. */
export type WorkspacePigmentStyle = { brushOf: (brush: string) => StampBrush; paper: StampPaintPaper; mixing: StampPigmentMixing; packUrls: StampPaintPackUrls };

/** `name`, a style in `stylesDir`, which `sheet` (named in errors) needs to paint in pigment. */
export async function readWorkspacePigmentStyle(stylesDir: string, name: string, sheet: string): Promise<WorkspacePigmentStyle> {
  const { resolved, served } = await readWorkspaceStampPaintStyle(stylesDir, name, sheet);
  if (resolved.mixing.kind !== 'pigment') throw new Error(`${sheet}: ${name} paints in flat colour, and the sheet paints in pigment`);
  return {
    brushOf: (brush) => {
      const found = resolved.brushes[brush];
      if (!found) throw new Error(`${sheet}: ${name} has no brush ${brush}`);
      return found;
    },
    paper: resolved.paper, mixing: resolved.mixing,
    packUrls: Object.fromEntries(Object.entries(served).map(([pack, { url }]) => [stampPaintPackKey(name, pack), url])),
  };
}
