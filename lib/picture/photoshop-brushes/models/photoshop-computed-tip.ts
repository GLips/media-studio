// photoshop-computed-tip.ts: Photoshop's computed round tip's alpha by distance from centre, fitted to single-stamp
// captures at hardness 0..100, diameter 32..256.
//
// A soft tip (hardness up to 0.95) is flat out to c, then falls as 10^(−((r − c)/w)²); hardness 0 is exactly
// 10^(−(r/R)²), still 0.1 at the rim, so a soft tip reaches well past its diameter. c and w are a share of the radius
// plus a few pixels: a 32 px tip reads softer than 256 px. A hard tip is an erf edge, σ 0.704 px. Tips of 7.5 px
// and less fit no radial profile: they're drawn in whole pixels.

/** [hardness, c / R, w / R]: 0, 0.5 and 0.9 fitted over three diameters, the rest at 128 px. */
const SHAPE: [number, number, number][] = [
  [0, 0.0015, 1.0015], [0.1, 0.159, 0.8647], [0.25, 0.3708, 0.6738], [0.4, 0.5562, 0.5035], [0.5, 0.6608, 0.3981],
  [0.6, 0.7564, 0.3019], [0.75, 0.8691, 0.1712], [0.9, 0.9575, 0.0607], [0.95, 0.9773, 0.0276],
];
/** [hardness, c's pixels, w's pixels], held beyond 0.9. */
const OFFSET: [number, number, number][] = [[0, -0.072, 0.154], [0.5, -0.945, 1.295], [0.9, -1.177, 2.025]];
const HARD_SIGMA = 0.704;
/**
 * Where the profile ends: subtracted and rescaled, so the tail meets 0 without a step. Invisible on one stamp, but
 * stamps at 1% spacing pile a step up into a ring.
 */
const FLOOR = 0.0015;

/** Tips this small or smaller are drawn by Photoshop as whole pixels; the profile only approximates them. */
export const PHOTOSHOP_PIXEL_TIP_DIAMETER = 7.5;

function lerpTable(table: [number, number, number][], h: number): [number, number] {
  if (h <= table[0][0]) return [table[0][1], table[0][2]];
  for (let i = 1; i < table.length; i++) {
    if (h <= table[i][0]) {
      const [h0, p0, q0] = table[i - 1], [h1, p1, q1] = table[i], t = (h - h0) / (h1 - h0);
      return [p0 + t * (p1 - p0), q0 + t * (q1 - q0)];
    }
  }
  const last = table[table.length - 1];
  return [last[1], last[2]];
}

/** Abramowitz and Stegun's erf, to 1.5e-7. */
function erf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

function softAlpha(r: number, R: number, h: number) {
  const [beta, b] = lerpTable(SHAPE, h), [alpha, a] = lerpTable(OFFSET, h);
  const c = beta * R + alpha, w = Math.max(1e-3, b * R + a);
  return r <= c ? 1 : Math.pow(0.1, ((r - c) / w) ** 2);
}

function hardAlpha(r: number, R: number) {
  const m = -0.12 - 0.0044 * Math.max(0, R - 16);
  return 0.5 * (1 - erf((r - R - m) / (Math.SQRT2 * HARD_SIGMA)));
}

/** Alpha at `r` px from the centre of a computed round tip `diameter` px wide at `hardness` 0..1. */
export function photoshopComputedTipAlpha(r: number, diameter: number, hardness: number): number {
  const R = diameter / 2, h = Math.min(1, Math.max(0, hardness));
  const t = Math.max(0, (h - 0.95) / 0.05);
  const a = h <= 0.95 ? softAlpha(r, R, h) : (1 - t) * softAlpha(r, R, 0.95) + t * hardAlpha(r, R);
  return Math.max(0, (a - FLOOR) / (1 - FLOOR));
}

/**
 * The span, over its diameter, of an image holding the whole tip, a pixel spare each side, rounded up to even pixels.
 * An even width puts texel centres on pixel centres under a stamp centred on a pixel corner, as Photoshop centres
 * them, so sampling adds no blur: a hard edge is 0.7 px soft, and half a texel shows.
 */
export function photoshopComputedTipSpan(diameter: number, hardness: number): number {
  let r = diameter / 2 * 0.5;
  while (photoshopComputedTipAlpha(r, diameter, hardness) > 0) r += 0.05;
  return (2 * Math.ceil(r + 1)) / diameter;
}

/**
 * A computed tip spanning `span` diameters of `diameter` px, dark is paint: a texel a pixel, or `max` texels across
 * when that's fewer.
 */
export function drawPhotoshopComputedTip(diameter: number, hardness: number, span: number, max: number): { size: number; pixels: Uint8Array } {
  const size = Math.max(2, Math.min(max, Math.round(span * diameter)));
  const pixels = new Uint8Array(size * size), half = size / 2, px = (span * diameter) / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      pixels[y * size + x] = Math.round(255 * (1 - photoshopComputedTipAlpha(Math.hypot(x + 0.5 - half, y + 0.5 - half) * px, diameter, hardness)));
    }
  }
  return { size, pixels };
}
