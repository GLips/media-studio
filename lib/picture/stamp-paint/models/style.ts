// style.ts: what a private stamp-paint style is. A style lives in work/styles/<name>/ and nowhere else
// (docs/private-styles.md): style.ts (a StampPaintStyle, typed here), <name>.md on painting in it, and brushes/, the
// packs it paints with, imported on each machine from that machine's own bought copy and never tracked.
//
// Negative space: the brushes a style picks, its paper and its defaults aren't typed yet. They name brush definitions
// the recipe contract (vid-80) owns, and join this type with it.

/**
 * The version of the imported assets this studio reads. An import writes it into each pack's manifest; when the
 * studio's asset format changes this goes up, and the bundle refuses a style until its packs are imported again.
 */
export const STAMP_PAINT_ASSETS_VERSION = 1;

/** The file an import writes in each pack's folder, `brushes/<pack>/`, listing what it wrote there. */
export const STAMP_PAINT_PACK_MANIFEST = 'manifest.json';

/**
 * `brushes/<pack>/manifest.json`, as the importer writes it: the version it wrote and every file it wrote, relative to
 * the pack's folder. The bundle checks both before painting. The importer may add its provenance (the archive's hash).
 */
export type StampPaintPackManifest = { version: number; files: readonly string[] };

/** A style's style.ts: `export default { … } satisfies StampPaintStyle`. */
export type StampPaintStyle = {
  /**
   * The packs its brushes come from, by their folder in brushes/. `source` says where the pack was bought, so a
   * machine that lacks its assets knows where to get it.
   */
  packs: Readonly<Record<string, { source: string }>>;
  /** Named colours, `#rrggbb`. */
  palette: Readonly<Record<string, string>>;
};
