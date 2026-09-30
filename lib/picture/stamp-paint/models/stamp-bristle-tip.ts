// stamp-bristle-tip.ts: a tip of bristles, drawn at the diameter each deposit paints it at, since a bristle is as
// many pixels wide on a small brush as a big one (vid-113's bristle probes). Images run along the stroke (x).

/**
 * Bristles in a footprint `along` × `across` diameters, each a disc `radius.pixels` plus `radius.diameters` wide, at a
 * place (−1..1 along and across) with its own contact, touching `rise` later at its rim. `laid`: past `from`, a bristle
 * lays down as a disc `reach` diameters wider. A stamp at pressure p lays a texel as p passes its contact, over a ramp
 * `softness` wide (pressedTip).
 */
export type StampBristleTip = {
  along: number;
  across: number;
  radius: { pixels: number; diameters: number };
  rise: number;
  laid?: { reach: number; from: number; rise: number };
  bristles: readonly (readonly [along: number, across: number, contact: number])[];
  softness: number;
};

/** The contacts a bristle tip's contact image holds: every bristle touches within it, and an empty texel reads its top. */
export const STAMP_BRISTLE_CONTACT_RANGE = [0, 2] as const;

/** The most texels a side a bristle tip is drawn in; past it, a texel covers more than a pixel. */
export const STAMP_BRISTLE_TIP_MAX = 1024;

/** Subsamples per texel axis. */
const SUBSAMPLES = 4;

/** Each bristle's own disc and its laid one, in pixels at `diameter`. */
function bristleRadii(tip: StampBristleTip, diameter: number) {
  const radius = tip.radius.pixels + tip.radius.diameters * diameter;
  return { radius, laid: radius + (tip.laid ? tip.laid.reach * diameter : 0) };
}

/** The side of the square a bristle tip is drawn in at `diameter`, in pixels: its footprint and a laid bristle's reach past it. */
function bristleTipSide(tip: StampBristleTip, diameter: number): number {
  return Math.ceil(Math.max(tip.along, tip.across) * diameter + 2 * bristleRadii(tip, diameter).laid + 3);
}

/** How many diameters wide a bristle tip's images are at `diameter`: its span (StampImageTip's). */
export const stampBristleTipSpan = (tip: StampBristleTip, diameter: number) => bristleTipSide(tip, diameter) / diameter;

/**
 * The tip's footprint and contact images at `diameter`, `size` texels square (its pixels, at most `max`), dark is
 * paint in both. A texel's paint is the share of it bristles cover; its contact, the mean of their lowest contacts
 * over it, read down from the contact range's top (STAMP_BRISTLE_CONTACT_RANGE).
 */
export function drawStampBristleTip(tip: StampBristleTip, diameter: number, max = STAMP_BRISTLE_TIP_MAX): { size: number; image: Uint8Array; contact: Uint8Array } {
  const side = bristleTipSide(tip, diameter), { radius, laid } = bristleRadii(tip, diameter);
  const size = Math.min(max, side), texel = side / size, n = size * SUBSAMPLES;
  const lowest = new Float32Array(n * n).fill(Infinity);
  /** A disc of contacts `from` at its centre, rising by `rise` to its rim, in pixels. */
  const disc = (bx: number, by: number, r: number, from: number, rise: number) => {
    const k = SUBSAMPLES / texel, x0 = Math.max(0, Math.floor((bx - r) * k)), x1 = Math.min(n - 1, Math.ceil((bx + r) * k));
    const y0 = Math.max(0, Math.floor((by - r) * k)), y1 = Math.min(n - 1, Math.ceil((by + r) * k));
    for (let sy = y0; sy <= y1; sy++) {
      for (let sx = x0; sx <= x1; sx++) {
        const rho = Math.hypot((sx + 0.5) / k - bx, (sy + 0.5) / k - by) / r;
        if (rho <= 1) lowest[sy * n + sx] = Math.min(lowest[sy * n + sx], from + rise * rho);
      }
    }
  };
  const halfAlong = Math.max(0, (tip.along * diameter) / 2 - radius), halfAcross = Math.max(0, (tip.across * diameter) / 2 - radius);
  for (const [v, u, contact] of tip.bristles) {
    const bx = side / 2 + v * halfAlong, by = side / 2 + u * halfAcross;
    disc(bx, by, radius, contact, tip.rise);
    if (tip.laid && laid > radius) disc(bx, by, laid, Math.max(contact, tip.laid.from), tip.laid.rise);
  }
  const [lo, hi] = STAMP_BRISTLE_CONTACT_RANGE, image = new Uint8Array(size * size), contact = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let covered = 0, sum = 0;
      for (let j = 0; j < SUBSAMPLES; j++) {
        for (let i = 0; i < SUBSAMPLES; i++) {
          const c = lowest[(y * SUBSAMPLES + j) * n + x * SUBSAMPLES + i];
          if (c !== Infinity) {
            covered++;
            sum += c;
          }
        }
      }
      image[y * size + x] = Math.round(255 * (1 - covered / SUBSAMPLES ** 2));
      const touches = covered ? sum / covered : hi;
      contact[y * size + x] = Math.round(255 * (1 - Math.min(1, Math.max(0, (hi - touches) / (hi - lo)))));
    }
  }
  return { size, image, contact };
}
