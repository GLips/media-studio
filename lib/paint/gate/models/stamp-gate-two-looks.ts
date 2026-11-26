// stamp-gate-two-looks.ts: the gate's two-look tile composite (shot/two-looks). One figure, a round card, painted
// in two looks, a watercolour wash and an opaque gouache, each a branch no plane places: slices tiles them over
// footage, each cell showing one look, a seeded share moved, some past the figure's edge. Drawn in square cells (the
// baseline) and in rows. Each cell is its look placed alone, moved as shotSlicesCell says.

import type { Layer, LayerNode, PaintingDocument, Region } from '#lib/paint/document/models/painting-document.ts';
import type { PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { TITANIUM_WHITE } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { shotFigure, shotPlace } from '#lib/paint/shot/models/shot-figure.ts';
import { shotSlicesCell, shotSlicesCellAt, slices, type ShotSlicesParams } from '#lib/paint/shot/models/shot-slices.ts';
import { STAMP_GATE_FIGURE_FRAME, stampGateFootagePlane } from './stamp-gate-figure-card.ts';
import { stampGateHeronPaper } from './stamp-gate-paper-heron.ts';
import { STAMP_GATE_ROUND_REF } from './stamp-gate-sheets.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

const { width, height } = STAMP_GATE_FIGURE_FRAME;
const { burntUmber, ultramarine, cadmiumRed } = WATERCOLOUR_PIGMENTS;

/** The figure: a round card, document px, and how far its paint and card reach past its outline. */
const FIGURE = { x: 100, y: 60, rx: 44, ry: 36, reach: 12 } as const;
const outline: Region = { kind: 'ellipse', center: { x: FIGURE.x, y: FIGURE.y }, radiusX: FIGURE.rx, radiusY: FIGURE.ry };

const looks = { look: { type: 'enum', values: ['wash', 'gouache'], default: 'wash' } } as const;
export type StampGateLook = PropertyValues<typeof looks>['look'];

/** The figure's paint in look `look`: a bleeding umber wash on its card's paper, or opaque blue gouache laid dry. */
function figurePaint(look: StampGateLook): Layer {
  if (look === 'wash') {
    return { key: 'figure-paint', washes: [{ key: 'figure-wash', applications: [{
      key: 'figure-flood', kind: 'fill', area: { region: outline, edge: { kind: 'bleed', reachPx: 6 } }, brush: STAMP_GATE_ROUND_REF, diameterPx: 18, seed: 'wash',
      charge: { kind: 'paint', mix: { parts: [{ pigment: burntUmber, amount: 1 }, { pigment: cadmiumRed, amount: 0.3 }], strength: 0.5 }, water: 0.7 },
    }] }] };
  }
  return { key: 'figure-paint', medium: 'gouache', washes: [{ key: 'figure-coat', applications: [{
    key: 'figure-fill', on: 'dry', kind: 'fill', area: { region: outline }, brush: STAMP_GATE_ROUND_REF, diameterPx: 12, seed: 'gouache',
    charge: { kind: 'paint', mix: { parts: [{ pigment: ultramarine, amount: 1 }, { pigment: TITANIUM_WHITE, amount: 0.6 }], strength: 0.9 } },
  }] }] };
}

/** The figure in look `look`: its paint on a figure card cut round it. */
const figureLayer = (look: StampGateLook): LayerNode => ({
  key: 'figure', sheet: { kind: 'own', paper: stampGateHeronPaper('#f3eee2', 1.43), card: { figure: outline, fadePx: 4 } }, children: [figurePaint(look)],
});

/** The figure in either look, on a root sheet no frame shows. */
export const STAMP_GATE_TWO_LOOKS: PaintingSourceModule<typeof looks> = {
  properties: looks,
  default: ({ look }: PropertyValues<typeof looks>): PaintingDocument => ({
    widthPx: width, heightPx: height, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', layers: [figureLayer(look)],
  }),
};

/** The looks' evaluations, the branches the tiles read. */
export const stampGateTwoLooksEvaluations = () => (['wash', 'gouache'] as const).map((look) => painting(STAMP_GATE_TWO_LOOKS, { look }));

/** The tiles: square cells or rows of 20 px, a third moved up to 28 px, the seed one whose moved cells cross the figure's edge. */
export const stampGateTiles = (cells: ShotSlicesParams['cells'], reroll: ShotSlicesParams['reroll'] = 'never'): ShotSlicesParams => ({ cells, size: 20, shift: 28, share: 0.35, seed: 12, reroll });

/** The footage, and the figure's looks tiled by slices in `cells`, neither placed; or look `look` alone, placed. */
export function stampGateTwoLooksShot(drawn: { readonly cells: ShotSlicesParams['cells'] } | { readonly look: StampGateLook } = { cells: 'rects' }): StampGateShot {
  const stage = stampStage(STAMP_GATE_FIGURE_FRAME, 2);
  const [wash, gouache] = stampGateTwoLooksEvaluations().map((evaluation) => shotFigure(evaluation, 'figure', { at: 0 }));
  const image = 'cells' in drawn ? slices({ source: wash, second: gouache }, stampGateTiles(drawn.cells)) : { wash, gouache }[drawn.look];
  return { camera: { stage, fov: 35, lens: { bloom: 0, shutter: 'shut' }, plays: [] }, planes: [stampGateFootagePlane(stage), shotPlace(image, { id: 'tiles', depth: 1 })] };
}

/** The frames, RGB bytes: the tiles in cells and in rows, and each look placed alone. */
export type StampGateTwoLooksFrames = { readonly rects: ArrayLike<number>; readonly rows: ArrayLike<number>; readonly looks: readonly [ArrayLike<number>, ArrayLike<number>] };

/** Levels a px may stand from its look's, moved: a level of the ordered dither either way, as a moved px meets another dither cell. */
const TILE_SLACK = 3;
/** Levels apart the looks must stand on average over the figure, and a fragment from the footage. */
const LOOKS_APART = 30, FRAGMENT = 20;

const insideFigure = (x: number, y: number, grown: number) => ((x - FIGURE.x) / (FIGURE.rx + grown)) ** 2 + ((y - FIGURE.y) / (FIGURE.ry + grown)) ** 2 <= 1;

/**
 * How `frame`, tiled by `params` for its source token, stands to its looks: its px's stray from its cell's look moved,
 * and its fragments past the figure's reach.
 */
export function stampGateTiling(frame: ArrayLike<number>, params: ShotSlicesParams, looksPlaced: StampGateTwoLooksFrames['looks'], token: string | null = null) {
  // The footage's own colour, at the frame's corner, clear of the figure in either look.
  const footage = [0, 1, 2].map((c) => looksPlaced[0][c]);
  let stray = 0, fragments = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const { input, shift: [sx, sy] } = shotSlicesCell(params, 2, shotSlicesCellAt(params, x + 0.5, y + 0.5), token);
    // A px moved from past the frame shows what the stage held there, which no frame of a look shows.
    if (x - sx < 0 || x - sx >= width || y - sy < 0 || y - sy >= height) continue;
    const from = (y - sy) * width + x - sx, look = looksPlaced[input];
    stray = Math.max(stray, Math.max(...[0, 1, 2].map((c) => Math.abs(frame[(y * width + x) * 3 + c] - look[from * 3 + c]))));
    if (!insideFigure(x, y, FIGURE.reach) && footage.some((level, c) => Math.abs(frame[(y * width + x) * 3 + c] - level) > FRAGMENT)) fragments++;
  }
  return { stray, fragments };
}

