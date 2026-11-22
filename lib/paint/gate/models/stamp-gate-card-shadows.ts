// stamp-gate-card-shadows.ts: the gate's cards catching the light (shot/card-shadows). Six own sheets over a sky,
// under PAPER_KEY_LIGHT from the upper left: one still; a parent whose child card hangs over its edge, its second
// film laid after the child (its rim must stay under the child); one turning about its centre (its lip stays on the
// edge facing the light); one fading out; one `flat`; one moving right. Each is measured against the shot painted with
// every card flat, so what differs is the light alone.

import { paintKeyed } from '#lib/paint/animation/models/paint-keyed.ts';
import type { LayerNode, Mix, PaintingDocument, Sheet, SheetCard } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { STAMP_GATE_FRAME_TOLERANCE, stampGateFrameDifference, stampGateFrameDifferenceText, stampGateFramePasses } from './stamp-gate-frames.ts';
import { stampGateHeronLayer, stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

const CARD_SHADOWS = { width: 200, height: 140 } as const;
const { cerulean, burntUmber, phthaloGreen, yellowOchre } = WATERCOLOUR_PIGMENTS;

/** A box of frame px, `x0`..`x1` and `y0`..`y1` exclusive: what a check measures over. */
export type StampGateCardShadowsBox = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

/** Each card's outline, document px (x, y pairs), and its frames' boxes the checks read. */
export const STAMP_GATE_CARD_SHADOWS = {
  still: [16, 16, 60, 14, 62, 56, 18, 60],
  nest: [76, 14, 124, 16, 122, 60, 78, 58],
  /** The nest's child card, hanging over the nest's right edge. */
  chip: [108, 26, 136, 28, 134, 50, 110, 48],
  /** The nest's second film, laid after the chip. */
  over: [84, 40, 100, 40, 100, 54, 84, 54],
  turner: [150, 16, 186, 16, 186, 52, 150, 52],
  fader: [16, 80, 60, 80, 60, 124, 16, 124],
  flat: [80, 80, 124, 80, 124, 124, 80, 124],
  mover: [146, 84, 172, 84, 172, 110, 146, 110],
} as const;

/** The scene seconds checked: all at rest; the turner a quarter round, the fader half gone, the mover partway; then the turner half round, the fader gone, the mover there. */
export const STAMP_GATE_CARD_SHADOWS_AT = { rest: 0, mid: 1, end: 2 } as const;

/** How far the mover travels right by `end`, px, and where the turner turns about. */
const MOVER_TRAVEL = 16;
const TURNER_PIVOT = { x: 168, y: 34 } as const;

/** The fader's visibility at each checked second. */
export const STAMP_GATE_CARD_SHADOWS_FADE = [{ from: 0, visibility: 1 }, { from: 1, visibility: 0.5 }, { from: 2, visibility: 0 }] as const;

/**
 * Where the checks look, frame px: just past the still card's lower edge (where its shadow falls) and upper edge
 * (where none may); a band round the flat card and the fader; the nest's right edge under the chip and below it; the
 * turner's top and bottom edge bands; and past the mover's lower edge once moved.
 */
export const STAMP_GATE_CARD_SHADOWS_LOOK = {
  belowStill: { x0: 24, y0: 61, x1: 56, y1: 64 },
  aboveStill: { x0: 22, y0: 8, x1: 56, y1: 12 },
  aroundFlat: { x0: 72, y0: 72, x1: 132, y1: 132 },
  aroundFader: { x0: 8, y0: 72, x1: 68, y1: 132 },
  belowFader: { x0: 22, y0: 125, x1: 58, y1: 129 },
  nestEdgeUnderChip: { x0: 121, y0: 31, x1: 126, y1: 45 },
  nestEdgeBelowChip: { x0: 117, y0: 53, x1: 124, y1: 59 },
  turnerTop: { x0: 154, y0: 16, x1: 182, y1: 18 },
  turnerBottom: { x0: 154, y0: 50, x1: 182, y1: 52 },
  belowMover: { x0: 166, y0: 111, x1: 186, y1: 114 },
} as const satisfies Readonly<Record<string, StampGateCardShadowsBox>>;

const cardShadowsProperties = { lit: { type: 'boolean', default: true }, nestRim: { type: 'boolean', default: true } } as const satisfies PropertySchema;

/**
 * The sky, then the six cards. `lit` false paints every card flat, the light's absence to measure against; `nestRim`
 * false turns the nest's rim off alone.
 */
export const STAMP_GATE_CARD_SHADOWS_PAINTING: PaintingSourceModule<typeof cardShadowsProperties> = {
  properties: cardShadowsProperties,
  default: function gateCardShadows({ lit, nestRim }: PropertyValues<typeof cardShadowsProperties>): PaintingDocument {
    const umber: Mix = { parts: [{ pigment: burntUmber, amount: 1 }], strength: 0.6 }, green = { parts: [{ pigment: phthaloGreen, amount: 1 }], strength: 0.5 };
    const ochre: Mix = { parts: [{ pigment: yellowOchre, amount: 1 }], strength: 0.6 };
    const own = (color: `#${string}`, card?: SheetCard): Sheet => ({ kind: 'own', paper: stampGateHeronPaper(color, 1.43), ...(!lit ? { card: 'flat' } : card && { card }) });
    const outline = (key: keyof typeof STAMP_GATE_CARD_SHADOWS) => stampGateHeronPolygon(...STAMP_GATE_CARD_SHADOWS[key]);
    const card = (key: keyof typeof STAMP_GATE_CARD_SHADOWS, color: `#${string}`, mix: Mix = umber, sheetCard?: SheetCard): LayerNode =>
      ({ ...stampGateHeronLayer(key, outline(key), mix, 0.7), sheet: own(color, sheetCard) });
    return {
      widthPx: CARD_SHADOWS.width, heightPx: CARD_SHADOWS.height, paper: stampGateHeronPaper('#f3eee2', 1), medium: 'watercolour',
      layers: [
        stampGateHeronLayer('sky', stampGateHeronPolygon(0, 0, 200, 0, 200, 140, 0, 140), { parts: [{ pigment: cerulean, amount: 1 }], strength: 0.35 }, 0.8),
        card('still', '#f0dcb4'),
        {
          key: 'nest', sheet: own('#e8d6b0', nestRim ? undefined : { rim: false }), children: [
            stampGateHeronLayer('nest-under', outline('nest'), ochre, 0.7),
            card('chip', '#d8e6d0', green),
            stampGateHeronLayer('nest-over', outline('over'), umber, 0.7, 'dry'),
          ],
        },
        card('turner', '#f3e3c3'),
        card('fader', '#f0dcb4'),
        card('flat', '#e6dcc8', umber, 'flat'),
        card('mover', '#f0dcb4'),
      ],
    };
  },
};

const fadeAt = ({ at }: PaintMoment) => STAMP_GATE_CARD_SHADOWS_FADE.findLast(({ from }) => from <= at)!.visibility;

/** The cards on one still plane, painted as `painted` says: the turner turning half round, the fader fading out, the mover moving right. */
export function stampGateCardShadowsShot(painted: { lit?: boolean; nestRim?: boolean } = {}): StampGateShot {
  const evaluation = painting(STAMP_GATE_CARD_SHADOWS_PAINTING, painted), { end } = STAMP_GATE_CARD_SHADOWS_AT;
  return {
    camera: { stage: stampStage(CARD_SHADOWS, 8), fov: 35, lens: { bloom: 0, shutter: 'shut' }, plays: [] },
    planes: [{
      id: 'cards', depth: 1, source: layersOf(evaluation, ['sky', 'still', 'nest', 'turner', 'fader', 'flat', 'mover']),
      occurrences: {
        turner: {
          pivot: TURNER_PIVOT,
          plays: [{ clip: { kind: 'place', value: paintKeyed([{ at: 0, value: { rotation: 0 } }, { at: end, value: { rotation: Math.PI } }]) }, clock: { at: 0 }, origin: 'the turner turns half round' }],
        },
        fader: { visibility: fadeAt },
        mover: { plays: [{ clip: { kind: 'place', value: paintKeyed([{ at: 0, value: { x: 0 } }, { at: end, value: { x: MOVER_TRAVEL } }]) }, clock: { at: 0 }, origin: 'the mover moves right' }] },
      },
    }],
  };
}

/** The mean luma (Rec. 709 weights, bytes as they are) of RGB bytes `rgb`, `width` px a row, over `box`. */
export function stampGateBoxLuma(rgb: ArrayLike<number>, width: number, box: StampGateCardShadowsBox): number {
  let sum = 0, count = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const at = (y * width + x) * 3;
      sum += 0.2126 * rgb[at] + 0.7152 * rgb[at + 1] + 0.0722 * rgb[at + 2];
      count++;
    }
  }
  return sum / count;
}

