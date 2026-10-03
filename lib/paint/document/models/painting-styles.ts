// painting-styles.ts: what a document's brushes and paper assets are checked against: each style's brush names, with
// whether each lays wet or dry, and the pack files it can serve. Styles are private and machine-local (work/styles/),
// so this is built from whatever loaded them (Node's style reader, a bundle's `@stamp-paint-styles`) and handed to
// the check; a check without one leaves brushes and assets to the compiler.

import type { StampBrushAsset, StampBrushMedia } from '#lib/paint/brush/models/stamp-brush.ts';
import type { BundledStampPaintStyles } from '#lib/paint/style/models/style.ts';
import type { BrushRef } from './painting-document.ts';

/** One style as a document is checked against it: its brushes by its own names, and its files by `<pack>/<file>`. */
export type PaintingStyleEntry = { readonly brushes: ReadonlyMap<string, StampBrushMedia>; readonly files: ReadonlySet<string> };

export type PaintingStyleCatalogue = ReadonlyMap<string, PaintingStyleEntry>;

/** The catalogue of `styles` as a bundle serves them: a brush's media its own, else its pack's. */
export function paintingStyleCatalogue(styles: BundledStampPaintStyles): PaintingStyleCatalogue {
  return new Map(Object.entries(styles).map(([name, { style, images }]) => [name, {
    brushes: new Map(Object.entries(style.brushes).map(([brush, { pack, media }]) => [brush, media ?? style.packs[pack].media])),
    files: new Set(Object.keys(images)),
  }]));
}

/** Why `asset` can't be found in `styles`, or null. */
export function paintingAssetProblem(styles: PaintingStyleCatalogue, asset: StampBrushAsset): string | null {
  const entry = styles.get(asset.style);
  if (!entry) return `names style ${asset.style}, which isn't one of ${[...styles.keys()].join(', ')}`;
  return entry.files.has(`${asset.pack}/${asset.file}`) ? null : `${asset.pack}/${asset.file} isn't among ${asset.style}'s imported pack files`;
}

/** Whether `brush` lays wet or dry in `styles`; undefined when no catalogue is known, or it doesn't name the brush. */
export const paintingBrushMedia = (styles: PaintingStyleCatalogue | undefined, brush: BrushRef): StampBrushMedia | undefined => styles?.get(brush.style)?.brushes.get(brush.brush);
