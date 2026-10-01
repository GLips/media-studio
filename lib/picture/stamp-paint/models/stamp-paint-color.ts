// stamp-paint-color.ts: a painting's colours moved in HSL, as a brush's colour jitter moves them.

import type { StampBrushColorDynamics } from './stamp-brush.ts';
import type { StampPaintColor } from './stamp-paint-recipe-types.ts';

/** `color` moved by a brush's stroke colour jitter, from four draws (each 0..1). */
export function jitterStampStrokeColor(color: StampPaintColor, jitter: StampBrushColorDynamics['stroke'], draws: readonly number[]): StampPaintColor {
  return shiftStampPaintColor(color, {
    hue: (draws[0] * 2 - 1) * jitter.hue,
    saturation: (draws[1] * 2 - 1) * jitter.saturation,
    lightness: draws[2] * jitter.lightness - draws[3] * jitter.darkness,
  });
}

/** A colour's hue in sixths of the wheel, 0..6, from its channels, largest `max`, spread `d` (above 0). */
function hueSextant(r: number, g: number, b: number, max: number, d: number): number {
  if (max === r) return ((g - b) / d + 6) % 6;
  if (max === g) return (b - r) / d + 2;
  return (r - g) / d + 4;
}

const hex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

/**
 * `color` turned by `hue` (a share of the wheel) and moved in HSL by `saturation` and `lightness` (each −1..1, added,
 * then held in range). The renderer shifts a stamp's tint the same way (STAMP_TINT_WGSL).
 */
export function shiftStampPaintColor(color: StampPaintColor, { hue, saturation, lightness }: { hue: number; saturation: number; lightness: number }): StampPaintColor {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : hueSextant(r, g, b, max, d);
  const h2 = (((h / 6 + hue) % 1) + 1) % 1, s2 = Math.min(1, Math.max(0, s + saturation)), l2 = Math.min(1, Math.max(0, l + lightness));
  const c = (1 - Math.abs(2 * l2 - 1)) * s2;
  const channel = (n: number) => {
    const k = (n + h2 * 12) % 12;
    return l2 - (c / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${hex(channel(0))}${hex(channel(8))}${hex(channel(4))}`;
}
