// paint-spectrum.ts: the bands paint is mixed in, and the way between them and the screen's colours.
//
// Paint mixes per band of light (paint-kubelka-munk.ts): contiguous bands across 380–730 nm. Three linear sRGB channels
// would be cheaper, but mix blue and yellow to a dull grey-green; eight bands read green (vid-109). The engine paints
// in PAINT_BANDS; everything above this module is written for any number of bands.
//
// A colour becomes a spectrum by the smoothest curve that looks like it (Jakob & Hanika 2019: a sigmoid of a
// quadratic, fitted in CIELAB). Real paints' spectra are smooth, so it's the likeliest curve for that colour.

import { PAINT_CIE_1931_XYZ, PAINT_CIE_D65, PAINT_CIE_WAVELENGTHS } from './paint-cie-1931.ts';

/** A value per band: a reflectance, an absorption or a scattering. */
export type PaintBandValues = Float64Array;

export type PaintBands = {
  count: number;
  /** Linear sRGB of a reflectance of 1 in each band and 0 elsewhere: a row per channel, a column per band. */
  toLinearRgb: readonly [Float64Array, Float64Array, Float64Array];
  /**
   * The smallest per-band change that moves a spectrum's colour by one unit of each linear channel (a column per
   * channel): what corrects a spectrum to a colour exactly without changing its shape much.
   */
  correctionBasis: readonly [Float64Array, Float64Array, Float64Array];
  /** The smooth reflectance a linear sRGB colour most likely has, averaged into these bands. */
  reflectanceOf: (linearRgb: readonly number[]) => PaintBandValues;
  /** A quantity sampled at PAINT_CIE_WAVELENGTHS averaged into these bands. */
  averageFine: (fine: ArrayLike<number>) => PaintBandValues;
};

const SRGB_FROM_XYZ = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
] as const;

const FINE = PAINT_CIE_WAVELENGTHS.length;

/**
 * Linear sRGB of a reflectance of 1 at each fine wavelength under D65, scaled per channel so a perfect white is exactly
 * (1, 1, 1): the tables' white lands a hair off sRGB's, and paper must stay the colour it was written as.
 */
const FINE_TO_RGB: readonly Float64Array[] = (() => {
  const yWhite = PAINT_CIE_1931_XYZ.reduce((sum, [, y], i) => sum + y * PAINT_CIE_D65[i], 0);
  const rows = SRGB_FROM_XYZ.map((m) => Float64Array.from(PAINT_CIE_1931_XYZ, ([x, y, z], i) => ((m[0] * x + m[1] * y + m[2] * z) * PAINT_CIE_D65[i]) / yWhite));
  return rows.map((row) => row.map((v) => v / row.reduce((a, b) => a + b, 0)));
})();

/** Linear sRGB of a spectrum sampled at PAINT_CIE_WAVELENGTHS. */
export function paintFineSpectrumToLinearRgb(fine: ArrayLike<number>): [number, number, number] {
  // SAFETY: FINE_TO_RGB has a row per sRGB channel, three.
  return FINE_TO_RGB.map((row) => row.reduce((sum, w, i) => sum + w * fine[i], 0)) as [number, number, number];
}