/** RGB bytes `rgb`, `width` px a row, cropped to `box`, row by row. */
export function stampGateBoxCrop(rgb: ArrayLike<number>, width: number, box: StampGateCardShadowsBox): number[] {
  const crop: number[] = [];
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) for (let c = 0; c < 3; c++) crop.push(rgb[(y * width + x) * 3 + c]);
  return crop;
}

/**
 * The frames the checks read, RGB bytes: the cards lit at rest, midway and at the end; painted flat at the same three;
 * and lit with the nest's rim off, at rest.
 */
export type StampGateCardShadowsFrames = {
  readonly lit: readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>];
  readonly flat: readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>];
  readonly nestRimOff: ArrayLike<number>;
};

const f = (value: number) => value.toFixed(3);

/** How much darker than flat a shadow must make what it falls on, and the darkest it may make it: never toward black. */
const SHADOW_DARKER = 0.95, SHADOW_FLOOR = 0.5;
/** How far a half-faded card's shadow may stray from half its full darkening, as a share of the luma. */
const HALF_SHADOW_SLACK = 0.03;
/** How much more of its flat luma the turner's lit edge must keep than its far edge. */
const LIP_LIFT = 0.03;

/**
 * shot/card-shadows: a card's shadow falls away from the light and never toward black; a flat card changes nothing; a
 * fading card's shadow fades with it, half as dark halfway, gone with it; a parent's rim never shows through its child
 * card; a turning card's lip stays on the edge facing the light; a moving card's shadow moves with it.
 */
