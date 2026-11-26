// stamp-gate-figure-card.ts: the gate's figure card over dark footage (shot/figure-card). One wash bleeds past a
// figure holding a reserved white, twice: on a figure card cut to the figure, and on a cut card (`flat`), the sticker
// it replaces. The figure card keeps its white opaque and fades over several px with no band brighter than both its
// paint and the footage; the cut card, its paper raised past its thinning bleed, shows that band, so the check sees one.
// Unrevealed, the figure card lays nothing: its paper shows only where its reveal has reached.
// shot/figure-image places the figure as a shot's figure over footage on a plane of its own (checkStampGateFigureImage).

import type { Layer, PaintingDocument, Region, SheetCard } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { srgbToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import type { StampPictureRgba } from '#lib/paint/painting/models/stamp-plane.ts';
import { stampStage, type StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { shotFigure, shotPlace } from '#lib/paint/shot/models/shot-figure.ts';
import type { PlaneProps } from '#lib/paint/shot/models/shot-props.ts';
import { stampGateBoxLuma, type StampGateCardShadowsBox } from './stamp-gate-card-shadows.ts';
import { stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';
import { STAMP_GATE_FRAME_TOLERANCE, stampGateFrameDifference, stampGateFrameDifferenceText, stampGateFramePasses } from './stamp-gate-frames.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

export const STAMP_GATE_FIGURE_FRAME = { width: 200, height: 120 } as const;
const FRAME = STAMP_GATE_FIGURE_FRAME;
/** How far each wash bleeds past its figure, and how far the figure card's paper fades past it, px. */
const BLEED_PX = 8, FADE_PX = 8;
/** The footage stand-in: a dark green the root's paper is, so paper showing past a figure reads as a bright band. */
const FOOTAGE = '#26331f';

/** Each figure's left edge, x, document px: the figure card's and the sticker's. Both span y 20..100, 70 px wide. */
const LEFT = { figure: 20, sticker: 110 } as const;

const square = (x0: number, y0: number, x1: number, y1: number) => stampGateHeronPolygon(x0, y0, x1, y0, x1, y1, x0, y1);

const figureOutline = (left: number): Region => square(left, 20, left + 70, 100);

/** A reveal reaching the whole figure card only long after the selection's moment, 0 s. */
const LATE_REVEAL = { kind: 'strokes', strokes: [{ points: [{ x: 0, y: 60 }, { x: 110, y: 60 }], widthPx: 120, from: 10, to: 11 }] } as const;

const FIGURE_PAPER = stampGateHeronPaper('#f3eee2', 1.43);

/** A figure's washes, its left edge `left`: a pale umber wash bleeding past its outline round a reserved white square. */
function figureWashes(key: keyof typeof LEFT): Layer['washes'] {
  const left = LEFT[key], white = square(left + 22, 45, left + 50, 75);
  return [{ key: `${key}-wash`, applications: [{
    key: `${key}-flood`, kind: 'fill', area: { region: figureOutline(left), edge: { kind: 'bleed', reachPx: BLEED_PX } }, reserves: [{ kind: 'region', region: white }],
    brush: { style: 'gate', brush: 'round' }, diameterPx: 18, seed: key,
    charge: { kind: 'paint', mix: { parts: [{ pigment: WATERCOLOUR_PIGMENTS.burntUmber, amount: 1 }], strength: 0.35 }, water: 0.7 },
  }] }];
}

/** A figure whose left edge is `left`, on `card`, unrevealed when `late`. */
function figureLayer(key: keyof typeof LEFT, card: SheetCard, late = false): Layer {
  return { key, ...(late && { reveal: LATE_REVEAL }), sheet: { kind: 'own', paper: FIGURE_PAPER, card }, washes: figureWashes(key) };
}

const figureCardProperties = { revealed: { type: 'boolean', default: true } } as const satisfies PropertySchema;

/** The footage, then the figure on a figure card (not yet revealed unless `revealed`) and the sticker on a cut card. */
export const STAMP_GATE_FIGURE_CARD: PaintingSourceModule<typeof figureCardProperties> = {
  properties: figureCardProperties,
  default: ({ revealed }: PropertyValues<typeof figureCardProperties>): PaintingDocument => ({
    widthPx: FRAME.width, heightPx: FRAME.height, paper: { color: FOOTAGE, absorbency: 0.37 }, medium: 'watercolour',
    layers: [figureLayer('figure', { figure: figureOutline(LEFT.figure), fadePx: FADE_PX }, !revealed), figureLayer('sticker', 'flat')],
  }),
};

/** The figures on one still plane, the figure card not yet revealed unless `revealed`. */
export function stampGateFigureCardShot(revealed = true): StampGateShot {
  return {
    camera: { stage: stampStage(FRAME, 2), fov: 35, lens: { bloom: 0, shutter: 'shut' }, plays: [] },
    planes: [{ id: 'figures', depth: 1, source: layersOf(painting(STAMP_GATE_FIGURE_CARD, { revealed }), ['figure', 'sticker'], { at: 0 }) }],
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

/** Levels any row across the unrevealed figure may stray from the footage's rows above every figure. */
const HIDDEN_SLACK = 2;

/** How far, levels, the row across the unrevealed figure's card (paint, fade and bleed) strays most from the clear footage over it. */
function hiddenStray(rgb: ArrayLike<number>) {
  const footage = stampGateBoxLuma(rgb, FRAME.width, { x0: 0, y0: 0, x1: FRAME.width, y1: 3 });
  let stray = 0;
  for (let y = 20 - BAND_PX; y < 100 + BAND_PX; y++) {
    stray = Math.max(stray, Math.abs(stampGateBoxLuma(rgb, FRAME.width, { x0: LEFT.figure - BAND_PX, y0: y, x1: LEFT.figure + 70 + 10, y1: y + 1 }) - footage));
  }
  return stray;
}

/**
 * shot/figure-card: over dark footage the figure card keeps its reserved white opaque, ends in an edge several px soft
 * with no band past it brighter than its paint there and the footage both, and the cut card beside it shows such a band;
 * `unrevealed`, the same frame before its reveal reaches it, shows only footage where the figure card lies.
 */
export function checkStampGateFigureCard(rgb: ArrayLike<number>, unrevealed: ArrayLike<number>, id: 'shot/figure-card' | 'shot/figure-image' = 'shot/figure-card') {
  const stray = hiddenStray(unrevealed);
  const white: StampGateCardShadowsBox = { x0: LEFT.figure + 28, y0: 51, x1: LEFT.figure + 44, y1: 69 };
  const whiteLuma = stampGateBoxLuma(rgb, FRAME.width, white), paperLuma = stampGateBoxLuma([0xf3, 0xee, 0xe2], 1, { x0: 0, y0: 0, x1: 1, y1: 1 });
  const figure = edgeReading(rgb, LEFT.figure), sticker = edgeReading(rgb, LEFT.sticker);
  return [
    {
      id: `${id}: whites kept`, passed: whiteLuma >= WHITE_KEPT * paperLuma,
      detail: `its reserved white keeps luma ${f(whiteLuma)} over the footage, its paper's ${f(paperLuma)} (${WHITE_KEPT} of it or more wanted)`,
    },
    {
      id: `${id}: soft edge, no rim`, passed: figure.rise <= RIM_SLACK && figure.between >= SOFT_PX,
      detail: `past its bleeding edge no px rises more than ${f(figure.rise)} levels above both its paint at the edge and the footage (${RIM_SLACK} allowed), and ${f(figure.between)} px lie between them (${SOFT_PX} or more wanted)`,
    },
    {
      id: `${id}: a cut card shows its rim`, passed: sticker.rise > RIM_SLACK,
      detail: `the same figure on a cut card rises ${f(sticker.rise)} levels above both sides (above ${RIM_SLACK} wanted: the band the figure card leaves out)`,
    },
    {
      id: `${id}: unrevealed lays nothing`, passed: stray <= HIDDEN_SLACK,
      detail: `before its reveal reaches it, no row across the figure card strays more than ${f(stray)} levels from the footage (${HIDDEN_SLACK} allowed)`,
    },
  ];
}

// ---- the figure image ------------------------------------------------------------------------------------------------

/** The ground's shadow under the figure, document px: on the root's sheet, outside the figure's card and past its fade. */
const SHADOW: StampGateCardShadowsBox = { x0: 16, y0: 110, x1: 94, y1: 120 };
/** The card nested in the figure, document px: clear of its white and of the left edge read. */
const BADGE: StampGateCardShadowsBox = { x0: 74, y0: 80, x1: 86, y1: 94 };

const boxRegion = ({ x0, y0, x1, y1 }: StampGateCardShadowsBox) => square(x0, y0, x1, y1);

/** A layer of one flat wash of `pigment` over `box`, keyed `key`. */
const flatLayer = (key: string, box: StampGateCardShadowsBox, pigment: (typeof WATERCOLOUR_PIGMENTS)[keyof typeof WATERCOLOUR_PIGMENTS], strength: number): Layer => ({
  key, washes: [{ key: `${key}-wash`, applications: [{
    key: `${key}-fill`, kind: 'fill', area: { region: boxRegion(box) }, brush: { style: 'gate', brush: 'round' }, diameterPx: 8, seed: key,
    charge: { kind: 'paint', mix: { parts: [{ pigment, amount: 1 }], strength }, water: 0.5 },
  }] }],
});

/**
 * subjectFigureCard's shape: the ground's shadow on the root's sheet, then the figure's group on its figure card (its
 * wash, and a cut card nested in it), unrevealed unless `revealed`; and the sticker. The root's paper is never shown.
 */
export const STAMP_GATE_FIGURE_IMAGE: PaintingSourceModule<typeof figureCardProperties> = {
  properties: figureCardProperties,
  default: ({ revealed }: PropertyValues<typeof figureCardProperties>): PaintingDocument => ({
    widthPx: FRAME.width, heightPx: FRAME.height, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour',
    layers: [
      flatLayer('shadow', SHADOW, WATERCOLOUR_PIGMENTS.ultramarine, 1),
      {
        key: 'figure', ...(!revealed && { reveal: LATE_REVEAL }), sheet: { kind: 'own', paper: FIGURE_PAPER, card: { figure: figureOutline(LEFT.figure), fadePx: FADE_PX } },
        children: [{ key: 'figure-paint', washes: figureWashes('figure') }, { key: 'badge', sheet: { kind: 'own', paper: FIGURE_PAPER }, children: [flatLayer('badge-paint', BADGE, WATERCOLOUR_PIGMENTS.cadmiumRed, 0.8)] }],
      },
      figureLayer('sticker', 'flat'),
    ],
  }),
};

/** The footage: `colour` (FOOTAGE's dark green by default) over the whole stage, one picture uploaded once. */
export function stampGateFootagePlane(stage: StampStage, colour = FOOTAGE): PlaneProps {
  const linear = [1, 3, 5].map((at) => srgbToLinear(Number.parseInt(colour.slice(at, at + 2), 16) / 255));
  const picture: StampPictureRgba = { box: { x: 0, y: 0, w: stage.width, h: stage.height }, rgba: new Float32Array(stage.width * stage.height * 4).map((_, i) => (i % 4 === 3 ? 1 : linear[i % 4])) };
  return { id: 'footage', depth: 2, source: { kind: 'picture', extent: { kind: 'everywhere' }, pictureAt: () => Promise.resolve(picture) } };
}

/**
 * How the figure image's frame places the figure over the footage: `figure`, as a shot's figure; `direct`, its card's
 * group selected on no ground, as a plane placed it before figures; `grounded`, that and the shadow beneath it.
 */
export type StampGateFigurePlacing = 'figure' | 'direct' | 'grounded';

/** The footage, the figure placed as `placing` says (not yet revealed unless `revealed`), and the sticker on a plane of its own. */
export function stampGateFigureImageShot(placing: StampGateFigurePlacing, revealed = true): StampGateShot {
  const stage = stampStage(FRAME, 2), evaluation = painting(STAMP_GATE_FIGURE_IMAGE, { revealed }), at = 0;
  const near = { id: 'figure', depth: 1 } as const;
  const figure = placing === 'figure'
    ? shotPlace(shotFigure(evaluation, 'figure', { at }), near)
    : { ...near, source: layersOf(evaluation, placing === 'grounded' ? ['shadow', 'figure'] : ['figure'], { ground: 'transparent', at }) };
  return {
    camera: { stage, fov: 35, lens: { bloom: 0, shutter: 'shut' }, plays: [] },
    planes: [stampGateFootagePlane(stage), figure, { id: 'sticker', depth: 1.5, source: layersOf(evaluation, ['sticker'], { ground: 'transparent', at }) }],
  };
}

/** The figure image's frames, RGB bytes: the figure placed as a figure, revealed and not; placed directly; and with its shadow. */
export type StampGateFigureImageFrames = { readonly figure: ArrayLike<number>; readonly unrevealed: ArrayLike<number>; readonly direct: ArrayLike<number>; readonly grounded: ArrayLike<number> };

/** Levels the shadow must move the footage's colour by where it's placed, and may where the figure leaves it out, on average over channels. */
const SHADOW_SHOWS = 8, SHADOW_SLACK = 1;
/** How far the badge's red must stand above its green, levels: a cadmium wash, not the figure's umber or the footage. */
const BADGE_RED = 40;

/** Mean of channel `c` of RGB bytes `rgb` over `box`. */
function boxChannel(rgb: ArrayLike<number>, box: StampGateCardShadowsBox, c: number) {
  let sum = 0;
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) sum += rgb[(y * FRAME.width + x) * 3 + c];
  return sum / ((box.x1 - box.x0) * (box.y1 - box.y0));
}

/** How far apart, levels on average over channels, the mean colours of `a` over `boxA` and `b` over `boxB` lie. */
const colourApart = (a: ArrayLike<number>, boxA: StampGateCardShadowsBox, b: ArrayLike<number>, boxB: StampGateCardShadowsBox) =>
  [0, 1, 2].reduce((sum, c) => sum + Math.abs(boxChannel(a, boxA, c) - boxChannel(b, boxB, c)), 0) / 3;

/**
 * shot/figure-image: the figure placed as a shot's figure over footage on a plane of its own lays as its card's group
 * placed directly; leaves out the ground's shadow, which the group placed with it shows; keeps its white, soft edge
 * and reveal as the figure card does (checkStampGateFigureCard), and the card nested in it.
 */
export function checkStampGateFigureImage({ figure, unrevealed, direct, grounded }: StampGateFigureImageFrames) {
  const placed = stampGateFrameDifference(figure, direct);
  const inner = { x0: SHADOW.x0 + 4, y0: SHADOW.y0 + 2, x1: SHADOW.x1 - 4, y1: SHADOW.y1 - 2 }, clear = { x0: 0, y0: 0, x1: FRAME.width, y1: 3 };
  const left = colourApart(figure, inner, figure, clear), shown = colourApart(grounded, inner, figure, clear);
  const badge = { x0: BADGE.x0 + 3, y0: BADGE.y0 + 3, x1: BADGE.x1 - 3, y1: BADGE.y1 - 3 }, red = boxChannel(figure, badge, 0) - boxChannel(figure, badge, 1);
  return [
    {
      id: 'shot/figure-image: placed as its card', passed: stampGateFramePasses(placed),
      detail: `the figure placed as a shot's figure lies ${stampGateFrameDifferenceText(placed)} from its card's group placed directly (${STAMP_GATE_FRAME_TOLERANCE.max} levels allowed)`,
    },
    {
      id: 'shot/figure-image: ground left out', passed: Math.abs(left) <= SHADOW_SLACK && shown >= SHADOW_SHOWS,
      detail: `where the ground's shadow lies the figure moves the footage's colour ${f(left)} levels (${SHADOW_SLACK} allowed); the group placed with its shadow, ${f(shown)} (${SHADOW_SHOWS} or more wanted)`,
    },
    {
      id: 'shot/figure-image: nested card kept', passed: red >= BADGE_RED,
      detail: `the card nested in the figure shows red ${f(red)} levels above green (${BADGE_RED} or more wanted)`,
    },
    ...checkStampGateFigureCard(figure, unrevealed, 'shot/figure-image'),
  ];
}
