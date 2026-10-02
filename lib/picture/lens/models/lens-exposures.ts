// lens-exposures.ts: where a frame's exposures sample the shutter, aperture, pixel and a light's disc. The pattern
// depends only on the count, so a still scene doesn't shimmer. The aperture is apodised: its samples fall as a 2D
// standard normal, so a flat plane averaged over them blurs by the fast path's gaussian.

/**
 * One exposure of `count`. `shutter`: its moment, a share of the open shutter (lens-shutter.ts), stratified.
 * `aperture`: its point on the lens in standard deviations, frame axes (x right, y down). `pixel`: its sub-pixel
 * offset, px, −½..½. `light`: its point on a unit disc, for a soft light's source.
 */
export type LensExposure = {
  readonly index: number;
  readonly count: number;
  readonly shutter: number;
  readonly aperture: readonly [number, number];
  readonly pixel: readonly [number, number];
  readonly light: readonly [number, number];
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * `count` exposures: stratified shutter shares, a golden-angle spiral over the aperture (radius by the inverse
 * Rayleigh, so its density is the normal's), Halton pixel offsets, a uniform spiral over the light. The spirals are
 * walked in strides coprime to the count so no moment tracks a place on the lens: else a moving, defocused edge
 * smears sharp at one end.
 */
export function lensExposures(count: number): LensExposure[] {
  if (!(Number.isInteger(count) && count >= 1)) throw new Error(`lens: a frame takes a whole number of exposures, 1 or more, not ${count}`);
  if (count === 1) return [{ index: 0, count, shutter: 0.5, aperture: [0, 0], pixel: [0, 0], light: [0, 0] }];
  const spiral = (j: number, radius: (u: number) => number): [number, number] => {
    const r = radius((j + 0.5) / count), a = j * GOLDEN_ANGLE;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  const lensStride = coprimeNear(count, 0.618), lightStride = coprimeNear(count, 0.382);
  return Array.from({ length: count }, (_, k) => ({
    index: k,
    count,
    shutter: (k + 0.5) / count,
    aperture: spiral((k * lensStride) % count, normalRadius),
    pixel: [halton(k + 1, 2) - 0.5, halton(k + 1, 3) - 0.5],
    light: spiral((k * lightStride + 1) % count, Math.sqrt),
  }));
}

const normalRadius = (u: number) => Math.sqrt(-2 * Math.log(1 - u));
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

function coprimeNear(n: number, share: number) {
  const want = Math.max(1, Math.round(n * share));
  for (let d = 0; d < n; d++) for (const s of [want + d, want - d]) if (s >= 1 && s < n && gcd(s, n) === 1) return s;
  return 1;
}

function halton(i: number, base: number) {
  let f = 1, r = 0;
  for (; i > 0; i = Math.floor(i / base)) {
    f /= base;
    r += f * (i % base);
  }
  return r;
}
