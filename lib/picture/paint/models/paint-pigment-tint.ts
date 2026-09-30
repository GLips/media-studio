// paint-pigment-tint.ts: a pigment's absorption and scattering held to a pale tint as well as its full swatch.
//
// A full swatch alone upsamples to the smoothest spectrum of its colour. For a dark, saturated paint (the phthalos,
// ultramarine) that spectrum is broad, so its thin washes grey where the real paint's stay vivid: one colour can't
// say how sharp the spectrum is, a tint can. So the per-band K and S are corrected, as little and as smoothly as
// the bands allow, until a unit film reproduces the swatch over white and over black and a thin film the tint.

import { kubelkaMunkFilm, kubelkaMunkOver } from './paint-kubelka-munk.ts';
import { paintBandsToLinearRgb, paintHexToLinear, paintLinearToLab, type PaintBands, type PaintBandValues } from './paint-spectrum.ts';

/** What the fit holds to: PaintPigmentAppearance's swatches and tint, as colours. */
type PaintPigmentTintInput = { overWhite: string; overBlack: string; tint: { color: string; strength: number } };

// Over black weighs double: scattering alone sets it, so it costs the other two little, and left loose the solve
// wanders into a scattering film that greys the tint.
const OVER_BLACK_WEIGHT = 2;
// On the correction's second difference per band (log K, log S), and its size: a smooth, small change of shape.
const SMOOTHNESS = 3;
const ANCHOR = 0.05;
// Log K and log S stay here: past them a band is clear or opaque and moving it changes nothing.
const LOG_LOW = -14, LOG_HIGH = 8;

/** Gaussian elimination with partial pivoting: the LM step's small normal equations. */
function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length, m = matrix.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    for (let r = c + 1; r < n; r++) {
      const k = m[r][c] / m[c][c];
      for (let j = c; j <= n; j++) m[r][j] -= k * m[c][j];
    }
  }
  const x = Array.from({ length: n }, () => 0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r][n];
    for (let j = r + 1; j < n; j++) sum -= m[r][j] * x[j];
    x[r] = sum / m[r][r];
  }
  return x;
}

const squared = (r: readonly number[]) => r.reduce((sum, v) => sum + v * v, 0);

/**
 * K and S starting from `start` (the swatch-only inversion), corrected by Levenberg–Marquardt on log K and log S so
 * a unit film matches `appearance` over white and black and a `tint.strength` film its tint, in CIELAB.
 */
export function paintPigmentTintedFit(appearance: PaintPigmentTintInput, start: { K: PaintBandValues; S: PaintBandValues }, bands: PaintBands): { K: PaintBandValues; S: PaintBandValues } {
  const n = bands.count;
  const origin = [...Array.from(start.K, Math.log), ...Array.from(start.S, Math.log)];
  const targets: [readonly number[], number, number][] = [
    [paintLinearToLab(paintHexToLinear(appearance.overWhite)), 1, 1],
    [paintLinearToLab(paintHexToLinear(appearance.overBlack)), 1, 0],
    [paintLinearToLab(paintHexToLinear(appearance.tint.color)), appearance.tint.strength, 1],
  ];
  const residual = (x: readonly number[]): number[] => {
    const out: number[] = [];
    targets.forEach(([lab, thickness, under], t) => {
      const R = Float64Array.from({ length: n }, (_, b) => kubelkaMunkOver(kubelkaMunkFilm({ absorb: thickness * Math.exp(x[b]), scatter: thickness * Math.exp(x[n + b]) }), under));
      const got = paintLinearToLab(paintBandsToLinearRgb(bands, R));
      for (let i = 0; i < 3; i++) out.push((t === 1 ? OVER_BLACK_WEIGHT : 1) * (got[i] - lab[i]));
    });
    const d = x.map((v, i) => v - origin[i]);
    for (const offset of [0, n]) for (let b = 1; b < n - 1; b++) out.push(SMOOTHNESS * (d[offset + b - 1] - 2 * d[offset + b] + d[offset + b + 1]));
    for (const v of d) out.push(ANCHOR * v);
    return out;
  };

  let x = [...origin], r = residual(x), error = squared(r), damping = 1e-2;
  for (let iteration = 0; iteration < 60; iteration++) {
    const h = 1e-5;
    const jacobian = x.map((_, k) => residual(x.map((v, i) => (i === k ? v + h : v))).map((v, i) => (v - r[i]) / h));
    const jtj = jacobian.map((a) => jacobian.map((b) => a.reduce((sum, v, i) => sum + v * b[i], 0)));
    const jtr = jacobian.map((a) => a.reduce((sum, v, i) => sum + v * r[i], 0));
    let improved = false;
    while (!improved && damping < 1e8) {
      const step = solveLinear(jtj.map((row, i) => row.map((v, j) => (i === j ? v * (1 + damping) + 1e-9 : v))), jtr.map((v) => -v));
      const tried = x.map((v, i) => Math.min(LOG_HIGH, Math.max(LOG_LOW, v + step[i])));
      const triedR = residual(tried), triedError = squared(triedR);
      if (triedError < error) {
        const gain = error - triedError;
        x = tried; r = triedR; error = triedError; damping = Math.max(1e-6, damping / 3); improved = true;
        if (gain < 1e-6 * error) return { K: Float64Array.from(x.slice(0, n), Math.exp), S: Float64Array.from(x.slice(n), Math.exp) };
      } else damping *= 5;
    }
    if (!improved) break;
  }
  return { K: Float64Array.from(x.slice(0, n), Math.exp), S: Float64Array.from(x.slice(n), Math.exp) };
}
