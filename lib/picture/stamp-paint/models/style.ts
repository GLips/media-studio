// style.ts: what a private stamp-paint style is. A style lives in work/styles/<name>/ and nowhere else
// (docs/private-styles.md): style.ts (a StampPaintStyle, typed here), <name>.md on painting in it, and brushes/, the
// packs it paints with, imported on each machine from that machine's own bought copy and never tracked.
//
// Negative space: a style sets no per-brush defaults (diameter, opacity, material). A recipe states them on each
// deposit until a style shows which ones repeat.

import type { StampBrush, StampBrushAsset } from './stamp-brush.ts';
import type { StampPaintColor } from './stamp-paint-recipe.ts';

/**
 * The version of the imported assets this studio reads. An import writes it into each pack's manifest; when the
 * studio's asset format changes this goes up, and the bundle refuses a style until its packs are imported again.
 */
export const STAMP_PAINT_ASSETS_VERSION = 1;

/** The file an import writes in each pack's folder, `brushes/<pack>/`, listing what it wrote there. */
export const STAMP_PAINT_PACK_MANIFEST = 'manifest.json';

/**
 * `brushes/<pack>/manifest.json`, as the importer writes it: the version it wrote, every file it wrote (relative to
 * the pack's folder) and each brush it normalized, by its name in the pack. The bundle checks all three before
 * painting. The importer may add its provenance (the archive's hash).
 */
export type StampPaintPackManifest = { version: number; files: readonly string[]; brushes: Readonly<Record<string, StampBrush>> };

/** A style's style.ts: `export default { … } satisfies StampPaintStyle`. */
export type StampPaintStyle = {
  /**
   * The packs its brushes come from, by their folder in brushes/. `source` says where the pack was bought, so a
   * machine that lacks its assets knows where to get it.
   */
  packs: Readonly<Record<string, { source: string }>>;
  /** The brushes it paints with, by the style's own names for them (`wash`, `blotch`), each a brush in one of its packs. */
  brushes: Readonly<Record<string, { pack: string; brush: string }>>;
  /** Named colours, `#rrggbb`. */
  palette: Readonly<Record<string, StampPaintColor>>;
  /**
   * What it paints on: the paper's colour and, for tooth every deposit shows, a grain fixed to the canvas, an image
   * in one of its packs, `scale` its width over the painting's and `depth` (0..1) how strongly it cuts into paint.
   */
  paper: { color: StampPaintColor; grain?: { image: Omit<StampBrushAsset, 'style'>; scale: number; depth: number } };
};
