// paint-kubelka-munk.ts: how light meets a film of paint, per band (Kubelka–Munk). Every function here takes one
// band's numbers; callers map it over a PaintBands' values, on the CPU here and the same formulas in the renderer's
// WGSL (PAINT_KUBELKA_MUNK_WGSL).
//
// A film is described by how much it absorbs and scatters in total, K·x and S·x (its absorption and scattering
// coefficients times its thickness). That pair is all its reflectance and transmittance depend on, and paints mixed
// in one film simply add theirs: so mixing is addition, and a film carries no separate "thickness".
//
// Formulas: Curtis et al., *Computer-Generated Watercolor* (SIGGRAPH 1997) §4, after Kubelka & Munk (1931).

/** A film of paint in one band: total absorption and scattering, K·x and S·x. */
export type KubelkaMunkFilm = { absorb: number; scatter: number };

/** Below this much scattering a film is treated as a pure absorber, where the general formula divides by ~0. */
const CLEAR = 1e-6;
/**
 * Below this b·Sx (b = √(a² − 1)) the general formula is near 0/0, and f32 loses b² first. There sinh and cosh are
 * their first terms: R = Sx/(1 + Sx + Kx), T = 1/(1 + Sx + Kx), the pure scatterer's limit, off by about (b·Sx)²/6.
 */
const NEAR_WHITE = 1e-3;

/** The reflectance and transmittance of `film` on its own, lit from above. */
export function kubelkaMunkFilm({ absorb, scatter }: KubelkaMunkFilm): { R: number; T: number } {
  if (scatter < CLEAR) return { R: 0, T: Math.exp(-absorb) };
  const a = 1 + absorb / scatter, b = Math.sqrt(a * a - 1), bs = b * scatter;
  if (bs < NEAR_WHITE) return { R: scatter / (1 + scatter + absorb), T: 1 / (1 + scatter + absorb) };
  // For a thick film sinh and cosh overflow; their ratio doesn't.
  if (bs > 30) return { R: 1 / (a + b), T: 0 };
  const sinh = Math.sinh(bs), c = a * sinh + b * Math.cosh(bs);
  return { R: sinh / c, T: b / c };
}

/** Reflectance of a film too thick to see through, from its K/S alone: R∞ = 1 + K/S − √((K/S)² + 2K/S). */
export function kubelkaMunkOpaque(absorbOverScatter: number): number {
  const q = absorbOverScatter;
  return 1 + q - Math.sqrt(q * q + 2 * q);
}

/** The reflectance of a film with reflectance `R` and transmittance `T` laid over a surface reflecting `under`. */
export function kubelkaMunkOver({ R, T }: { R: number; T: number }, under: number): number {
  return R + (T * T * under) / (1 - R * under);
}

/**
 * The absorption and scattering (per unit thickness) of a paint that reflects `overWhite` over a perfect white and
 * `overBlack` over a perfect black at unit thickness (Curtis §4.1). Needs 0 < overBlack < overWhite < 1; the caller
 * holds its inputs there.
 */
export function kubelkaMunkFromAppearance(overWhite: number, overBlack: number): { K: number; S: number } {
  const a = 0.5 * (overWhite + (overBlack - overWhite + 1) / overBlack);
  const b = Math.sqrt(a * a - 1);
  const x = (b * b - (a - overWhite) * (a - 1)) / (b * (1 - overWhite));
  const S = (0.5 * Math.log((x + 1) / (x - 1))) / b;
  return { K: S * (a - 1), S };
}

/** The same formulas for the renderer: a film's R and T per band, packed four bands to a vec4. */
export const PAINT_KUBELKA_MUNK_WGSL = /* wgsl */ `
// A film's reflectance (xyzw) and transmittance, four bands at once, from its total absorption and scattering.
struct PaintFilm { R: vec4f, T: vec4f }
fn kubelkaMunkFilm(absorb: vec4f, scatter: vec4f) -> PaintFilm {
  let s = max(scatter, vec4f(${CLEAR}));
  let a = 1.0 + absorb / s;
  let b = sqrt(max(a * a - 1.0, vec4f(1e-12)));
  let bs = min(b * s, vec4f(30.0));
  let e = exp(bs);
  let sinh = 0.5 * (e - 1.0 / e);
  let cosh = 0.5 * (e + 1.0 / e);
  let c = a * sinh + b * cosh;
  let white = b * s < vec4f(${NEAR_WHITE});
  let clear = scatter < vec4f(${CLEAR});
  let R = select(select(sinh / c, s / (1.0 + s + absorb), white), vec4f(0.0), clear);
  let T = select(select(b / c, 1.0 / (1.0 + s + absorb), white), exp(-absorb), clear);
  return PaintFilm(R, T);
}
fn kubelkaMunkOver(film: PaintFilm, under: vec4f) -> vec4f {
  return film.R + film.T * film.T * under / max(1.0 - film.R * under, vec4f(1e-6));
}`;
