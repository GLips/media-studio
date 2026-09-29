// procreate-preview-stroke.ts: the stroke Procreate draws each brush's library preview with (QuickLook/Thumbnail.png,
// kept by the importer), so a StampBrush can be painted along the same stroke and set beside it; and how a stroke's
// coverage is measured, so the two can be compared by number as well as by eye (the brush fidelity sheet,
// lib/picture/stamp-paint/engine/stamp-brush-sheet.ts).
//
// The path and its pressure were measured off Smooth Ink Pen's preview, whose size follows pressure one for one and
// which has no taper, so its thickness is its pressure. Every VVDS preview follows the same centreline.
//
// Negative space: a preview's size isn't modelled. Procreate sizes it by `previewSize` against the brush's own size
// range by a rule it doesn't document; the sheet fits the diameter to the preview's thickness instead.

import type { StampBrush } from './stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type CompiledStampPaint } from './stamp-paint-recipe.ts';
import type { StampStrokePoint } from './stamp-placement.ts';

/** A Procreate brush preview's size, in pixels. */
export const PROCREATE_PREVIEW_SIZE = { width: 1060, height: 324 } as const;

/** [x, y, pressure] along the preview's stroke, left to right, in the preview's pixels. */
const PREVIEW_STROKE: readonly (readonly [number, number, number])[] = [
  [115, 183, 0.12], [150, 192, 0.16], [200, 200, 0.25], [250, 205, 0.34], [300, 207, 0.5], [350, 206, 0.69], [400, 202, 0.88],
  [450, 196, 0.93], [500, 188, 0.96], [550, 181, 1], [600, 173, 0.9], [650, 165, 0.8], [700, 158, 0.72], [750, 153, 0.53],
  [800, 151, 0.35], [850, 151, 0.24], [900, 155, 0.16], [935, 158, 0.12],
];

/** Procreate's preview stroke, with its pressure, in the preview's pixels. */
export const procreatePreviewStrokePath = (): StampStrokePoint[] => PREVIEW_STROKE.map(([x, y, pressure]) => ({ x, y, pressure }));

/**
 * `brush` painted once along Procreate's preview stroke at `diameter`, in black, on a painting the preview's size; or,
 * for a brush Procreate previews as one stamp, a single stamp at the stroke's middle. A full glaze, so the painting's
 * darkness is the brush's coverage: an opaque group raises coverage to cover what's under it.
 */
export function procreatePreviewPainting(brush: StampBrush, diameter: number, preview: 'stroke' | 'stamp'): CompiledStampPaint {
  const material = { kind: 'flat', color: '#000000' } as const;
  return compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('preview', { composite: 'glaze', opacity: 1 }, (group) => group.pass('stroke', {}, (pass) => {
    if (preview === 'stamp') pass.stamps('stamp', { brush, material, diameter, at: [{ x: PROCREATE_PREVIEW_SIZE.width / 2, y: PROCREATE_PREVIEW_SIZE.height / 2 }] });
    else pass.stroke('stroke', { brush, material, diameter, path: procreatePreviewStrokePath() });
  }))));
}

/** Coverage at or above this (of 255) counts as the stroke when measuring its extent and thickness. */
const STROKE_COVERAGE = 64;
/** Columns sampled along a stroke's length for its thickness profile. */
export const STROKE_PROFILE_SAMPLES = 40;
/** How deep into the stroke, in pixels, its edge profile reaches. */
const EDGE_DEPTH = 40;
/** The horizontal lags, in pixels, its texture is measured at. */
export const STROKE_TEXTURE_LAGS = [1, 2, 4, 8, 16, 32, 64] as const;

/**
 * A stroke's shape, measured from its coverage. `thickness` samples its height at even steps across `span` (its
 * columns from first to last covered); `density` is its mean coverage where it counts as stroke, 0..1. `edge` is its
 * mean coverage at each depth in from its top and bottom edges, over the middle half of its span: a wet rim shows as a
 * rise at the start. `texture` is how much its coverage changes across each of STROKE_TEXTURE_LAGS, within the stroke:
 * a coarser texture keeps rising to longer lags.
 */
export type StrokeCoverageProfile = {
  span: { x0: number; x1: number };
  peakThickness: number;
  thickness: readonly number[];
  density: number;
  edge: readonly number[];
  texture: readonly number[];
};

/** `coverage` is one byte per pixel, row by row, 255 fully covered. Null when nothing counts as stroke. */
export function measureStrokeCoverage(coverage: Uint8Array, width: number, height: number): StrokeCoverageProfile | null {
  const columns = new Float64Array(width);
  let x0 = width, x1 = -1, covered = 0, sum = 0;
  for (let x = 0; x < width; x++) {
    let top = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      const value = coverage[y * width + x];
      if (value < STROKE_COVERAGE) continue;
      if (top < 0) top = y;
      bottom = y;
      covered++;
      sum += value;
    }
    if (top < 0) continue;
    columns[x] = bottom - top + 1;
    x0 = Math.min(x0, x);
    x1 = x;
  }
  if (x1 < 0) return null;
  // Each sample is the widest column within its step, so a sparse, broken stroke still reads its extent.
  const step = (x1 - x0 + 1) / STROKE_PROFILE_SAMPLES;
  const thickness = Array.from({ length: STROKE_PROFILE_SAMPLES }, (_, i) => {
    let widest = 0;
    for (let x = Math.floor(x0 + i * step); x < Math.min(x1 + 1, Math.floor(x0 + (i + 1) * step) + 1); x++) widest = Math.max(widest, columns[x]);
    return widest;
  });
  return { span: { x0, x1 }, peakThickness: Math.max(...thickness), thickness, density: sum / covered / 255, edge: edgeProfile(coverage, width, height, x0, x1), texture: textureProfile(coverage, width, height) };
}

