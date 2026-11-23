// stamp-gate-card-shutter.ts: the gate's card moving within its plane under the film's open shutter
// (shot/card-shutter). A diamond card slides fast across striped ground; the stripes in its edge box's corners, which
// it never covers while the shutter's open, must stay as sharp as with no card at all, while the card itself blurs
// along its slide. Measured against the shot painted without the card.

import { paintKeyed } from '#lib/paint/animation/models/paint-keyed.ts';
import { paintFilmShutter } from '#lib/paint/animation/models/paint-camera.ts';
import type { PaintingDocument, Region } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { STAMP_GATE_FRAME_TOLERANCE, stampGateFrameDifference, stampGateFrameDifferenceText, stampGateFramePasses } from './stamp-gate-frames.ts';
import { stampGateBoxCrop, type StampGateCardShadowsBox } from './stamp-gate-card-shadows.ts';
import { stampGateHeronLayer, stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';
import { STAMP_GATE_SHOT_FPS, type StampGateShot } from './stamp-gate-shot-span.ts';

const FRAME = { width: 200, height: 140 } as const;
const { burntUmber, cerulean, ultramarine } = WATERCOLOUR_PIGMENTS;

/** The diamond card: its centre at rest and its half-diagonal, document px. */
const DIAMOND = { x: 100, y: 70, r: 32 } as const;
/** The stripes: one `width` px wide every `pitch` px, across the whole frame. */
const STRIPES = { width: 4, pitch: 8 } as const;

/** The scene second checked, and how fast the card slides right through it, px a second. */
export const STAMP_GATE_CARD_SHUTTER = { at: 0.5, speed: 1200 } as const;
/** How far the card slides while the film's shutter is open, px. */
const TRAVEL = STAMP_GATE_CARD_SHUTTER.speed * paintFilmShutter(STAMP_GATE_SHOT_FPS);

/**
 * The corners of the card's edge box, 3–8 px in from each side: with the shutter open about the frame's moment, the
 * card slides TRAVEL / 2 either way, and that keeps 6 px of ground (L1) between it and each window.
 */
const CORNERS: readonly StampGateCardShadowsBox[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => {
  const x = DIAMOND.x + sx * (DIAMOND.r - 3), y = DIAMOND.y + sy * (DIAMOND.r - 3);
  return { x0: Math.min(x, x - sx * 5), x1: Math.max(x, x - sx * 5) + 1, y0: Math.min(y, y - sy * 5), y1: Math.max(y, y - sy * 5) + 1 };
});

const cardShutterProperties = { card: { type: 'boolean', default: true } } as const satisfies PropertySchema;

const stripesRegion = (): Region => ({
  kind: 'polygon',
  rings: Array.from({ length: Math.ceil(FRAME.width / STRIPES.pitch) }, (_, i) => {
    const x0 = i * STRIPES.pitch, x1 = x0 + STRIPES.width;
    return [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: FRAME.height }, { x: x0, y: FRAME.height }];
  }),
});

/** A pale sky, dark stripes over it once it's dry, and, `card`, the diamond card on a sheet of its own. */
export const STAMP_GATE_CARD_SHUTTER_PAINTING: PaintingSourceModule<typeof cardShutterProperties> = {
  properties: cardShutterProperties,
  default: function gateCardShutter({ card }: PropertyValues<typeof cardShutterProperties>): PaintingDocument {
    const { x, y, r } = DIAMOND;
    return {
      widthPx: FRAME.width, heightPx: FRAME.height, paper: stampGateHeronPaper('#f3eee2', 1), medium: 'watercolour',
      layers: [
        stampGateHeronLayer('sky', stampGateHeronPolygon(0, 0, 200, 0, 200, 140, 0, 140), { parts: [{ pigment: cerulean, amount: 1 }], strength: 0.3 }, 0.8),
        stampGateHeronLayer('stripes', stripesRegion(), { parts: [{ pigment: burntUmber, amount: 1 }], strength: 0.8 }, 0.6, 'dry'),
        ...(card ? [{
          ...stampGateHeronLayer('card', stampGateHeronPolygon(x, y - r, x + r, y, x, y + r, x - r, y), { parts: [{ pigment: ultramarine, amount: 1 }], strength: 0.5 }, 0.7),
          // Flat: no shadow or lip reaching the corners, so what they measure is the motion alone.
          sheet: { kind: 'own', paper: stampGateHeronPaper('#f0dcb4', 1.43), card: 'flat' },
        } as const] : []),
      ],
    };
  },
};

