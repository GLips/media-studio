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
 * A setting of a source brush the normalized brush doesn't carry as the source means it: `approximated` is read into
 * a nearby setting, `unsupported` is dropped. `setting` is the source format's own field name, so it can be looked up.
 */
export type StampBrushSupportNote = { level: 'approximated' | 'unsupported'; setting: string; detail: string };

/** A paper from the pack: a photograph of it, its tooth as a grain (dark is where pigment settles), its mean colour. */
export type StampPaintPackPaper = { image: string; grain: string; color: StampPaintColor };

/**
 * `brushes/<pack>/manifest.json`, as the importer writes it. The bundle checks `version`, that every file in `files`
 * (relative to the pack's folder) exists, and that each brush a style names is in `brushes`, by its name in the pack.
 * The rest is for whoever writes the style: where the pack came from, each brush's own preview from its source (for
 * judging fidelity) and what didn't carry over, and the pack's palettes and papers.
 */
export type StampPaintPackManifest = {
  version: number;
  files: readonly string[];
  brushes: Readonly<Record<string, StampBrush>>;
  source: { archive: string; sha256: string };
  previews: Readonly<Record<string, string>>;
  support: Readonly<Record<string, readonly StampBrushSupportNote[]>>;
  palettes: Readonly<Record<string, readonly StampPaintColor[]>>;
  papers: Readonly<Record<string, StampPaintPackPaper>>;
};

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
   * What it paints on: the paper's colour, or a photograph of it (`image`, laid under the painting in its place); and,
   * for tooth every deposit shows, a grain fixed to the canvas. Both are images in one of its packs; `scale` is the
   * grain's width over the painting's and `depth` (0..1) how strongly it cuts into paint.
   */
  paper: {
    color: StampPaintColor;
    image?: Omit<StampBrushAsset, 'style'>;
    grain?: { image: Omit<StampBrushAsset, 'style'>; scale: number; depth: number };
  };
};