function edgeProfile(coverage: Uint8Array, width: number, height: number, x0: number, x1: number): number[] {
  const sums = new Float64Array(EDGE_DEPTH), counts = new Float64Array(EDGE_DEPTH);
  const quarter = Math.floor((x1 - x0) / 4);
  for (let x = x0 + quarter; x <= x1 - quarter; x++) {
    let top = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      if (coverage[y * width + x] < STROKE_COVERAGE) continue;
      if (top < 0) top = y;
      bottom = y;
    }
    if (top < 0) continue;
    // Only as deep as the column's middle, so a thin column's far edge isn't read as depth.
    const reach = Math.min(EDGE_DEPTH, Math.floor((bottom - top) / 2));
    for (let d = 0; d < reach; d++) {
      sums[d] += coverage[(top + d) * width + x] + coverage[(bottom - d) * width + x];
      counts[d] += 2;
    }
  }
  // Only the depths some column reaches: a thinner stroke's profile is shorter.
  return Array.from(sums, (sum, d) => sum / counts[d] / 255).filter((_, d) => counts[d] > 0);
}

function textureProfile(coverage: Uint8Array, width: number, height: number): number[] {
  return STROKE_TEXTURE_LAGS.map((lag) => {
    let sum = 0, pairs = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x + lag < width; x++) {
        const a = coverage[y * width + x], b = coverage[y * width + x + lag];
        if (a < STROKE_COVERAGE || b < STROKE_COVERAGE) continue;
        sum += Math.abs(a - b);
        pairs++;
      }
    }
    return pairs ? sum / pairs / 255 : 0;
  });
}

/**
 * How `ours` differs from `preview`. `length` and `peak` are ratios, ours over the preview's. `profileError` is the
 * mean gap between their thickness profiles, each laid over the preview's span, over the preview's peak. `start` and
 * `end` are how far in from each end the stroke first reaches 80% of its peak, as a share of its span: where a taper
 * shows. `density` is ours less the preview's.
 */
export type StrokeProfileComparison = {
  length: number;
  peak: number;
  profileError: number;
  start: { preview: number; ours: number };
  end: { preview: number; ours: number };
  density: number;
  /** How much darker the first few pixels in from the edge are than the stroke's body, 0..1, each stroke's own. */
  rim: { preview: number; ours: number };
  /** The lag, in pixels, at which each stroke's texture reaches half its change at the longest lag: its grain's size. */
  grain: { preview: number; ours: number };
};

/**
 * How much darker a stroke's edge (its first 4 pixels in) is than its body (12 to 32 pixels in, or the deeper half of
 * a thinner stroke's profile).
 */
export const strokeRim = (edge: readonly number[]) => {
  const mean = (from: number, to: number) => edge.slice(from, to).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(to, edge.length) - from);
  return mean(0, 4) - mean(Math.min(12, Math.floor(edge.length / 2)), 32);
};

/** The lag at which `texture` reaches half its value at the longest lag, read between the lags measured (log-linear). */
export const strokeGrainSize = (texture: readonly number[]) => {
  const half = texture.at(-1)! / 2;
  const i = texture.findIndex((t) => t >= half);
  if (i <= 0) return STROKE_TEXTURE_LAGS[Math.max(0, i)];
  const k = (half - texture[i - 1]) / Math.max(1e-6, texture[i] - texture[i - 1]);
  return STROKE_TEXTURE_LAGS[i - 1] * (STROKE_TEXTURE_LAGS[i] / STROKE_TEXTURE_LAGS[i - 1]) ** k;
};

const rampShare = (thickness: readonly number[], fromEnd: boolean) => {
  const peak = Math.max(...thickness), ordered = fromEnd ? [...thickness].reverse() : thickness;
  return ordered.findIndex((t) => t >= 0.8 * peak) / thickness.length;
};

export function compareStrokeProfiles(preview: StrokeCoverageProfile, ours: StrokeCoverageProfile): StrokeProfileComparison {
  const spanOf = (p: StrokeCoverageProfile) => p.span.x1 - p.span.x0 + 1;
  // Ours resampled over the preview's span, so a stroke that falls short shows its missing ends as error.
  const oursAt = (x: number) => {
    const i = Math.floor(((x - ours.span.x0) / spanOf(ours)) * STROKE_PROFILE_SAMPLES);
    return i >= 0 && i < STROKE_PROFILE_SAMPLES ? ours.thickness[i] : 0;
  };
  const gaps = preview.thickness.map((t, i) => Math.abs(t - oursAt(preview.span.x0 + ((i + 0.5) / STROKE_PROFILE_SAMPLES) * spanOf(preview))));
  return {
    length: spanOf(ours) / spanOf(preview),
    peak: ours.peakThickness / preview.peakThickness,
    profileError: gaps.reduce((a, b) => a + b, 0) / gaps.length / preview.peakThickness,
    start: { preview: rampShare(preview.thickness, false), ours: rampShare(ours.thickness, false) },
    end: { preview: rampShare(preview.thickness, true), ours: rampShare(ours.thickness, true) },
    density: ours.density - preview.density,
    rim: { preview: strokeRim(preview.edge), ours: strokeRim(ours.edge) },
    grain: { preview: strokeGrainSize(preview.texture), ours: strokeGrainSize(ours.texture) },
  };
}
