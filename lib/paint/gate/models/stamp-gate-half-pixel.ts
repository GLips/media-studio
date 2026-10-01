// stamp-gate-half-pixel.ts: the GPU gate's half-pixel check (animation/half-pixel). A drift moves in whole pixels, so
// it never sees how a moved group is resampled; this shifts crayon, whose tooth a careless resample fills, by half.

import { stampLinearDynamics } from '#lib/paint/brush/models/stamp-brush.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type StampPaintPaper } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { STAMP_GATE_IMAGES, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import type { StampGateWashCheck } from './stamp-gate-washes.ts';

type Rgba = ArrayLike<number>;
const SIZE = { width: 240, height: 160 };
const PAPER: StampPaintPaper = { color: '#fbf7ee', grain: { image: { style: 'gate', pack: 'gate', file: 'grain.png' }, scale: 0.2, depth: 0.7 } };
const GRAINED = stampGateBrush('Grained', {
  media: 'wet',
  dynamics: stampLinearDynamics({ size: { random: 0.3 } }), scatter: { count: 2, radius: 0.3, lateral: 0.3 }, rotation: { angle: 0, randomStart: true },
  grain: { kind: 'canvas', image: { style: 'gate', pack: 'gate', file: 'grain.png' }, blend: { family: 'texture', mode: 'multiply' }, scale: 1.5, depth: 0.6, brightness: 0, contrast: 0, contrastPivot: 'midGrey', tiling: 'repeat', offsetJitter: 1 },
});

/** The crayon patch, and the interior the half-pixel check reads, clear of its edges either side of the shift. */
const HALF_PIXEL_PATCH = { x0: 40, x1: 200, y0: 30, y1: 130 }, HALF_PIXEL_READ = { x0: 48, x1: 192, y0: 38, y1: 122 };
/** The least share of the still patch's bare-paper specks the shifted one keeps; the least the still one holds, so the check bites. */
export const STAMP_GATE_HALF_PIXEL_SPECKS = { kept: 0.75, least: 0.05 };
/**
 * How far, in levels, the shifted patch's mean may sit from the still one's, averaged as light (as a resample averages
 * it). Laid then blended, it holds within 0.01; films blended before the lay darken it 1.7.
 */
export const STAMP_GATE_HALF_PIXEL_LIGHT = 0.5;

/**
 * Crayon on grained paper, an opaque patch, left still or shifted half a pixel each way by a warp: where a resample
 * is softest, as a drift in whole pixels never is.
 */
export function stampGateHalfPixelPainting(shifted: boolean): StampGatePainting {
  const { x0, x1, y0, y1 } = HALF_PIXEL_PATCH;
  const carriage = shifted ? { warp: { at: () => (p: { x: number; y: number }) => ({ x: p.x + 0.5, y: p.y + 0.5 }), from: 0, to: 0 } } : {};
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => p.group('patch', { composite: 'opaque', ...carriage }, (g) => g.pass('p', {}, (pass) => pass.fill('patch', {
    brush: GRAINED, diameter: 6, application: { kind: 'strokes', pattern: 'hatch', spacing: 1.5, variation: 0.6 }, direction: 0.6,
    material: { kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: 1 }, { pigment: W.burntSienna, amount: 1 }], strength: 0.6 }, region: stampGatePolygon(x0, y0, x1, y0, x1, y1, x0, y1),
  })))));
  return { painting, paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA.crayon, pigments: W }, ...SIZE, t: 0, images: STAMP_GATE_IMAGES };
}

const linearLight = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** Over the half-pixel check's interior: the share of bare-paper specks (luma past 200) and the mean as light, re-encoded, in levels. */
function halfPixelReading(rgba: Rgba) {
  const { x0, x1, y0, y1 } = HALF_PIXEL_READ;
  let specks = 0, light = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * SIZE.width + x) * 4, luma = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    if (luma > 200) specks++;
    light += linearLight(luma / 255);
  }
  const n = (x1 - x0) * (y1 - y0), l = light / n;
  return { specks: specks / n, light: 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055) };
}

/**
 * Whether crayon shifted half a pixel keeps its bare-paper specks and its light: each texel laid as it lies unmoved,
 * then blended. Blending its films before the lay fills the tooth and darkens it.
 */
export function checkStampGateHalfPixel({ still, shifted }: { still: Rgba; shifted: Rgba }): StampGateWashCheck {
  const a = halfPixelReading(still), b = halfPixelReading(shifted), kept = b.specks / a.specks, light = b.light - a.light;
  const problems = [
    ...(a.specks < STAMP_GATE_HALF_PIXEL_SPECKS.least ? [`the still patch has only ${(a.specks * 100).toFixed(1)}% specks, so the check can't bite`] : []),
    ...(kept < STAMP_GATE_HALF_PIXEL_SPECKS.kept ? [`shifted, it keeps ${(kept * 100).toFixed(0)}% of its specks (under ${STAMP_GATE_HALF_PIXEL_SPECKS.kept * 100}% fails)`] : []),
    ...(Math.abs(light) > STAMP_GATE_HALF_PIXEL_LIGHT ? [`shifted, its light moves ${light.toFixed(2)} levels (past ${STAMP_GATE_HALF_PIXEL_LIGHT} fails)`] : []),
  ];
  return {
    id: 'animation/half-pixel: crayon moved half a pixel keeps its tooth and its light', passed: !problems.length,
    detail: `specks ${(a.specks * 100).toFixed(1)}% still, ${(b.specks * 100).toFixed(1)}% shifted; light ${a.light.toFixed(2)} still, ${b.light.toFixed(2)} shifted`
      + (problems.length ? `; ${problems.join('; ')}` : ''),
  };
}
