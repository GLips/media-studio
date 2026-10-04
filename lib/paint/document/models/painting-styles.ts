// painting-styles.ts: what a document's brushes and paper assets are checked against: each style's brush names, with
// whether each lays wet or dry and the diameters its measured profile spans, and the pack files it can serve. Styles
// are private and machine-local (work/styles/), so this is built from whatever loaded them (Node's style reader, a
// bundle's `@stamp-paint-styles`) and handed to the check; a check without one leaves brushes and assets to the
// compiler. Inside a project the catalogue holds only the styles its project.ts names, as its bundle does.

import { stampBrushProfileRange } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import type { StampBrush, StampBrushAsset, StampBrushMedia } from '#lib/paint/brush/models/stamp-brush.ts';
import { readStampPaintPack } from '#lib/paint/brush-packs/models/stamp-paint-pack.ts';
import { stampPaintStyleBrushes, type BundledStampPaintStyles } from '#lib/paint/style/models/style.ts';
import type { BrushRef } from './painting-document.ts';

/** The diameters a brush's measured profile spans, px: a fill plans its strokes by that profile. Or why it has none. */
export type PaintingBrushDiameters = { readonly kind: 'measured'; readonly min: number; readonly max: number } | { readonly kind: 'unmeasured'; readonly why: string };

/** One of a style's brushes as a document is checked against it: whether it lays wet or dry, and its measured diameters. */
export type PaintingStyleBrush = { readonly media: StampBrushMedia; readonly diameters: PaintingBrushDiameters };

/**
 * One style as a document is checked against it: its brushes by its own names; those it names that can't be read here
 * (their pack isn't imported, or lacks them), each with why; and its files by `<pack>/<file>`.
 */
export type PaintingStyleEntry = {
  readonly brushes: ReadonlyMap<string, PaintingStyleBrush>;
  readonly unread: ReadonlyMap<string, string>;
  readonly files: ReadonlySet<string>;
};

/**
 * The styles a document may name, by name, and whose they are: a project's (`declared`, the names its project.ts
 * lists, which a bundle serves alone) or, with `declared` null, every style the workspace holds.
 */
export type PaintingStyleCatalogue = { readonly styles: ReadonlyMap<string, PaintingStyleEntry>; readonly declared: readonly string[] | null };

/** `brush`'s measured diameters, from the profile its style resolved it with. */
export function paintingBrushDiameters({ profile }: StampBrush): PaintingBrushDiameters {
  if (profile.kind === 'measured') return { kind: 'measured', ...stampBrushProfileRange(profile) };
  return { kind: 'unmeasured', why: profile.kind === 'refused' ? profile.why : 'no import measured it' };
}

/**
 * The catalogue of `styles` as a bundle serves them: a brush's media its own, else its pack's, and its diameters from
 * its pack's profile. With `declared` (a project's project.ts `styles`), only the styles named there.
 */
export function paintingStyleCatalogue(styles: BundledStampPaintStyles, declared: readonly string[] | null): PaintingStyleCatalogue {
  const served = Object.entries(styles).filter(([name]) => declared === null || declared.includes(name));
  return {
    declared,
    styles: new Map(served.map(([name, { style, manifests, images }]) => {
      const packs = Object.fromEntries(Object.entries(manifests).map(([pack, manifest]) => [pack, readStampPaintPack(manifest)]));
      const brushes = new Map<string, PaintingStyleBrush>(), unread = new Map<string, string>();
      for (const [key, read] of stampPaintStyleBrushes(name, style, packs)) {
        const { pack, media } = style.brushes[key];
        if ('brush' in read) brushes.set(key, { media: media ?? style.packs[pack].media, diameters: paintingBrushDiameters(read.brush) });
        else unread.set(key, read.missing);
      }
      return [name, { brushes, unread, files: new Set(Object.keys(images)) }];
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
  const entry = styles.styles.get(asset.style);
  if (!entry) return paintingStyleMissing(styles, asset.style);
  return entry.files.has(`${asset.pack}/${asset.file}`) ? null : `${asset.pack}/${asset.file} isn't among ${asset.style}'s imported pack files`;
}

/** `brush` as `styles` hold it; undefined when no catalogue is known, or it doesn't name the brush or can't read it. */
export const paintingStyleBrush = (styles: PaintingStyleCatalogue | undefined, brush: BrushRef): PaintingStyleBrush | undefined =>
  styles?.styles.get(brush.style)?.brushes.get(brush.brush);

/** Whether `brush` lays wet or dry in `styles`; undefined when no catalogue is known, or it doesn't name the brush. */
export const paintingBrushMedia = (styles: PaintingStyleCatalogue | undefined, brush: BrushRef): StampBrushMedia | undefined => paintingStyleBrush(styles, brush)?.media;

/**
 * Why a fill can't plan its strokes by `brush` at `diameterPx`, and at which field: a fill, flooded or stroked, reads
 * its brush's measured profile, so the brush needs one measured at that diameter. The engine refuses the same as it
 * plans (stamp-brush-profile.ts), naming no application.
 */
export function paintingFillBrushProblem(brush: BrushRef, diameters: PaintingBrushDiameters, diameterPx: number): { readonly field: 'brush' | 'diameterPx'; readonly message: string } | null {
  const name = `${brush.style}'s ${brush.brush}`;
  if (diameters.kind === 'unmeasured') return { field: 'brush', message: `${name} has no measured profile, which a fill plans its strokes by: ${diameters.why}` };
  const { min, max } = diameters;
  if (diameterPx >= min && diameterPx <= max) return null;
  return { field: 'diameterPx', message: `${name} is measured from ${min} to ${max} px, and a fill plans its strokes by that measure: this lays ${diameterPx}` };
}