/** How many cells whose centre lies inside the figure show each look. */
function looksShown(params: ShotSlicesParams) {
  const shown = [0, 0];
  for (let y = params.size / 2; y < height; y += params.size) for (let x = params.size / 2; x < width; x += params.size) {
    if (insideFigure(x, y, 0)) shown[shotSlicesCell(params, 2, shotSlicesCellAt(params, x, y)).input]++;
  }
  return shown;
}

/**
 * shot/two-looks: in square cells and in rows, every px of the tiles is its cell's look placed alone, moved as its
 * cell is, though neither look is placed; the looks differ, and cells show each; fragments land past the figure.
 */
export function checkStampGateTwoLooks({ rects, rows, looks: looksPlaced }: StampGateTwoLooksFrames) {
  let apart = 0, inside = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!insideFigure(x, y, -4)) continue;
    apart += [0, 1, 2].reduce((sum, c) => sum + Math.abs(looksPlaced[0][(y * width + x) * 3 + c] - looksPlaced[1][(y * width + x) * 3 + c]), 0) / 3;
    inside++;
  }
  const shown = looksShown(stampGateTiles('rects'));
  return [
    ...(['rects', 'rows'] as const).flatMap((cells) => {
      const { stray, fragments } = stampGateTiling(cells === 'rects' ? rects : rows, stampGateTiles(cells), looksPlaced);
      return [
        {
          id: `shot/two-looks: ${cells} are their looks, moved`, passed: stray <= TILE_SLACK,
          detail: `with neither look placed, every px strays at most ${stray} levels from its cell's look placed alone, moved as its cell is (${TILE_SLACK} allowed)`,
        },
        {
          id: `shot/two-looks: ${cells} land past the figure`, passed: fragments > 0,
          detail: `${fragments} px past the figure's reach stand over ${FRAGMENT} levels from the footage (some wanted)`,
        },
      ];
    }),
    {
      id: 'shot/two-looks: both looks show', passed: apart / inside >= LOOKS_APART && shown.every((count) => count > 0),
      detail: `the looks stand ${(apart / inside).toFixed(1)} levels apart over the figure (${LOOKS_APART} or more wanted), and ${shown.join(' and ')} cells inside it show each`,
    },
  ];
}
