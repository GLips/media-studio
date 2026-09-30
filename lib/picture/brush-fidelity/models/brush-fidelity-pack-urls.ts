// brush-fidelity-pack-urls.ts: where a browser page run over the styles folder (the fidelity page, the stroke hand
// sheet) finds a pack's files. A pack's files sit in its current generation (stamp-paint-pack-files.ts), which only
// Node can resolve, so Node resolves each pack once and hands the page its URL; the page never guesses a path.

import type { StampBrushAsset } from '#lib/picture/stamp-paint/models/stamp-brush.ts';

/** Each pack's current generation as a URL under /files/, keyed by brushFidelityPackKey. */
export type BrushFidelityPackUrls = Readonly<Record<string, string>>;

export const brushFidelityPackKey = (style: string, pack: string) => `${style}/${pack}`;

/** An image of a brush as the page loads it; throws for a pack Node didn't resolve, which would otherwise 404 silently. */
export function brushFidelityAssetUrl(urls: BrushFidelityPackUrls, { style, pack, file }: StampBrushAsset): string {
  const base = urls[brushFidelityPackKey(style, pack)];
  if (base === undefined) throw new Error(`brush fidelity: no URL for ${style}/${pack}, which ${file} is in`);
  return `${base}/${file}`;
}