export function checkStampGateCardShadows({ lit, flat, nestRimOff }: StampGateCardShadowsFrames) {
  const { width } = CARD_SHADOWS, look = STAMP_GATE_CARD_SHADOWS_LOOK;
  const ratio = (a: ArrayLike<number>, b: ArrayLike<number>, box: StampGateCardShadowsBox) => stampGateBoxLuma(a, width, box) / stampGateBoxLuma(b, width, box);
  const crops = (a: ArrayLike<number>, b: ArrayLike<number>, box: StampGateCardShadowsBox) => stampGateFrameDifference(stampGateBoxCrop(a, width, box), stampGateBoxCrop(b, width, box));
  const [rest, mid, end] = [0, 1, 2] as const;
  const below = ratio(lit[rest], flat[rest], look.belowStill), above = ratio(lit[rest], flat[rest], look.aboveStill);
  const darkest = Math.min(...Array.from({ length: look.belowStill.x1 - look.belowStill.x0 }, (_, i) => {
    const column = { ...look.belowStill, x0: look.belowStill.x0 + i, x1: look.belowStill.x0 + i + 1 };
    return ratio(lit[rest], flat[rest], column);
  }));
  const flatCard = crops(lit[rest], flat[rest], look.aroundFlat);
  const [fullFade, halfFade] = [ratio(lit[rest], flat[rest], look.belowFader), ratio(lit[mid], flat[mid], look.belowFader)], goneFade = crops(lit[end], flat[end], look.aroundFader);
  const underChip = crops(lit[rest], nestRimOff, look.nestEdgeUnderChip), belowChip = crops(lit[rest], nestRimOff, look.nestEdgeBelowChip);
  const lip = [rest, end].map((at) => ratio(lit[at], flat[at], look.turnerTop) - ratio(lit[at], flat[at], look.turnerBottom));
  const moved = ratio(lit[end], flat[end], look.belowMover);
  return [
    {
      id: 'shot/card-shadows: cast away from the light', passed: below < SHADOW_DARKER && darkest >= SHADOW_FLOOR && above >= SHADOW_DARKER,
      detail: `past the still card's lower edge it keeps ${f(below)} of its flat luma (below ${SHADOW_DARKER} wanted), its darkest column ${f(darkest)} (${SHADOW_FLOOR} or more: never toward black); past its upper edge, toward the light, ${f(above)}`,
    },
    {
      id: 'shot/card-shadows: flat', passed: stampGateFramePasses(flatCard),
      detail: `round the flat card the lit shot lies ${stampGateFrameDifferenceText(flatCard)} from it painted flat (${STAMP_GATE_FRAME_TOLERANCE.max} levels allowed)`,
    },
    {
      id: 'shot/card-shadows: fade', passed: fullFade < SHADOW_DARKER && Math.abs((1 - halfFade) - (1 - fullFade) / 2) <= HALF_SHADOW_SLACK && stampGateFramePasses(goneFade),
      detail: `past the fader's lower edge it keeps ${f(fullFade)} of its flat luma shown and ${f(halfFade)} half faded (half the darkening wanted, within ${HALF_SHADOW_SLACK}); gone, round it the lit shot lies ${stampGateFrameDifferenceText(goneFade)} from it painted flat`,
    },
    {
      id: 'shot/card-shadows: rim under a child card', passed: stampGateFramePasses(underChip) && !stampGateFramePasses(belowChip),
      detail: `the nest's rim switched off changes its right edge under the chip by ${stampGateFrameDifferenceText(underChip)} (nothing wanted: the chip lies over it) and below the chip by ${stampGateFrameDifferenceText(belowChip)} (its rim wanted)`,
    },
    {
      id: 'shot/card-shadows: lip toward the light', passed: lip.every((lift) => lift >= LIP_LIFT),
      detail: `the turner's top edge, toward the light, keeps ${lip.map(f).join(' and ')} more of its flat luma than its bottom edge at rest and turned half round (${LIP_LIFT} or more wanted)`,
    },
    {
      id: 'shot/card-shadows: moves with its card', passed: moved < SHADOW_DARKER,
      detail: `past the moved card's lower edge it keeps ${f(moved)} of its flat luma (below ${SHADOW_DARKER} wanted)`,
    },
  ];
}
