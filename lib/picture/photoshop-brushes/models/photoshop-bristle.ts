// photoshop-bristle.ts: Photoshop's bristle tip (dBrush) as a pressed tip, fitted by vid-105's bristle research to
// posed lines (66 lines, row rms 0.20; Photoshop against itself at two sizes, 0.14). docs/photoshop-capture.md has the
// model. The image is drawn along the stroke (x) and across it (y), for a layer turned to the first heading.
//
// Negative space: no stroke history. A low stiffness's splay that builds along a stroke, and the start of a stroke's
// deformation, aren't drawn; clumping is unread (0.25 in every capture).

import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampBrushTip } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import type { PhotoshopKnownTip } from './photoshop-preset.ts';

export type PhotoshopBristleTip = Extract<PhotoshopKnownTip, { kind: 'bristle' }>;

/**
 * Per shape code, the footprint's width across the stroke in diameters, from posed lines at full pressure: 0 round
 * point, 1 round blunt, 2 round curve, 3 round angle, 4 round fan, 5 to 9 the same flat.
 */
const FOOTPRINT_WIDTH = [0.5, 0.95, 0.97, 0.9, 1.6, 0.74, 1.04, 1.0, 1.05, 2.85];
const isFlat = (shape: number) => shape >= 5;

const BRISTLE = {
  /** Bristles per unit density: the stamps show about 100 × density marks, overlapping bristles merged. */
  countPerDensity: 234,
  /** A flat tip's depth along the stroke, in diameters. */
  flatDepth: 0.13,
  /** A bristle's radius, (radius0 + radius1 × thickness) × 100 × (d / 100)^radiusExp px: bristles don't scale with d. */
  radius0: 0.005, radius1: 0.28, radiusExp: 0.86,
  /** A bristle's contact rises to its rim by flattenK / (length + flattenLen) × (0.5 + stiffness). */
  flattenK: 0.32, flattenLen: 0.22,
  /** A point touches later away from its axis, by ρ^γ round and |u|^γ flat. */
  pointGammaRound: 3.57, pointGammaFlat: 1.72,
  /** A curve's rim and an angle's far side touch later. */
  curveSpread: 0.68, angleSpread: 0.64,
  /** Every bristle's first contact: base + jitter × a uniform draw + edge × ρ². */
  contactBase: 0.2, contactJitter: 0.19, edgeContact: 0.083,
  /**
   * A laid bristle's disc reaches lay0 × 100 × (d / 100)^radiusExp × length × (1 − stiffness) further, touching from
   * layBase + laySt × stiffness, rising by layK to its rim.
   */
  lay0: 0.044, layBase: 0.71, laySt: 0.73, layK: 0.2,
  /** The touch ramp's width in pressure. */
  softness: 1.83,
};
/** The contact range the contact image holds: every bristle touches within it, and an empty texel reads its top. */
const CONTACT_RANGE = [0, 2] as const;
/** Subsamples per texel axis. */
const SUBSAMPLES = 4;

/** A bristle's first contact from its place (u across, v along, both −1..1) and a uniform draw. */
function firstContact(shape: number, u: number, v: number, draw: number): number {
  const r = Math.hypot(u, v), base = BRISTLE.contactBase + draw * BRISTLE.contactJitter + BRISTLE.edgeContact * r * r;
  if (shape === 0) return base + r ** BRISTLE.pointGammaRound;
  if (shape === 5) return base + Math.abs(u) ** BRISTLE.pointGammaFlat;
  if (shape === 2) return base + BRISTLE.curveSpread * r * r;
  if (shape === 7) return base + BRISTLE.curveSpread * u * u;
  if (shape === 3 || shape === 8) return base + (BRISTLE.angleSpread * (u + 1)) / 2;
  return base;
}

/** The footprint's size in pixels at the preset's diameter: along the stroke, across it, and the square image's side. */
function footprint(tip: PhotoshopBristleTip) {
  const d = tip.geometry.diameter, across = FOOTPRINT_WIDTH[tip.shape] * d, along = isFlat(tip.shape) ? BRISTLE.flatDepth * d : across;
  const scale = 100 * (d / 100) ** BRISTLE.radiusExp;
  const radius = Math.max(0.35, (BRISTLE.radius0 + BRISTLE.radius1 * tip.thickness) * scale);
  const laid = radius + BRISTLE.lay0 * scale * tip.length * (1 - tip.stiffness);
  return { across, along, radius, laid, side: Math.ceil(Math.max(along, across) + 2 * laid + 3) };
}

/**
 * The tip's footprint and contact image, `size` texels square (its pixels at the preset's diameter, at most `max`),
 * dark is paint in both, x along the stroke. A texel's paint is the share of it bristles cover; its contact, the
 * mean of their lowest contacts over it.
 */
export function drawPhotoshopBristleTip(tip: PhotoshopBristleTip, max: number): { size: number; image: Uint8Array; contact: Uint8Array } {
  const { across, along, radius, laid, side } = footprint(tip);
  const size = Math.min(max, side), texel = side / size, n = size * SUBSAMPLES;
  const stiffening = (BRISTLE.flattenK / (tip.length + BRISTLE.flattenLen)) * (0.5 + tip.stiffness);
  const layFrom = BRISTLE.layBase + BRISTLE.laySt * tip.stiffness;
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
  // Bristle centres stay a bristle's radius inside the footprint.
  const halfAcross = Math.max(0, across / 2 - radius), halfAlong = Math.max(0, along / 2 - radius);
  const random = seededRandom(['bristle', tip.shape, tip.density, tip.length, tip.thickness, tip.stiffness].join('|'));
  const count = Math.max(1, Math.round(BRISTLE.countPerDensity * tip.density));
  for (let i = 0; i < count; i++) {
    let u: number, v: number;
    do {
      u = 2 * random() - 1;
      v = 2 * random() - 1;
    } while (u * u + v * v > 1);
    const first = firstContact(tip.shape, u, v, random()), bx = side / 2 + v * halfAlong, by = side / 2 + u * halfAcross;
    disc(bx, by, radius, first, stiffening);
    if (laid > radius) disc(bx, by, laid, Math.max(first, layFrom), BRISTLE.layK);
  }
  const [lo, hi] = CONTACT_RANGE, image = new Uint8Array(size * size), contact = new Uint8Array(size * size);
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

/** The tip as the studio reads it, its images `image` and `contact`: its span is its image's side over its diameter. */
export function photoshopBristleStampTip<Image>(tip: PhotoshopBristleTip, image: Image, contact: Image): Pick<StampBrushTip<Image>, 'image' | 'span' | 'pressed'> {
  return { image, span: footprint(tip).side / tip.geometry.diameter, pressed: { contact, range: CONTACT_RANGE, softness: BRISTLE.softness } };
}
