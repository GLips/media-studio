// stamp-gate-figure-card.ts: the gate's figure card over dark footage (shot/figure-card). One wash bleeds past a
// figure holding a reserved white, twice: on a figure card cut to the figure, and on a cut card (`flat`), the sticker
// it replaces. The figure card keeps its white opaque and fades over several px with no band brighter than both its
// paint and the footage; the cut card, its paper raised past its thinning bleed, shows that band, so the check sees one.

import type { PaintingDocument, Region, SheetCard } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampGateBoxLuma, type StampGateCardShadowsBox } from './stamp-gate-card-shadows.ts';
import { stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

const FRAME = { width: 200, height: 120 } as const;
/** How far each wash bleeds past its figure, and how far the figure card's paper fades past it, px. */
const BLEED_PX = 8, FADE_PX = 8;
/** The footage stand-in: a dark green the root's paper is, so paper showing past a figure reads as a bright band. */
const FOOTAGE = '#26331f';

/** Each figure's left edge, x, document px: the figure card's and the sticker's. Both span y 20..100, 70 px wide. */
const LEFT = { figure: 20, sticker: 110 } as const;

const square = (x0: number, y0: number, x1: number, y1: number) => stampGateHeronPolygon(x0, y0, x1, y0, x1, y1, x0, y1);

const figureOutline = (left: number): Region => square(left, 20, left + 70, 100);

/** A figure whose left edge is `left`: a pale umber wash bleeding past its outline round a reserved white square, on `card`. */
function figureLayer(key: keyof typeof LEFT, card: SheetCard) {
  const left = LEFT[key], white = square(left + 22, 45, left + 50, 75);
  return {
    key, sheet: { kind: 'own' as const, paper: stampGateHeronPaper('#f3eee2', 1.43), card }, washes: [{ key: `${key}-wash`, applications: [{
      key: `${key}-flood`, kind: 'fill' as const, area: { region: figureOutline(left), edge: { kind: 'bleed' as const, reachPx: BLEED_PX } }, reserves: [{ kind: 'region' as const, region: white }],
      brush: { style: 'gate', brush: 'round' }, diameterPx: 18, seed: key,
      charge: { kind: 'paint' as const, mix: { parts: [{ pigment: WATERCOLOUR_PIGMENTS.burntUmber, amount: 1 }], strength: 0.35 }, water: 0.7 },
    }] }],
  };
}

/** The footage, then the figure on a figure card and the sticker on a cut card. */
export const STAMP_GATE_FIGURE_CARD: PaintingSourceModule = {
  default: (): PaintingDocument => ({
    widthPx: FRAME.width, heightPx: FRAME.height, paper: { color: FOOTAGE, absorbency: 0.37 }, medium: 'watercolour',
    layers: [figureLayer('figure', { figure: figureOutline(LEFT.figure), fadePx: FADE_PX }), figureLayer('sticker', 'flat')],
  }),
};

/** The figures on one still plane. */
export function stampGateFigureCardShot(): StampGateShot {
  return {
    camera: { stage: stampStage(FRAME, 2), fov: 35, lens: { bloom: 0, shutter: 'shut' }, plays: [] },
    planes: [{ id: 'figures', depth: 1, source: layersOf(painting(STAMP_GATE_FIGURE_CARD), ['figure', 'sticker']) }],
  };
}

/** Rows a figure's left edge is read along, clear of its corners and its white. */
const ROWS = { y0: 30, y1: 90 } as const;
/** How far past a left edge its band is read, px: past the bleed and the fade, short of the px its line antialiases. */
const BAND_PX = BLEED_PX + 6;

/** Levels a band may rise above both its paint and the footage before it reads as a rim. */
const RIM_SLACK = 8;
/** The share of its paper's luma a figure card's white must keep, and how many px of an edge must lie between its two sides. */
const WHITE_KEPT = 0.92, SOFT_PX = 3;

/**
 * How far the brightest px past a left edge `left` rises above both its paint just inside the edge and the footage
 * beyond it, levels, at worst over the rows; and how many px past it lie between the two, px, on average. A rim is
 * paper past the paint: brighter there than the paint is.
 */
function edgeReading(rgb: ArrayLike<number>, left: number) {
  let rise = -Infinity, between = 0;
  for (let y = ROWS.y0; y < ROWS.y1; y++) {
    const luma = (x0: number, x1: number) => stampGateBoxLuma(rgb, FRAME.width, { x0, y0: y, x1, y1: y + 1 });
    const paint = luma(left + 1, left + 4), footage = luma(left - BAND_PX - 6, left - BAND_PX);
    const band = Array.from({ length: BAND_PX - 1 }, (_, i) => luma(left - BAND_PX + i, left - BAND_PX + i + 1));
    const lo = Math.min(paint, footage), span = Math.abs(paint - footage);
    rise = Math.max(rise, Math.max(...band) - Math.max(paint, footage));
    between += band.filter((value) => value > lo + 0.15 * span && value < lo + 0.85 * span).length;
  }
  return { rise, between: between / (ROWS.y1 - ROWS.y0) };
}

const f = (value: number) => value.toFixed(1);

/**
 * shot/figure-card: over dark footage the figure card keeps its reserved white opaque, ends in an edge several px soft
 * with no band past it brighter than its paint there and the footage both, and the cut card beside it shows such a band.
 */
export function checkStampGateFigureCard(rgb: ArrayLike<number>) {
  const white: StampGateCardShadowsBox = { x0: LEFT.figure + 28, y0: 51, x1: LEFT.figure + 44, y1: 69 };
  const whiteLuma = stampGateBoxLuma(rgb, FRAME.width, white), paperLuma = stampGateBoxLuma([0xf3, 0xee, 0xe2], 1, { x0: 0, y0: 0, x1: 1, y1: 1 });
  const figure = edgeReading(rgb, LEFT.figure), sticker = edgeReading(rgb, LEFT.sticker);
  return [
    {
      id: 'shot/figure-card: whites kept', passed: whiteLuma >= WHITE_KEPT * paperLuma,
      detail: `its reserved white keeps luma ${f(whiteLuma)} over the footage, its paper's ${f(paperLuma)} (${WHITE_KEPT} of it or more wanted)`,
    },
    {
      id: 'shot/figure-card: soft edge, no rim', passed: figure.rise <= RIM_SLACK && figure.between >= SOFT_PX,
      detail: `past its bleeding edge no px rises more than ${f(figure.rise)} levels above both its paint at the edge and the footage (${RIM_SLACK} allowed), and ${f(figure.between)} px lie between them (${SOFT_PX} or more wanted)`,
    },
    {
      id: 'shot/figure-card: a cut card shows its rim', passed: sticker.rise > RIM_SLACK,
      detail: `the same figure on a cut card rises ${f(sticker.rise)} levels above both sides (above ${RIM_SLACK} wanted: the band the figure card leaves out)`,
    },
  ];
}
