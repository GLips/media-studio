// photoshop-bristle.ts: Photoshop's bristle tip (dBrush) as bristles pressed into the paper (StampBristleTip), which a
// renderer draws at the diameter it paints at. Fitted by vid-105's bristle research to posed lines, and by vid-113's
// to Photoshop's bristles at 13 and 100 px: a bristle's mark is about 2 px wide at both, with as many bristles, and
// only where they sit scales with the diameter. docs/photoshop-capture.md has the model.
//
// Negative space: no stroke history. A low stiffness's splay that builds along a stroke, and the start of a stroke's
// deformation, aren't drawn; clumping is unread (0.25 in every capture).

import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampBristleTip } from '#lib/paint/brush/models/stamp-bristle-tip.ts';
import type { PhotoshopKnownTip } from './photoshop-preset.ts';

export type PhotoshopBristleTip = Extract<PhotoshopKnownTip, { kind: 'bristle' }>;

/**
 * Per shape code, the footprint's width across the stroke in diameters, from posed lines at full pressure: 0 round
 * point, 1 round blunt, 2 round curve, 3 round angle, 4 round fan, 5 to 9 the same flat.
 */
const FOOTPRINT_WIDTH = [0.5, 0.95, 0.97, 0.9, 1.6, 0.74, 1.04, 1.0, 1.05, 2.85];
const isFlat = (shape: number) => shape >= 5;

const BRISTLE = {
  /** Bristles: countPerDensity × density × (1 + countGrowth × density), so a dense tip packs in more. */
  countPerDensity: 100, countGrowth: 5.05,
  /** A flat tip's depth along the stroke, in diameters: its bristles stand in about a line. */
  flatDepth: 0.0075,
  /** A bristle's radius: radius0 pixels at any diameter, and radius1 × thickness diameters. */
  radius0: 1.15, radius1: 0.282,
  /** A bristle's contact rises to its rim by flattenK / (length + flattenLen) × (0.5 + stiffness). */
  flattenK: 0.425, flattenLen: 0.214,
  /** A point touches later away from its axis, by ρ^γ round and |u|^γ flat. */
  pointGammaRound: 26.6, pointGammaFlat: 5.07,
  /** A curve's rim and an angle's far side touch later. */
  curveSpread: 0.626, angleSpread: 0.643,
  /** Every bristle's first contact: base + jitter × a uniform draw + edge × ρ². */
  contactBase: 0.194, contactJitter: 0.936, edgeContact: 0.0013,
  /**
   * A laid bristle's disc reaches lay × length × (1 − stiffness) diameters further, touching from layBase + laySt ×
   * stiffness, rising by layK to its rim.
   */
  lay: 0.0236, layBase: 1.2, laySt: 0.583, layK: 0.0996,
  /** The touch ramp's width in pressure. */
  softness: 1.91,
};

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

/** The tip as the studio reads it: its bristles, each placed and given its contact from the preset's settings. */
export function photoshopBristleStampTip(tip: PhotoshopBristleTip): StampBristleTip {
  const across = FOOTPRINT_WIDTH[tip.shape], along = isFlat(tip.shape) ? BRISTLE.flatDepth : across;
  const random = seededRandom(['bristle', tip.shape, tip.density, tip.length, tip.thickness, tip.stiffness].join('|'));
  const count = Math.max(1, Math.round(BRISTLE.countPerDensity * tip.density * (1 + BRISTLE.countGrowth * tip.density)));
  const bristles = Array.from({ length: count }, (): [number, number, number] => {
    let u: number, v: number;
    do {
      u = 2 * random() - 1;
      v = 2 * random() - 1;
    } while (u * u + v * v > 1);
    return [v, u, firstContact(tip.shape, u, v, random())];
  });
  const reach = BRISTLE.lay * tip.length * (1 - tip.stiffness);
  return {
    along, across, bristles,
    radius: { pixels: BRISTLE.radius0, diameters: BRISTLE.radius1 * tip.thickness },
    rise: (BRISTLE.flattenK / (tip.length + BRISTLE.flattenLen)) * (0.5 + tip.stiffness),
    ...(reach > 0 && { laid: { reach, from: BRISTLE.layBase + BRISTLE.laySt * tip.stiffness, rise: BRISTLE.layK } }),
    softness: BRISTLE.softness,
  };
}
