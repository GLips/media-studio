// stamp-reference-blend.ts: how a grain cuts coverage, how a dual combines with its brush, and wet edges' pooling, as
// numbers: the definitions the GPU renderer's WGSL (stamp-paint/studio/stamp-paint-renderer.ts) implements and the
// reference renderer (stamp-reference-deposit.ts) calls. Photoshop's are identified from its captures (vid-97): each
// formula fits its probes to the capture's noise, the constants included.

import type { StampBrushGrain, StampBrushPooling, StampDualBlend, StampGrainBlend } from '#lib/picture/stamp-paint/models/stamp-brush.ts';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Colour dodge and burn scale their pattern by depth × 248/255, floored to a 255th: Photoshop's, fitted at depths 100
 * and 50 on the texture probes and full depth on the dual's.
 */
export const stampDodgeScale = (depth: number) => Math.floor((Math.round(depth * 255) * 248) / 255) / 255;

const overlay = (base: number, blend: number) => (base < 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend));

/** Coverage `a` cut by grain paint `v` (1 keeps paint) at `depth`, by `blend`. */
export function stampGrainCut(a: number, v: number, depth: number, blend: StampGrainBlend): number {
  const d = depth, k = stampDodgeScale(depth);
  switch (blend) {
    case 'multiply': return clamp01(a * (1 - d * (1 - v)));
    case 'subtract': return a + d * (clamp01(a - v) - a);
    case 'linearBurn': return clamp01(a - d * (1 - v));
    case 'darken': return Math.min(a, 1 - d * (1 - v));
    case 'overlay': return clamp01(overlay(a, 0.5 + d * (v - 0.5)));
    case 'colorDodge': return clamp01(a / (1 - k * v));
    case 'colorBurn': return clamp01(1 - (1 - a) / (1 - k * (1 - v)));
    case 'hardMix': return clamp01(4 * a + 3 * d * v - 3);
    // The pattern as a relief the paint fills 12·depth·a deep: Krita's Photoshop height forms, weight 12 not its 10.
    case 'height': return clamp01(12 * d * a - v);
    case 'linearHeight': { const m = 12 * d * a; return clamp01(Math.max(m * (1 - v), m - v)); }
    case 'lighten': return a + d * (Math.max(a, v) - a);
    case 'divide': return a + d * ((v > 0 ? clamp01(a / v) : 1) - a);
  }
}

/**
 * A grain's paint as its brush adjusts it: `raw` 0..1 as the image holds it (1 paints). Photoshop's pattern brightness
 * and contrast, both pivoting at mid-grey; a contrast of 1 (Photoshop's 100) is steep but finite.
 */
export function stampGrainPaint(raw: number, { brightness: b, contrast: c }: Pick<StampBrushGrain, 'brightness' | 'contrast'>): number {
  if (c === 0) return clamp01(raw + b);
  if (c < 0) return clamp01((raw - 128 / 255) * (1 + c) + 0.5 + b);
  const [pivot, slope] = c >= 1 ? [126.589 / 255, 231.63] : [127.5 / 255, 1 / (1 - c)];
  return clamp01((raw + b - pivot) * slope + 128 / 255);
}

/**
 * The dual's coverage `s` combined with the brush's grained coverage `p` by `blend`. The layer blends would paint where
 * the brush has none, so they're held to where it has paint (fully from p = 1/8).
 */
export function stampDualCombine(p: number, s: number, blend: StampDualBlend): number {
  const k = stampDodgeScale(1);
  switch (blend) {
    case 'multiply': return p * s;
    case 'darken': return Math.min(p, s);
    case 'linearBurn': return clamp01(p + s - 1);
    case 'overlay': return clamp01(overlay(p, s));
    case 'colorDodge': return clamp01(p / (1 - k * s));
    case 'colorBurn': return clamp01(1 - (1 - p) / (1 - k * (1 - s)));
    case 'hardMix': return clamp01(4 * p + 3 * s - 3);
    case 'linearHeight': return clamp01(overlay(p, 1 - s));
    case 'normal': return s * clamp01(p * 8);
    case 'screen': return (p + s - p * s) * clamp01(p * 8);
    case 'lighten': return Math.max(p, s) * clamp01(p * 8);
    case 'difference': return Math.abs(p - s) * clamp01(p * 8);
  }
}

/** Wet edges' pooling of built coverage `c`: rising to `peak` at half coverage, easing to `body` at full. */
export function stampPooled(c: number, { peak, body }: StampBrushPooling): number {
  return c <= 0.5 ? 2 * peak * c : peak - 4 * (peak - body) * (c - 0.5) ** 2;
}

/** Photoshop's wet edges (fitted at rms 0.00009): half coverage pools to 192/255, full coverage to 150/255. */
export const PHOTOSHOP_POOLING: StampBrushPooling = { peak: 192 / 255, body: 150 / 255 };
