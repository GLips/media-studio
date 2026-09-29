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
export const STAMP_PAINT_ASSETS_VERSION = 3;

/** The file an import writes in each pack's folder, `brushes/<pack>/`, listing what it wrote there. */
export const STAMP_PAINT_PACK_MANIFEST = 'manifest.json';

/**
 * A setting of a source brush the normalized brush doesn't carry as the source means it: `approximated` is read into
 * a nearby setting, `unsupported` is dropped, and `inapplicable` is dropped because a painting never has what it
 * responds to (a pen's tilt). `setting` is the source format's own field name, so it can be looked up.
 */
export type StampBrushSupportNote = { level: 'approximated' | 'unsupported' | 'inapplicable'; setting: string; detail: string };

/**
 * A style's fidelity.ts, beside its style.ts and kept in git: `export default { … } satisfies StampPaintStyleFidelity`,
 * a note per brush, each pack's brushes by their names in the pack, on how and why it differs from its source's own
 * preview. How far it differs is the sheet's score and grade (fidelity-grades.json), not the note's to say.
 */
export type StampPaintStyleFidelity = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** A style's fidelity-grades.json, which `studio brushes sheet` writes beside its fidelity.ts. */
export const STAMP_PAINT_FIDELITY_GRADES = 'fidelity-grades.json';

/**
 * Each pack's brushes, by name, with their score on the brush fidelity sheet (0 matches the preview) and the grade it
 * earns (lib/picture/stamp-paint/models/procreate-preview-stroke.ts: `close`, `rough` or `off`).
 */
export type StampPaintStyleGrades = Record<string, Record<string, { grade: 'close' | 'rough' | 'off'; score: number }>>;

/**
 * A brush's own preview from its source: the image (relative to the pack's folder), and whether it shows a stroke or,
 * for a brush its source previews that way, one stamp.
 */
export type StampPaintPackPreview = { image: string; shows: 'stroke' | 'stamp' };

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
  previews: Readonly<Record<string, StampPaintPackPreview>>;
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

/** A style's paper with each image named in full, as a painting is laid on it. */
export type StampPaintPaper = {
  color: StampPaintColor;
  image?: StampBrushAsset;
  grain?: { image: StampBrushAsset; scale: number; depth: number };
};

/** One style as a bundle serves it (`@stamp-paint-styles`): its style.ts, its packs' manifests, a URL for each image it paints with. */
export type BundledStampPaintStyle = {
  style: StampPaintStyle;
  manifests: Readonly<Record<string, StampPaintPackManifest>>;
  /** By `<pack>/<file>`. */
  images: Readonly<Record<string, string>>;
};
export type BundledStampPaintStyles = Readonly<Record<string, BundledStampPaintStyle>>;

/** A style ready to paint with: each of its brushes as its pack normalized it, its palette and its paper. */
export type ResolvedStampPaintStyle<S extends StampPaintStyle = StampPaintStyle> = {
  name: string;
  brushes: { readonly [K in keyof S['brushes']]: StampBrush };
  palette: S['palette'];
  paper: StampPaintPaper;
};

/**
 * `style`, named `name`, with its brushes looked up in its packs' manifests. Throws on a brush its pack lacks, which
 * the bundle's check (lib/picture/stamp-paint/engine/project-styles.ts) has already refused.
 */
export function resolveStampPaintStyle<S extends StampPaintStyle>(name: string, style: S, manifests: Readonly<Record<string, StampPaintPackManifest>>): ResolvedStampPaintStyle<S> {
  const brushes = Object.fromEntries(Object.entries(style.brushes).map(([key, { pack, brush }]) => {
    const found = manifests[pack]?.brushes[brush];
    if (!found) throw new Error(`stamp paint: ${name}'s brush ${key} is ${pack}'s ${JSON.stringify(brush)}, which its manifest lacks`);
    return [key, found];
  }));
  const { color, image, grain } = style.paper;
  const paper: StampPaintPaper = {
    color,
    ...(image && { image: { style: name, ...image } }),
    ...(grain && { grain: { ...grain, image: { style: name, ...grain.image } } }),
  };
  return { name, brushes: brushes as ResolvedStampPaintStyle<S>['brushes'], palette: style.palette, paper };
}

/** Every image a style paints with, by pack and file, each once: its brushes' tips and grains, their duals', its paper's. */
export function stampPaintStyleImages(resolved: ResolvedStampPaintStyle): Omit<StampBrushAsset, 'style'>[] {
  const assets = [
    ...Object.values(resolved.brushes).flatMap((brush) => [brush, ...(brush.dual ? [brush.dual] : [])].flatMap((layer) => [layer.tip.image, ...(layer.grain ? [layer.grain.image] : [])])),
    ...(resolved.paper.image ? [resolved.paper.image] : []),
    ...(resolved.paper.grain ? [resolved.paper.grain.image] : []),
  ];
  const byKey = new Map(assets.map(({ pack, file }) => [`${pack}/${file}`, { pack, file }]));
  return [...byKey.values()];
}
