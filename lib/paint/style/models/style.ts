// style.ts: what a private stamp-paint style is. A style lives in work/styles/<name>/ and nowhere else
// (docs/private-styles.md): style.ts (a StampPaintStyle, typed here), <name>.md on painting in it, and brushes/, the
// packs it paints with, imported on each machine from that machine's own bought copy and never tracked.
//
// Negative space: a style sets no per-brush defaults (diameter, opacity, material). A recipe states them on each
// deposit until a style shows which ones repeat.

import { stampBrushImages, type StampBrush, type StampBrushAsset, type StampBrushMedia } from '#lib/paint/brush/models/stamp-brush.ts';
import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import type { StampPaintPaper } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { StampPaintColor } from '#lib/paint/materials/models/paint-material.ts';
import type { StampPaintMixing, StampPigmentMixing } from '#lib/paint/painting/models/stamp-pigment-paint.ts';
import { resolveStampPaintPackBrush, stampPaintPackArchives, type StampPaintPack } from '#lib/paint/brush-packs/models/stamp-paint-pack.ts';
import { stampBrushProbeMediumKey, stampBrushProbePaint, type StampBrushProbeMedium } from '#lib/paint/brush-packs/models/stamp-brush-profile-probes.ts';

/** A style's style.ts: `export default { … } satisfies StampPaintStyle`. */
export type StampPaintStyle = {
  /**
   * The packs its brushes come from, by their folder in brushes/. `source` says where the pack was bought, so a
   * machine that lacks its assets knows where to get it; `media` whether its brushes are wet or dry, which Photoshop's don't say.
   */
  packs: Readonly<Record<string, { source: string; media: StampBrushMedia }>>;
  /**
   * The brushes it paints with, by the style's own names for them (`wash`, `blotch`), each a brush in one of its packs,
   * of its pack's media unless it states its own (a dry brush in a watercolour pack).
   */
  brushes: Readonly<Record<string, { pack: string; brush: string; media?: StampBrushMedia }>>;
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
  /**
   * Whether it paints in pigment, mixed and dried with Kubelka–Munk, rather than flat colour blended as Photoshop
   * blends it: the `medium` it paints in, and the pigments its paintings mix by name, each keyed by its id.
   */
  paint?: { medium: PaintMedium; pigments: Readonly<Record<string, PaintPigmentAppearance>> };
};

/**
 * One style as a bundle serves it (`@stamp-paint-styles`): its style.ts, its packs' manifests as JSON (unread until
 * readStampPaintPack), a URL for each image it paints with.
 */
export type BundledStampPaintStyle = {
  style: StampPaintStyle;
  manifests: Readonly<Record<string, unknown>>;
  /** By `<pack>/<file>`. */
  images: Readonly<Record<string, string>>;
};
export type BundledStampPaintStyles = Readonly<Record<string, BundledStampPaintStyle>>;

/** How a style's paint mixes: in pigment, its own pigments by key, where its `paint` says so; else either way. */
export type StampPaintStyleMixing<S extends StampPaintStyle> =
  S extends { paint: { pigments: infer P extends Readonly<Record<string, PaintPigmentAppearance>> } } ? StampPigmentMixing<P> : StampPaintMixing;

/**
 * A style ready to paint with: each of its brushes read from its pack's source with its media, its palette, its paper, and how its
 * paint mixes (its pigments with it, for a style that paints in pigment).
 */
export type ResolvedStampPaintStyle<S extends StampPaintStyle = StampPaintStyle> = {
  name: string;
  brushes: { readonly [K in keyof S['brushes']]: StampBrush };
  palette: S['palette'];
  paper: StampPaintPaper;
  mixing: StampPaintStyleMixing<S>;
};

/** `style`'s mixing, as its resolved type says. */
export function stampPaintStyleMixing<S extends StampPaintStyle>(style: S): StampPaintStyleMixing<S> {
  const mixing: StampPaintMixing = style.paint ? { kind: 'pigment', medium: style.paint.medium, pigments: style.paint.pigments } : { kind: 'flat' };
  // SAFETY: where S has paint this is StampPigmentMixing of its very pigments; otherwise the type is any mixing.
  return mixing as StampPaintStyleMixing<S>;
}

/** The medium `style`, named `name`, probes its brushes in: its paper, its mixing and its strongest paint. */
export function stampPaintStyleProbeMedium(name: string, style: StampPaintStyle): StampBrushProbeMedium {
  const mixing = stampPaintStyleMixing(style);
  return { paper: stampPaintStylePaper(name, style), mixing, paint: stampBrushProbePaint(mixing) };
}

/**
 * `style`, named `name`, with its brushes read from its packs' sources, each brush's profile checked against the
 * medium its style probes in now. Throws on a brush its pack lacks, which the bundle's check
 * (lib/paint/style/engine/project-styles.ts) has already refused, or a pigment keyed by other than its id.
 */
export function resolveStampPaintStyle<S extends StampPaintStyle>(name: string, style: S, packs: Readonly<Record<string, StampPaintPack>>): ResolvedStampPaintStyle<S> {
  const medium = stampBrushProbeMediumKey(stampPaintStyleProbeMedium(name, style), stampPaintPackArchives(packs));
  const brushes = Object.fromEntries(Object.entries(style.brushes).map(([key, { pack, brush, media }]) => {
    const found = packs[pack] && resolveStampPaintPackBrush(packs[pack], brush, medium);
    if (!found) throw new Error(`stamp paint: ${name}'s brush ${key} is ${pack}'s ${JSON.stringify(brush)}, which its manifest lacks`);
    return [key, { ...found.brush, media: media ?? style.packs[pack].media }];
  }));
  const misnamed = Object.entries(style.paint?.pigments ?? {}).find(([key, { id }]) => key !== id);
  if (misnamed) throw new Error(`stamp paint: ${name}'s pigment ${misnamed[0]} has the id ${misnamed[1].id}; key each pigment by its id`);
  // SAFETY: brushes has an entry for each of style.brushes' keys, mapped above.
  const resolved = brushes as ResolvedStampPaintStyle<S>['brushes'];
  return {
    name, brushes: resolved, palette: style.palette, paper: stampPaintStylePaper(name, style),
    mixing: stampPaintStyleMixing(style),
  };
}

/** What `style`, named `name`, paints on, its images its own packs'. */
export function stampPaintStylePaper(name: string, style: StampPaintStyle): StampPaintPaper {
  const { color, image, grain } = style.paper;
  return {
    color,
    ...(image && { image: { style: name, ...image } }),
    ...(grain && { grain: { ...grain, image: { style: name, ...grain.image } } }),
  };
}

/** Every image a style paints with, by pack and file, each once: its brushes' tips and grains, their duals', its paper's. */
export function stampPaintStyleImages(resolved: ResolvedStampPaintStyle): Omit<StampBrushAsset, 'style'>[] {
  const assets = [
    ...Object.values(resolved.brushes).flatMap((brush) => stampBrushImages(brush).map(({ image }) => image)),
    ...(resolved.paper.image ? [resolved.paper.image] : []),
    ...(resolved.paper.grain ? [resolved.paper.grain.image] : []),
  ];
  const byKey = new Map(assets.map(({ pack, file }) => [`${pack}/${file}`, { pack, file }]));
  return [...byKey.values()];
}
