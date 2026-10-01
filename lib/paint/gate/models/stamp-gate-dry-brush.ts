// stamp-gate-dry-brush.ts: the GPU gate's watercolour dry brush, read against its paper. A wet brush's paint settles
// into the paper's valleys; a dryish one drags over the sheet and catches only its peaks, keeping watercolour's
// pigment (no wax stacking up). So, cell by cell of the paper's blocky grain, a dry stroke reads darker where the
// paper stands higher, and a wet one doesn't. Both are laid by one `.pass`, by the direct law.

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
};

const SIZE = { width: 160, height: 120 };
/** The paper's tile spans the frame's width, so a grain cell of 4 texels (of 64) is 10 px. */
const CELL = 10;
const PAPER: StampPaintPaper = { color: '#f6f1e6', grain: { image: stampGateAsset('grain.png'), scale: 1, depth: 0.6 } };
/** Each stroke's band of cell rows, read in from its edges, and the cells across it, clear of its ends. */
const STROKES = [{ media: 'wet', y: 35, rows: [2, 3, 4] }, { media: 'dry', y: 85, rows: [7, 8, 9] }] as const;
const COLUMNS = Array.from({ length: 12 }, (_, k) => k + 2);
/** How far in from a cell's edge it's read, clear of the paper's filtering across a cell's step. */
const INSET = 2;

function stampGateDryBrushPainting(): StampGatePainting {
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W } }, (p) => p.group('strokes', { composite: 'glaze', opacity: 1 }, (g) => g.passage('strokes', { wetHistory: false }, (pass) => {
    for (const { media, y } of STROKES) {
      pass.stroke(media, {
        brush: stampGateBrush(media, { media, flow: 0.8 }), size: 44, well: { paint: { kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: 1 }], strength: 1 } },
        path: [{ x: 0, y }, { x: 160, y }],
      });
    }
  }))));
  return { painting, ...SIZE, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

/** The case painting both strokes and reading its frame. */
export function stampGateDryBrushCase(id: string, mid: number): StampGateWashCase {
  return { id, mid, property: 'frame', subject: stampGateDryBrushPainting(), read: (rgba) => checkStampGateDryBrush(id, rgba) };
}

const correlation = (pairs: readonly (readonly [number, number])[]) => {
  const n = pairs.length, mean = (k: 0 | 1) => pairs.reduce((sum, p) => sum + p[k], 0) / n;
  const [ma, mb] = [mean(0), mean(1)];
  const [cross, va, vb] = pairs.reduce(([c, x, y], [a, b]) => [c + (a - ma) * (b - mb), x + (a - ma) ** 2, y + (b - mb) ** 2], [0, 0, 0]);
  return cross / Math.sqrt(va * vb);
};

function checkStampGateDryBrush(id: string, rgba: ArrayLike<number>): StampGateWashCheck {
  const { width } = SIZE, { dry, wet } = STAMP_GATE_DRY_BRUSH;
  const darkness = (cx: number, cy: number) => {
    let sum = 0, n = 0;
    for (let y = cy * CELL + INSET; y < (cy + 1) * CELL - INSET; y++) for (let x = cx * CELL + INSET; x < (cx + 1) * CELL - INSET; x++, n++) {
      const i = (y * width + x) * 4;
      sum += 255 - (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
    }
    return sum / n;
  };
  const read = STROKES.map(({ media, rows }) => ({
    media, r: correlation(rows.flatMap((cy) => COLUMNS.map((cx) => [darkness(cx, cy), stampGateGrainHeight(cx * 4, cy * 4)] as const))),
  }));
  const problems = read.flatMap(({ media, r }) => {
    if (media === 'dry') return r >= dry ? [] : [`the dry stroke's ${r.toFixed(2)} is under ${dry}`];
    return r <= wet ? [] : [`the wet stroke's ${r.toFixed(2)} is past ${wet}`];
  });
  return {
    id: `${id}: a dry brush catches the peaks`, passed: !problems.length,
    detail: `darkness against paper height: ${read.map(({ media, r }) => `${media} ${r.toFixed(2)}`).join(', ')}${problems.length ? `. ${problems.join('; ')}` : ''}`,
  };
}
