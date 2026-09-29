// stamp-paint-styles.ts: the private styles a project paints with, as its bundle serves them (`@stamp-paint-styles`,
// written by lib/picture/stamp-paint/engine/project-styles.ts from the styles its project.ts names; in Node, every
// style in the workspace, by lib/picture/stamp-paint/engine/node-stamp-paint-styles.ts).
//
// A scene takes a style by name, typed by its style.ts:
//   import type watercolorStyle from '#styles/watercolor/style.ts';
//   const watercolor = stampPaintStyle<typeof watercolorStyle>('watercolor');
// and paints with `watercolor.brushes.wash`, `watercolor.palette.moss` and `watercolor.paper`.

import styles from '@stamp-paint-styles';
import type { StampBrushAsset } from '../models/stamp-brush.ts';
import { resolveStampPaintStyle, type ResolvedStampPaintStyle, type StampPaintStyle } from '../models/style.ts';

const bundled = (name: string) => {
  const style = styles[name];
  if (!style) throw new Error(`stamp paint: the project's project.ts doesn't name the style ${JSON.stringify(name)} in \`styles\`${Object.keys(styles).length ? ` (it names ${Object.keys(styles).join(', ')})` : ''}`);
  return style;
};

/** The style `name` from the project's project.ts, ready to paint with. */
export function stampPaintStyle<S extends StampPaintStyle = StampPaintStyle>(name: string): ResolvedStampPaintStyle<S> {
  const { style, manifests } = bundled(name);
  return resolveStampPaintStyle(name, style as S, manifests);
}

/** Where the bundle serves an image of a style. */
export function stampPaintAssetUrl({ style, pack, file }: StampBrushAsset): string {
  const url = bundled(style).images[`${pack}/${file}`];
  // Only the images the style's brushes and paper use are bundled: a brush from its packs it doesn't name has none.
  if (!url) throw new Error(`stamp paint: ${style}'s bundle has no ${pack}/${file}; name the brush that uses it in work/styles/${style}/style.ts and bundle again`);
  return url;
}
