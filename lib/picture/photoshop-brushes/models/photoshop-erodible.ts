// photoshop-erodible.ts: Photoshop's erodible tip (dTips, dtipsType 0) as a pressed tip, unworn, fitted by vid-105's
// erodible research to the probes and Legacy's references.
//
// The footprint is the shape code's outline seen through a 2-pixel box: a 100 px square stamps 102 px. A texel of
// height h touches once the pen presses the tip a + b·p/D below its highest point H, so its contact pressure is
// (H − h − a)·D/b, D the painted diameter: a share of the height at no pressure, pixels per unit of pressure.
// Simulated hardness only sets how fast the tip wears.
//
// Negative space: no wear. The tip never changes along a stroke, and US 10,217,253 claims one that does.

import type { StampBrushTip } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import type { PhotoshopKnownTip } from './photoshop-preset.ts';

export type PhotoshopErodibleTip = Extract<PhotoshopKnownTip, { kind: 'erodible' }>;

/**
 * a: depth at no pressure, in the height map's units; b: pixels of depth at full pressure; softness: the touch ramp's
 * width in pressure. a and b trade off along a valley (0.036 and 3.0 to 0.048 and 1.5 fit about as well).
 */
const PRESS = { a: 0.042, b: 2.1, softness: 0.16 };
/**
 * The highest contact a contact image holds: past it a texel never touches, even on a stamp a quarter of the tip's
 * diameter. Capped so 8 bits resolve the touch ramp.
 */
const CONTACT_CEILING = 4.6;
/** Samples per axis across each texel's 2-pixel box. */
const BOX_SAMPLES = 4;

/** Whether tip place (u, v), 0..1 across, is inside `shape`'s outline; shape 1 is unprobed, drawn as a disc. */
function insideOutline(shape: number, u: number, v: number): boolean {
  if (shape === 3) return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  if (shape === 4) return v >= 0 && v <= 1 && Math.abs(u - 0.5) <= 0.5 * (1 - v);
  return Math.hypot(u - 0.5, v - 0.5) <= 0.5;
}

/**
 * Photoshop's default heights for `shape` on an n×n grid, read off the Legacy pack's maps (every one but Pencil's and
 * Lino Crayon's, to 0.004): a point is a cone from 1 at its apex to 0.5 at its rim, a round a half-ellipsoid on a 0.63
 * base, a square and a triangle flat at 1. Probes paint Photoshop's defaults.
 */
export function photoshopErodibleDefaultHeights(shape: number, n: number): Float32Array {
  const heights = new Float32Array(n * n), c = (n - 1) / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(i - c, j - c) / c;
      let h = 0;
      if (shape === 0) h = r <= 1.2 ? Math.max(0.5, 1 - r / 2) : 0;
      else if (shape === 2) h = r <= 1.2 ? 0.63 + 0.37 * Math.sqrt(Math.max(0, 1 - r * r)) : 0;
      else if (shape === 3) h = 1;
      else if (shape === 4) h = Math.abs(i - c) <= c * (1 - j / (n - 1)) + 1 + 1e-9 ? 1 : 0;
      heights[j * n + i] = h;
    }
  }
  return heights;
}

/** The grid's height at grid place (x, y), bilinearly, its corners on the tip's edges. */
function heightAt(heights: Float32Array, n: number, x: number, y: number): number {
  const gx = Math.min(n - 1, Math.max(0, x)), gy = Math.min(n - 1, Math.max(0, y));
  const x0 = Math.min(n - 2, Math.floor(gx)), y0 = Math.min(n - 2, Math.floor(gy)), fx = gx - x0, fy = gy - y0;
  const h = (i: number, j: number) => heights[j * n + i];
  return (h(x0, y0) * (1 - fx) + h(x0 + 1, y0) * fx) * (1 - fy) + (h(x0, y0 + 1) * (1 - fx) + h(x0 + 1, y0 + 1) * fx) * fy;
}

/** The contact range a tip's contact image reads over, in pressure at its preset diameter. */
const contactRange = (tip: PhotoshopErodibleTip): readonly [number, number] => [(-PRESS.a * tip.geometry.diameter) / PRESS.b, CONTACT_CEILING];

/** The tip's images span its diameter and a pixel each side. */
const spanOf = (tip: PhotoshopErodibleTip) => (tip.geometry.diameter + 2) / tip.geometry.diameter;

/**
 * The tip's footprint and its contact image, `size` texels square (the diameter and a pixel each side, at most `max`),
 * dark is paint in both: a contact image's paint reads its contact down from the range's high end to its low.
 */
export function drawPhotoshopErodibleTip(tip: PhotoshopErodibleTip, heights: Float32Array, max: number): { size: number; image: Uint8Array; contact: Uint8Array } {
  const D = tip.geometry.diameter, n = tip.gridSize, size = Math.min(max, Math.round(D) + 2), texel = (D + 2) / size;
  const [lo, hi] = contactRange(tip);
  const peak = heights.reduce((top, h) => Math.max(top, h), 0);
  const image = new Uint8Array(size * size), contact = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // The texel's centre in the tip's pixels, 0..D across the tip itself.
      const cx = (x + 0.5) * texel - 1, cy = (y + 0.5) * texel - 1;
      let cover = 0;
      for (let j = 0; j < BOX_SAMPLES; j++) {
        for (let i = 0; i < BOX_SAMPLES; i++) cover += insideOutline(tip.shape, (cx - 1 + (2 * (i + 0.5)) / BOX_SAMPLES) / D, (cy - 1 + (2 * (j + 0.5)) / BOX_SAMPLES) / D) ? 1 : 0;
      }
      image[y * size + x] = Math.round(255 * (1 - cover / BOX_SAMPLES ** 2));
      const h = heightAt(heights, n, (cx / D) * (n - 1), (cy / D) * (n - 1));
      const pressure = h <= 0 ? hi : ((peak - h - PRESS.a) * D) / PRESS.b;
      contact[y * size + x] = Math.round(255 * (1 - Math.min(1, Math.max(0, (hi - pressure) / (hi - lo)))));
    }
  }
  return { size, image, contact };
}

/** The tip as the studio reads it, its images `image` and `contact`. */
export function photoshopErodibleStampTip<Image>(tip: PhotoshopErodibleTip, image: Image, contact: Image): Pick<StampBrushTip<Image>, 'image' | 'span' | 'pressed'> {
  return { image, span: spanOf(tip), pressed: { contact, range: contactRange(tip), softness: PRESS.softness, diameter: tip.geometry.diameter } };
}
