// stamp-paint-pack-urls.ts: where a browser page run over the styles folder (the fidelity page, the studies' sheets)
// finds a pack's files. A pack's files sit in its current generation (stamp-paint-pack-files.ts), which only
// Node can resolve, so Node resolves each pack once and hands the page its URL; the page never guesses a path.

import type { StampBrushAsset } from '#lib/paint/brush/models/stamp-brush.ts';

/** Each pack's current generation as a URL under /files/, keyed by stampPaintPackKey. */
export type StampPaintPackUrls = Readonly<Record<string, string>>;

export const stampPaintPackKey = (style: string, pack: string) => `${style}/${pack}`;

/** An image of a brush as the page loads it; throws for a pack Node didn't resolve, which would otherwise 404 silently. */
export function stampPaintPackAssetUrl(urls: StampPaintPackUrls, { style, pack, file }: StampBrushAsset): string {
  const base = urls[stampPaintPackKey(style, pack)];
  if (base === undefined) throw new Error(`stamp paint pack: no URL for ${style}/${pack}, which ${file} is in`);
  return `${base}/${file}`;
}
