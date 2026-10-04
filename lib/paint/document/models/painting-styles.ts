// painting-styles.ts: what a document's brushes and paper assets are checked against: each style's brushes, read as
// its bundle reads them, and the pack files it can serve. Styles are private and machine-local (work/styles/), so this
// is built from whatever loaded them (Node's style reader, a bundle's `@stamp-paint-styles`) and handed to the check;
// a check without one leaves brushes and assets to the compiler. Inside a project the catalogue holds only the styles
// its project.ts names, and of each only the images its bundle serves.

import { stampBrushDiameterProblem } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import type { StampBrush, StampBrushAsset, StampBrushMedia } from '#lib/paint/brush/models/stamp-brush.ts';
import {
  readBundledStampPaintPacks, stampPaintStyleBrushes, stampPaintStyleImages, stampPaintStylePaper, type BundledStampPaintStyles,
} from '#lib/paint/style/models/style.ts';
import type { BrushRef } from './painting-document.ts';

/**
 * One style as a document is checked against it: its brushes by its own names, each with its media and profile; those
 * it names that can't be read here (their pack isn't imported, or lacks them), each with why; and the files it serves
 * by `<pack>/<file>`.
 */
export type PaintingStyleEntry = {
  readonly brushes: ReadonlyMap<string, StampBrush>;
  readonly unread: ReadonlyMap<string, string>;
  readonly files: ReadonlySet<string>;
};

/**
 * The styles a document may name, by name, and whose they are: a project's (`declared`, the names its project.ts
 * lists, which a bundle serves alone) or, with `declared` null, every style the workspace holds.
 */
export type PaintingStyleCatalogue = { readonly styles: ReadonlyMap<string, PaintingStyleEntry>; readonly declared: readonly string[] | null };

/**
 * The catalogue of `styles`, their brushes read as a bundle reads them (stampPaintStyleBrushes). With `declared` (a
 * project's project.ts `styles`), only the styles named there, each serving only its brushes' and paper's images, as
 * the project's bundle does (project-styles.ts); without, every file the imported packs list, as a still is served.
 */
export function paintingStyleCatalogue(styles: BundledStampPaintStyles, declared: readonly string[] | null): PaintingStyleCatalogue {
  const served = Object.entries(styles).filter(([name]) => declared === null || declared.includes(name));
  return {
    declared,
    styles: new Map(served.map(([name, entry]) => {
      const brushes = new Map<string, StampBrush>(), unread = new Map<string, string>();
      for (const [key, read] of stampPaintStyleBrushes(name, entry.style, readBundledStampPaintPacks(entry))) {
        if ('brush' in read) brushes.set(key, read.brush);
        else unread.set(key, read.missing);
      }
      const images = Object.keys(entry.images);
      const bundled = declared === null
        ? null
        : new Set(stampPaintStyleImages({ brushes: Object.fromEntries(brushes), paper: stampPaintStylePaper(name, entry.style) }).map(({ pack, file }) => `${pack}/${file}`));
      return [name, { brushes, unread, files: new Set(bundled ? images.filter((file) => bundled.has(file)) : images) }];
    })),
  };
}

/** Why `catalogue` holds no style `name`: its project's project.ts doesn't name it, or no style is called that. */
export function paintingStyleMissing({ styles, declared }: PaintingStyleCatalogue, name: string): string {
  if (declared === null) return `names style ${name}, which isn't one of ${[...styles.keys()].join(', ')}`;
  if (declared.includes(name)) return `names style ${name}, which the project's project.ts names and work/styles/ doesn't hold`;
  return `names style ${name}, which the project's project.ts doesn't name in styles (it names ${declared.join(', ') || 'none'})`;
}

/** Why `asset` can't be found in `styles`, or null. */
export function paintingAssetProblem(styles: PaintingStyleCatalogue, asset: StampBrushAsset): string | null {
  const entry = styles.styles.get(asset.style), key = `${asset.pack}/${asset.file}`;
  if (!entry) return paintingStyleMissing(styles, asset.style);
  if (entry.files.has(key)) return null;
  if (styles.declared === null) return `${key} isn't among ${asset.style}'s imported pack files`;
  return `${key} isn't among the images the project's bundle serves of ${asset.style}: its brushes' tips and grains, and its paper's`;
}

/** `brush` as `styles` hold it; undefined when no catalogue is known, or it doesn't name the brush or can't read it. */
export function paintingStyleBrush(styles: PaintingStyleCatalogue | undefined, brush: BrushRef): StampBrush | undefined {
  // A source written in JS may leave its ref out or half named: the check reports that (checkBrush) and reads on.
  const { style, brush: key }: Partial<BrushRef> = brush ?? {};
  return style === undefined || key === undefined ? undefined : styles?.styles.get(style)?.brushes.get(key);
}

/** Whether `brush` lays wet or dry in `styles`; undefined when no catalogue is known, or it doesn't name the brush. */
export const paintingBrushMedia = (styles: PaintingStyleCatalogue | undefined, brush: BrushRef): StampBrushMedia | undefined => paintingStyleBrush(styles, brush)?.media;

/**
 * Why a fill can't plan its strokes by `brush` (named `ref`) at `diameterPx`, at the field at fault: a fill, flooded
 * or stroked, reads its brush's measured profile, which planning refuses by (stampBrushDiameterProblem).
 */
export function paintingFillBrushProblem(ref: BrushRef, brush: StampBrush, diameterPx: number): { readonly field: 'brush' | 'diameterPx'; readonly message: string } | null {
  const problem = stampBrushDiameterProblem(brush, diameterPx);
  if (problem === null) return null;
  return {
    field: problem.field === 'diameter' ? 'diameterPx' : 'brush',
    message: `a fill plans its strokes by its brush's measured profile, and ${ref.style}'s ${ref.brush} ${problem.message}`,
  };
}