export const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** A `#rrggbb` colour's linear sRGB. */
export function paintHexToLinear(hex: string): [number, number, number] {
  // SAFETY: three offsets, one per channel.
  return [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
}

/** Linear sRGB as `#rrggbb`, each channel held to 0..1. */
export function paintLinearToHex(rgb: readonly number[]): `#${string}` {
  return `#${rgb.map((v) => Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// CIELAB (D65), the space the upsampling fits in: equal steps there are about equally visible.
const WHITE_XYZ = [0.95047, 1, 1.08883];
const XYZ_FROM_SRGB = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];
const labCompand = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
/** CIELAB (D65) of a linear sRGB colour. */
export function paintLinearToLab(rgb: readonly number[]): [number, number, number] {
  const [x, y, z] = XYZ_FROM_SRGB.map((m, i) => labCompand((m[0] * rgb[0] + m[1] * rgb[1] + m[2] * rgb[2]) / WHITE_XYZ[i]));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIE76 distance between two linear sRGB colours: about 1 is the smallest difference a viewer sees side by side. */
export function paintDeltaE(a: readonly number[], b: readonly number[]): number {
  const [p, q] = [paintLinearToLab(a), paintLinearToLab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const sigmoid = (x: number) => 0.5 + x / (2 * Math.sqrt(1 + x * x));
function sigmoidSpectrum(c: readonly number[]): Float64Array {
  return Float64Array.from(PAINT_CIE_WAVELENGTHS, (_, i) => {
    const t = i / (FINE - 1);
    return sigmoid(c[0] * t * t + c[1] * t + c[2]);
  });
}

/**
 * The smooth reflectance (sampled at PAINT_CIE_WAVELENGTHS) whose colour is `linearRgb`: Levenberg–Marquardt on the
 * sigmoid's three coefficients, minimising the CIELAB error. A colour a reflectance can't reach (brighter than white)
 * comes back as the nearest it can.
 */
export function paintUpsampleReflectance(linearRgb: readonly number[]): Float64Array {
  const target = paintLinearToLab(linearRgb.map((v) => Math.min(1, Math.max(0, v))));
  const residual = (c: readonly number[]) => {
    const lab = paintLinearToLab(paintFineSpectrumToLinearRgb(sigmoidSpectrum(c)));
    return lab.map((v, i) => v - target[i]);
  };
  let best: number[] = [0, 0, 0], bestError = Infinity;
  // A few starts, from grey and from each end of the spectrum: saturated colours sit far from grey's basin.
  for (const start of [[0, 0, 0], [0, 0, 3], [0, 0, -3], [-20, 20, -3], [20, -20, 3]]) {
    let c = [...start], r = residual(c), error = r.reduce((s, v) => s + v * v, 0), lambda = 1e-3;
    for (let step = 0; step < 200 && error > 1e-8; step++) {
      const jacobian = [0, 1, 2].map((k) => {
        const h = 1e-5 * Math.max(1, Math.abs(c[k]));
        const moved = [...c];
        moved[k] += h;
        return residual(moved).map((v, i) => (v - r[i]) / h);
      });
      // (JᵀJ + λ diag(JᵀJ)) δ = −Jᵀr
      const jtj = [0, 1, 2].map((a) => [0, 1, 2].map((b) => jacobian[a].reduce((s, v, i) => s + v * jacobian[b][i], 0)));
      const jtr = [0, 1, 2].map((a) => jacobian[a].reduce((s, v, i) => s + v * r[i], 0));
      const system = jtj.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
      const delta = solve3(system, jtr.map((v) => -v));
      const tried = c.map((v, k) => v + delta[k]);
      const triedR = residual(tried), triedError = triedR.reduce((s, v) => s + v * v, 0);
      if (triedError < error) {
        c = tried; r = triedR; error = triedError; lambda = Math.max(1e-7, lambda / 3);
      } else {
        lambda *= 4;
        if (lambda > 1e8) break;
      }
    }
    if (error < bestError) { best = c; bestError = error; }
    if (bestError < 1e-4) break;
  }
  return sigmoidSpectrum(best);
}

const det3 = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
function solve3(m: number[][], v: number[]): number[] {
  const d = det3(m);
  return [0, 1, 2].map((k) => det3(m.map((row, i) => row.map((x, j) => (j === k ? v[i] : x)))) / d);
}

/** Linear sRGB of a spectrum in `bands`. */
export function paintBandsToLinearRgb(bands: PaintBands, values: ArrayLike<number>): [number, number, number] {
  // SAFETY: toLinearRgb is a three-row tuple, a row per channel.
  return bands.toLinearRgb.map((row) => row.reduce((sum, w, b) => sum + w * values[b], 0)) as [number, number, number];
}

/** A spectrum `values` in `bands` moved by the least it takes to read exactly as `linearRgb`. */
export function paintCorrectedToColor(bands: PaintBands, values: PaintBandValues, linearRgb: readonly number[]): PaintBandValues {
  const now = paintBandsToLinearRgb(bands, values);
  return values.map((v, b) => v + bands.correctionBasis.reduce((sum, column, c) => sum + column[b] * (linearRgb[c] - now[c]), 0));
}

/** `count` contiguous bands across 380–730 nm, as even as 36 samples divide. */
export function spectralPaintBands(count: number): PaintBands {
  const edges = Array.from({ length: count + 1 }, (_, b) => Math.round((b * FINE) / count));
  const bandOf = (fine: ArrayLike<number>) => Float64Array.from({ length: count }, (_, b) => {
    let sum = 0;
    for (let i = edges[b]; i < edges[b + 1]; i++) sum += fine[i];
    return sum / (edges[b + 1] - edges[b]);
  });
  const summedIntoBands = (row: Float64Array) => Float64Array.from({ length: count }, (_, b) => {
    let sum = 0;
    for (let i = edges[b]; i < edges[b + 1]; i++) sum += row[i];
    return sum;
  });
  const toLinearRgb: PaintBands['toLinearRgb'] = [summedIntoBands(FINE_TO_RGB[0]), summedIntoBands(FINE_TO_RGB[1]), summedIntoBands(FINE_TO_RGB[2])];
  // The minimum-norm right inverse, Mᵀ(MMᵀ)⁻¹: a correction shaped like the colour matching functions themselves.
  const mmt = [0, 1, 2].map((a) => [0, 1, 2].map((c) => toLinearRgb[a].reduce((s, v, b) => s + v * toLinearRgb[c][b], 0)));
  const inverse = invert3(mmt);
  const correctionColumn = (c: number) => Float64Array.from({ length: count }, (_, b) => [0, 1, 2].reduce((s, a) => s + toLinearRgb[a][b] * inverse[a][c], 0));
  const correctionBasis: PaintBands['correctionBasis'] = [correctionColumn(0), correctionColumn(1), correctionColumn(2)];
  const bands: PaintBands = {
    count, toLinearRgb, correctionBasis, averageFine: bandOf,
    // Averaging a curve into wide bands moves its colour a little; the correction puts it back where it was written.
    reflectanceOf: (rgb) => paintCorrectedToColor(bands, bandOf(paintUpsampleReflectance(rgb)), rgb).map((v) => Math.min(1, Math.max(0, v))),
  };
  return bands;
}

function invert3(m: number[][]): number[][] {
  return [0, 1, 2].map((c) => solve3(m, [0, 1, 2].map((r) => (r === c ? 1 : 0)))).reduce<number[][]>((rows, column, c) => {
    column.forEach((v, r) => { (rows[r] ??= [])[c] = v; });
    return rows;
  }, []);
}

/**
 * The bands the engine paints in: eight, the fewest that keep realistic pigments' mixes clean (vid-109; pure sRGB
 * primaries need sixteen, but no paint is that sharp).
 */
export const PAINT_BANDS: PaintBands = spectralPaintBands(8);
