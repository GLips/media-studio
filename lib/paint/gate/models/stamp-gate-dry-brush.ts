// stamp-gate-dry-brush.ts: the GPU gate's dry brush in a wet medium, read against its paper. A wet brush's paint
// settles into the paper's valleys; a dry one drags over the sheet, catching only its peaks in its medium's pigment and
// skipping the valleys, leaving what's there. So, cell by cell of the paper's blocky grain, a dry stroke reads darker
// where the paper stands higher, and a wet one doesn't; a pale dry stroke scumbled over half a dark band lightens it
// more where the paper stands higher, its valleys kept as the bare half's on the same paper a tile over. All laid by
// one `.pass`, by the direct law.

import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampPaintPaper } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import { STAMP_GATE_IMAGES, stampGateAsset, stampGateBrush, stampGateGrainHeight, type StampGatePainting } from './stamp-gate-paintings.ts';
import type { StampGateWashCase } from './stamp-gate-washes.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';

/** What the strokes are held to: Pearson correlations, over the cells, against the paper's height. */
export const STAMP_GATE_DRY_BRUSH = {
  /** The least a dry stroke's darkness correlates: it catches the peaks. */
  dry: 0.5,
  /** The most a wet stroke's may: it settles into the valleys, or lies even. */
  wet: 0,
  /** The least the scumble's lightening of the band (the bare half's darkness less the scumbled's) correlates. */
  scumble: 0.5,
  /** The least share of the bare band's darkness the scumbled band keeps in the paper's lowest third: its valleys. */
  valleysKept: 0.9,
};

/** The wet media a dry brush is dragged in. */
export type StampGateDryBrushMedium = 'watercolour' | 'gouache';

/**
 * Two paper tiles side by side, each 160 px and 16 grain cells each way (a grain's scale is of the frame's width), the
 * second mirrored, as a paper's tiles are: cell x of the first is cell 2 TILE - 1 - x of the second.
 */
const SIZE = { width: 320, height: 160 };
/** A grain cell of 4 texels (of 64) is 10 px; a tile is 16. */
const CELL = 10, TILE = 16;
const PAPER: StampPaintPaper = { color: '#f6f1e6', grain: { image: stampGateAsset('grain.png'), scale: 0.5, depth: 0.6 } };
/** Each stroke's band of cell rows, read in from its edges. */
const ROWS = { wet: { y: 25, rows: [1, 2, 3] }, dry: { y: 75, rows: [6, 7, 8] }, band: { y: 125, rows: [11, 12, 13] } } as const;
/** The cells read across the first tile, clear of the strokes' ends; the scumble lies over the second tile alone. */
const COLUMNS = Array.from({ length: 12 }, (_, k) => k + 2);
/** Where the scumble starts: its round end clear of the first tile's last column read. */
const SCUMBLE_FROM = TILE * CELL + 2;
/** How far in from a cell's edge it's read, clear of the paper's filtering across a cell's step. */
const INSET = 2;
const ULTRAMARINE = { kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: 1 }], strength: 1 } as const;
const across = (y: number, from = 0) => [{ x: from, y }, { x: SIZE.width, y }];

function stampGateDryBrushPainting(medium: StampGateDryBrushMedium): StampGatePainting {
  const wet = stampGateBrush('wet', { media: 'wet', flow: 0.8 }), dry = stampGateBrush('dry', { media: 'dry', flow: 0.8 });
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA[medium], pigments: W } }, (p) => p.group('strokes', { composite: 'glaze', opacity: 1 }, (g) => g.passage('strokes', { wetHistory: false }, (pass) => {
    pass.stroke('wet', { brush: wet, size: 44, well: { paint: ULTRAMARINE }, path: across(ROWS.wet.y) });
    pass.stroke('dry', { brush: dry, size: 44, well: { paint: ULTRAMARINE }, path: across(ROWS.dry.y) });
    pass.stroke('band', { brush: wet, size: 60, well: { paint: ULTRAMARINE }, path: across(ROWS.band.y) });
    pass.stroke('scumble', { brush: dry, size: 44, well: { paint: { kind: 'color', color: '#f4ecd0' } }, path: across(ROWS.band.y, SCUMBLE_FROM) });
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
  const cells = (rows: readonly number[]) => rows.flatMap((cy) => COLUMNS.map((cx) => ({ cx, cy, height: stampGateGrainHeight(cx * 4, cy * 4) })));
  const wet = correlation(cells(ROWS.wet.rows).map(({ cx, cy, height }) => [darkness(cx, cy), height]));
  const dry = correlation(cells(ROWS.dry.rows).map(({ cx, cy, height }) => [darkness(cx, cy), height]));
  // The bare band and the scumbled one, a tile apart, mirrored, over the same paper.
  const band = cells(ROWS.band.rows).map(({ cx, cy, height }) => ({ bare: darkness(cx, cy), scumbled: darkness(2 * TILE - 1 - cx, cy), height }));
  const scumble = correlation(band.map(({ bare, scumbled, height }) => [bare - scumbled, height]));
  const valleys = band.toSorted((a, b) => a.height - b.height).slice(0, Math.floor(band.length / 3));
  const valleysKept = valleys.reduce((sum, { scumbled }) => sum + scumbled, 0) / valleys.reduce((sum, { bare }) => sum + bare, 0);
  const problems = [
    ...(dry >= held.dry ? [] : [`the dry stroke's ${dry.toFixed(2)} is under ${held.dry}`]),
    ...(wet <= held.wet ? [] : [`the wet stroke's ${wet.toFixed(2)} is past ${held.wet}`]),
    ...(scumble >= held.scumble ? [] : [`the scumble's lightening's ${scumble.toFixed(2)} is under ${held.scumble}`]),
    ...(valleysKept >= held.valleysKept ? [] : [`the scumbled band keeps ${valleysKept.toFixed(2)} of its valleys' darkness, under ${held.valleysKept}`]),
  ];
  return {
    id: `${id}: a dry brush catches the peaks and skips the valleys`, passed: !problems.length,
    detail: `against paper height: wet ${wet.toFixed(2)}, dry ${dry.toFixed(2)}, the scumble's lightening ${scumble.toFixed(2)}; its valleys keep ${valleysKept.toFixed(2)} of the bare band's darkness${problems.length ? `. ${problems.join('; ')}` : ''}`,
  };
}
