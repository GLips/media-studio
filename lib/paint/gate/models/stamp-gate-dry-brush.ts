// stamp-gate-dry-brush.ts: the GPU gate's dry brush in a wet medium, read against its paper. A wet brush's paint
// settles into the paper's valleys; a dryish one drags over the sheet and catches only its peaks, keeping its medium's
// pigment (no wax stacking up), and skips the valleys, leaving what's there. So, cell by cell of the paper's blocky
// grain, a dry stroke reads darker where the paper stands higher, and a wet one doesn't; a pale dry stroke over a dark
// band reads darker where the paper is lower, the band kept in its valleys. All laid by one `.pass`, by the direct law.

import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampPaintPaper } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import { STAMP_GATE_IMAGES, stampGateAsset, stampGateBrush, stampGateGrainHeight, type StampGatePainting } from './stamp-gate-paintings.ts';
import type { StampGateWashCase } from './stamp-gate-washes.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';

/** What the strokes are held to: Pearson correlations, over the cells, of paint's darkness with the paper's height. */
export const STAMP_GATE_DRY_BRUSH = {
  /** The least a dry stroke's correlation reads: it catches the peaks. */
  dry: 0.5,
  /** The most a wet stroke's may: it settles into the valleys, or lies even. */
  wet: 0,
  /** The most a pale dry stroke's over a dark band may: the band shows in the valleys it skips. */
  scumble: -0.5,
};

/** The wet media a dry brush is dragged in. */
export type StampGateDryBrushMedium = 'watercolour' | 'gouache';

/** The paper's tile spans the frame, 16 grain cells each way. */
const SIZE = { width: 160, height: 160 };
/** A grain cell of 4 texels (of 64) is 10 px. */
const CELL = 10;
const PAPER: StampPaintPaper = { color: '#f6f1e6', grain: { image: stampGateAsset('grain.png'), scale: 1, depth: 0.6 } };
/** Each stroke's band of cell rows, read in from its edges, and the cells across it, clear of its ends. */
const STROKES = [{ id: 'wet', y: 25, rows: [1, 2, 3] }, { id: 'dry', y: 75, rows: [6, 7, 8] }, { id: 'scumble', y: 125, rows: [11, 12, 13] }] as const;
const COLUMNS = Array.from({ length: 12 }, (_, k) => k + 2);
/** How far in from a cell's edge it's read, clear of the paper's filtering across a cell's step. */
const INSET = 2;
const ULTRAMARINE = { kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: 1 }], strength: 1 } as const;
const across = (y: number) => [{ x: 0, y }, { x: SIZE.width, y }];

function stampGateDryBrushPainting(medium: StampGateDryBrushMedium): StampGatePainting {
  const wet = stampGateBrush('wet', { media: 'wet', flow: 0.8 }), dry = stampGateBrush('dry', { media: 'dry', flow: 0.8 });
  const [first, second, third] = STROKES;
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA[medium], pigments: W } }, (p) => p.group('strokes', { composite: 'glaze', opacity: 1 }, (g) => g.passage('strokes', { wetHistory: false }, (pass) => {
    pass.stroke(first.id, { brush: wet, size: 44, well: { paint: ULTRAMARINE }, path: across(first.y) });
    pass.stroke(second.id, { brush: dry, size: 44, well: { paint: ULTRAMARINE }, path: across(second.y) });
    pass.stroke('band', { brush: wet, size: 60, well: { paint: ULTRAMARINE }, path: across(third.y) });
    pass.stroke(third.id, { brush: dry, size: 44, well: { paint: { kind: 'color', color: '#f4ecd0' } }, path: across(third.y) });
  }))));
  return { painting, ...SIZE, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

/** The case painting the strokes in `medium` and reading its frame. */
export function stampGateDryBrushCase(id: string, medium: StampGateDryBrushMedium): StampGateWashCase {
  return { id, property: 'frame', subject: stampGateDryBrushPainting(medium), read: (rgba) => checkStampGateDryBrush(id, rgba) };
}

const correlation = (pairs: readonly (readonly [number, number])[]) => {
  const n = pairs.length, mean = (k: 0 | 1) => pairs.reduce((sum, p) => sum + p[k], 0) / n;
  const [ma, mb] = [mean(0), mean(1)];
  const [cross, va, vb] = pairs.reduce(([c, x, y], [a, b]) => [c + (a - ma) * (b - mb), x + (a - ma) ** 2, y + (b - mb) ** 2], [0, 0, 0]);
  return cross / Math.sqrt(va * vb);
};

function checkStampGateDryBrush(id: string, rgba: ArrayLike<number>): StampGateWashCheck {
  const { width } = SIZE, held = STAMP_GATE_DRY_BRUSH;
  const darkness = (cx: number, cy: number) => {
    let sum = 0, n = 0;
    for (let y = cy * CELL + INSET; y < (cy + 1) * CELL - INSET; y++) for (let x = cx * CELL + INSET; x < (cx + 1) * CELL - INSET; x++, n++) {
      const i = (y * width + x) * 4;
      sum += 255 - (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
    }
    return sum / n;
  };
  const read = STROKES.map(({ id: stroke, rows }) => ({
    stroke, r: correlation(rows.flatMap((cy) => COLUMNS.map((cx) => [darkness(cx, cy), stampGateGrainHeight(cx * 4, cy * 4)] as const))),
  }));
  const problems = read.flatMap(({ stroke, r }) => {
    if (stroke === 'dry') return r >= held.dry ? [] : [`the dry stroke's ${r.toFixed(2)} is under ${held.dry}`];
    return r <= held[stroke] ? [] : [`the ${stroke} stroke's ${r.toFixed(2)} is past ${held[stroke]}`];
  });
  return {
    id: `${id}: a dry brush catches the peaks and skips the valleys`, passed: !problems.length,
    detail: `darkness against paper height: ${read.map(({ stroke, r }) => `${stroke} ${r.toFixed(2)}`).join(', ')}${problems.length ? `. ${problems.join('; ')}` : ''}`,
  };
}
