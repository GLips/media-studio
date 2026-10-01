// stamp-light-lift.ts: how linear light (an outside layer, three.js's) enters a pigment painting, which holds
// reflectance in bands (paint-spectrum.ts): three spectra, one per linear sRGB channel, scaled by a pixel's colour and
// summed: linear, so premultiplied stays premultiplied.
//
// Worked out from the bands' own display conversion (M), clean room: M·B = I exactly, so a lifted colour shows as
// itself; summing to 1 in every band, so white lifts to a flat 1; the smoothest such, pulled toward 0..1.
//
// Warning: no three spectra within 0..1 do it over eight bands (the nearest miss red and green by 5–8%): a saturated
// primary lifts a little past 0..1 (±0.12 at full green), shown exactly, read clamped by a glaze over it.

import type { PaintBands } from '#lib/paint/materials/models/paint-spectrum.ts';

/** How far a lift spectrum is pulled toward 0..1 where it strays, against its roughness (weighted 1). */
const STAMP_LIGHT_LIFT_STRAY_WEIGHT = 1000;

/** Each linear sRGB channel's spectrum over `bands`, red, green and blue: a colour (r, g, b) lifts to r·R + g·G + b·B. */
export type StampLightLiftBasis = readonly [Float64Array, Float64Array, Float64Array];

/**
 * The lift basis for `bands`. Blue is 1 less red and green, so the sum is 1 by construction; red and green are solved
 * for (M·red = (1,0,0), M·green = (0,1,0), blue's then holding by M's rows summing to 1), minimising roughness (second
 * differences) plus the stray past 0..1, an active set re-solved until it holds.
 */
export function stampLightLiftBasis(bands: PaintBands): StampLightLiftBasis {
  const n = bands.count, M = bands.toLinearRgb;
  // Unknowns: red's n bands, then green's; blue = 1 − red − green.
  const N = 2 * n;
  const blueOf = (x: readonly number[]) => Array.from({ length: n }, (_, k) => 1 - x[k] - x[n + k]);
  // Each spectrum value as an affine function of the unknowns: coefficients and a constant.
  const value = (c: 0 | 1 | 2, k: number): { at: [number, number][]; constant: number } => (c === 2
    ? { at: [[k, -1], [n + k, -1]], constant: 1 }
    : { at: [[c * n + k, 1]], constant: 0 });
  let stray = new Map<string, number>();
  let x: number[] = [];
  for (let round = 0; round < 64; round++) {
    // ½xᵀQx + qᵀx, from Σ (affine)² terms.
    const Q = Array.from({ length: N }, () => Array.from({ length: N }, () => 0)), q = Array.from({ length: N }, () => 0);
    const square = (terms: { at: [number, number][]; constant: number }, weight: number) => {
      for (const [i, a] of terms.at) {
        q[i] += weight * a * terms.constant;
        for (const [j, b] of terms.at) Q[i][j] += weight * a * b;
      }
    };
    for (const c of [0, 1, 2] as const) {
      for (let k = 1; k < n - 1; k++) {
        const [a, b, d] = [value(c, k - 1), value(c, k), value(c, k + 1)];
        square({ at: [...a.at, ...b.at.map(([i, w]): [number, number] => [i, -2 * w]), ...d.at], constant: a.constant - 2 * b.constant + d.constant }, 1);
      }
      for (let k = 0; k < n; k++) {
        const toward = stray.get(`${c},${k}`);
        if (toward !== undefined) {
          const v = value(c, k);
          square({ at: v.at, constant: v.constant - toward }, STAMP_LIGHT_LIFT_STRAY_WEIGHT);
        }
      }
    }
    for (let i = 0; i < N; i++) Q[i][i] += 1e-9;
    // KKT: [Q Aᵀ; A 0][x; λ] = [−q; e], A rows M·red = (1,0,0) and M·green = (0,1,0).
    const A: number[][] = [], e: number[] = [];
    for (const c of [0, 1]) {
      for (let r = 0; r < 3; r++) {
        A.push(Array.from({ length: N }, (_, i) => (i >= c * n && i < (c + 1) * n ? M[r][i - c * n] : 0)));
        e.push(r === c ? 1 : 0);
      }
    }
    const size = N + A.length;
    const kkt = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (__, j) => {
      if (i < N && j < N) return Q[i][j];
      if (i >= N && j < N) return A[i - N][j];
      if (i < N && j >= N) return A[j - N][i];
      return 0;
    }));
    x = solveLinear(kkt, [...q.map((v) => -v), ...e]).slice(0, N);
    const spectra = [x.slice(0, n), x.slice(n), blueOf(x)];
    const next = new Map(stray);
    spectra.forEach((spectrum, c) => spectrum.forEach((v, k) => {
      if (v < 0) next.set(`${c},${k}`, 0);
      else if (v > 1) next.set(`${c},${k}`, 1);
    }));
    if (next.size === stray.size) break;
    stray = next;
  }
  return [Float64Array.from(x.slice(0, n)), Float64Array.from(x.slice(n)), Float64Array.from(blueOf(x))];
}

/** Solves `a`·x = `b` by Gaussian elimination with partial pivoting. */
function solveLinear(a: readonly (readonly number[])[], b: readonly number[]): number[] {
  const rows = a.map((row, i) => [...row, b[i]]), size = rows.length;
  for (let c = 0; c < size; c++) {
    let pivot = c;
    for (let r = c + 1; r < size; r++) if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot = r;
    [rows[c], rows[pivot]] = [rows[pivot], rows[c]];
    for (let r = 0; r < size; r++) {
      if (r === c) continue;
      const f = rows[r][c] / rows[c][c];
      for (let k = c; k <= size; k++) rows[r][k] -= f * rows[c][k];
    }
  }
  return rows.map((row, i) => row[size] / row[i]);
}
