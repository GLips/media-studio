// stamp-reference-image.ts: a tip's or grain's paint as the reference renderer (stamp-reference-deposit.ts) reads it,
// sampled the way the GPU renderer's samplers do: a mip chain whose every level averages four texels of the one below,
// read bilinearly between texel centres and linearly between levels, clamped (a tip) or tiled (a grain).

/** A grey image's paint, 0..1, row by row, 1 where it paints. */
export type StampReferenceImage = { width: number; height: number; paint: Float32Array };

export type StampReferenceMips = readonly StampReferenceImage[];

/** Each level half the one below, rounded down to a pixel, down to 1×1. */
export function stampReferenceMips(image: StampReferenceImage): StampReferenceMips {
  const levels = [image];
  for (let level = image; level.width > 1 || level.height > 1;) {
    const width = Math.max(1, level.width >> 1), height = Math.max(1, level.height >> 1), paint = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) sum += level.paint[Math.min(level.height - 1, 2 * y + dy) * level.width + Math.min(level.width - 1, 2 * x + dx)];
        paint[y * width + x] = sum / 4;
      }
    }
    level = { width, height, paint };
    levels.push(level);
  }
  return levels;
}

export type StampReferenceWrap = 'clamp' | 'tile';

function bilinear(image: StampReferenceImage, u: number, v: number, wrap: StampReferenceWrap): number {
  const x = u * image.width - 0.5, y = v * image.height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const at = (xi: number, yi: number) => {
    const cx = wrap === 'tile' ? ((xi % image.width) + image.width) % image.width : Math.min(image.width - 1, Math.max(0, xi));
    const cy = wrap === 'tile' ? ((yi % image.height) + image.height) % image.height : Math.min(image.height - 1, Math.max(0, yi));
    return image.paint[cy * image.width + cx];
  };
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

/**
 * The paint at (u, v), 0..1 across the image, at mip level `lod` (0 the image itself). A clamped image is blank outside
 * its square, as a tip's hull leaves nothing there to draw.
 */
export function sampleStampReference(mips: StampReferenceMips, u: number, v: number, lod: number, wrap: StampReferenceWrap): number {
  if (wrap === 'clamp' && (u < 0 || u > 1 || v < 0 || v > 1)) return 0;
  const level = Math.min(mips.length - 1, Math.max(0, lod)), lo = Math.floor(level), t = level - lo;
  const a = bilinear(mips[lo], u, v, wrap);
  return t > 0 && lo + 1 < mips.length ? a + (bilinear(mips[lo + 1], u, v, wrap) - a) * t : a;
}
