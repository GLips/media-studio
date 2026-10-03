// stamp-tip-levels.ts: a tip's mip levels, made once on the CPU from its decoded image (a pack's tip or contact, or a
// drawn bristle tip). The renderer uploads these bytes as they are and the hull (stamp-tip-hull.ts) reads them, so
// the two never disagree about where a level holds paint.
//
// Each level is the mean of four texels of the one above, rounded, a tie to the darker. A GPU's filter rounds ties
// either way by the byte, so levels it makes differ by machine. An odd side drops its last texel.

/** One mip level of a grey tip: `texels` a byte each, row by row, 255 bare paper and darker paint. */
export type StampTipLevel = { width: number; height: number; texels: Uint8Array };

/** Every mip level of a tip, its own image first, down to one texel. */
export type StampTipLevels = readonly StampTipLevel[];

/** A grey image as decoded: a byte a texel, row by row. */
export type StampTipImage = { width: number; height: number; pixels: Uint8Array };

/** How many mip levels a `width` × `height` image has, down to one texel, as WebGPU counts them. */
export const stampTipLevelCount = (width: number, height: number) => Math.floor(Math.log2(Math.max(width, height))) + 1;

/** `image`'s mip levels, its own pixels the first. */
export function stampTipLevels(image: StampTipImage): StampTipLevels {
  const levels: StampTipLevel[] = [{ width: image.width, height: image.height, texels: image.pixels }];
  for (let level = 1; level < stampTipLevelCount(image.width, image.height); level++) levels.push(halvedStampTipLevel(levels[level - 1]));
  return levels;
}

function halvedStampTipLevel({ width, height, texels }: StampTipLevel): StampTipLevel {
  const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const top = Math.min(2 * y, height - 1) * width, bottom = Math.min(2 * y + 1, height - 1) * width;
    for (let x = 0; x < w; x++) {
      const left = Math.min(2 * x, width - 1), right = Math.min(2 * x + 1, width - 1);
      out[y * w + x] = (texels[top + left] + texels[top + right] + texels[bottom + left] + texels[bottom + right] + 1) >> 2;
    }
  }
  return { width: w, height: h, texels: out };
}