/** The striped plane, the card sliding right through `at` at `speed`, under the film's shutter or `shut`; painted without the card unless `card`. */
export function stampGateCardShutterShot({ card = true, shut = false }: { card?: boolean; shut?: boolean } = {}): StampGateShot {
  const evaluation = painting(STAMP_GATE_CARD_SHUTTER_PAINTING, { card }), { at, speed } = STAMP_GATE_CARD_SHUTTER, reach = 0.05;
  const slide = paintKeyed([{ at: at - reach, value: { x: -speed * reach } }, { at: at + reach, value: { x: speed * reach } }]);
  return {
    camera: { stage: stampStage(FRAME, 8), fov: 35, lens: shut ? { bloom: 0, shutter: 'shut' } : { bloom: 0 }, plays: [] },
    planes: [{
      id: 'striped', depth: 1, source: layersOf(evaluation, card ? ['sky', 'stripes', 'card'] : ['sky', 'stripes']),
      ...(card && { occurrences: { card: { plays: [{ clip: { kind: 'place', value: slide }, clock: { at: 0 }, origin: 'the card slides right' }] } } }),
    }],
  };
}

/** The frames the checks read, RGB bytes: the card under the film's shutter and shut, and the ground alone under each. */
export type StampGateCardShutterFrames = {
  readonly open: ArrayLike<number>; readonly shut: ArrayLike<number>; readonly groundOpen: ArrayLike<number>; readonly groundShut: ArrayLike<number>;
};

/** The columns where `a` and `b` differ past the frame tolerance, as [first, last]; null where they never do. */
function differingColumns(a: ArrayLike<number>, b: ArrayLike<number>): readonly [number, number] | null {
  let first = Infinity, last = -Infinity;
  for (let i = 0; i < a.length; i += 3) {
    const x = (i / 3) % FRAME.width;
    if ([0, 1, 2].some((c) => Math.abs(a[i + c] - b[i + c]) > STAMP_GATE_FRAME_TOLERANCE.max)) { first = Math.min(first, x); last = Math.max(last, x); }
  }
  return Number.isFinite(first) ? [first, last] : null;
}

const spanWidth = (span: readonly [number, number] | null) => (span ? span[1] - span[0] + 1 : 0);
const spanText = (span: readonly [number, number] | null) => (span ? `x ${span[0]}..${span[1]}` : 'nothing');

/**
 * shot/card-shutter: a card sliding within its plane under the film's shutter leaves the ground in its edge box's
 * corners as the ground alone draws, and blurs along its slide, wider than shut by at least half its travel.
 */
export function checkStampGateCardShutter({ open, shut, groundOpen, groundShut }: StampGateCardShutterFrames) {
  const corners = CORNERS.map((box) => stampGateFrameDifference(stampGateBoxCrop(open, FRAME.width, box), stampGateBoxCrop(groundOpen, FRAME.width, box)));
  const [openSpan, shutSpan] = [differingColumns(open, groundOpen), differingColumns(shut, groundShut)];
  return [
    {
      id: 'shot/card-shutter: ground stays sharp', passed: corners.every(stampGateFramePasses),
      detail: `in its edge box's four corners, the card sliding ${TRAVEL} px under the open shutter leaves the stripes ${corners.map(stampGateFrameDifferenceText).join('; ')} from the ground alone (${STAMP_GATE_FRAME_TOLERANCE.max} levels allowed)`,
    },
    {
      id: 'shot/card-shutter: card blurs', passed: spanWidth(openSpan) >= spanWidth(shutSpan) + TRAVEL / 2 && spanWidth(shutSpan) > 0,
      detail: `against the ground alone, the card changes ${spanText(openSpan)} under the open shutter and ${spanText(shutSpan)} shut (at least ${TRAVEL / 2} px wider open wanted)`,
    },
  ];
}
