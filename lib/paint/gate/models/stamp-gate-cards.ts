// stamp-gate-cards.ts: the gate's cut-out cards (shot/cards). A collage card holds a figure of two cels, a marks rig
// showing the standing one, so the lying one is hidden, and a sitting view beside it, switched off until `sitting`; a
// leaf owns a card of its own and fades out. A hidden cel and a view switched off take no paper, and the leaf takes
// its card with its paint: halfway it lies between shown and gone, and gone it leaves nothing. Each is measured
// against the document painted without it.

import type { LayerNode, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { PaintedShotProps, RigPart } from '#lib/paint/shot/models/shot-props.ts';
import { stampGateHeronLayer, stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';

const CARDS = { width: 200, height: 140 } as const;
const { cerulean, burntUmber, phthaloGreen } = WATERCOLOUR_PIGMENTS;

const cardsProperties = {
  down: { type: 'boolean', default: true }, sitting: { type: 'boolean', default: true }, leaf: { type: 'boolean', default: true },
} as const satisfies PropertySchema;

/**
 * A sky; a `collage` card of warm paper holding a `figure` of cels `up` and, `down`, `down` (lying where `up` isn't),
 * and, `sitting`, a `sitting` view of a `seat`, each painted once what's before it is dry so its water leaves the
 * rest alone; and, `leaf`, a `leaf` owning a card of cool paper.
 */
export const STAMP_GATE_CARDS: PaintingSourceModule<typeof cardsProperties> = {
  properties: cardsProperties,
  default: function gateCards({ down, sitting, leaf }: PropertyValues<typeof cardsProperties>): PaintingDocument {
    const umber = { parts: [{ pigment: burntUmber, amount: 1 }], strength: 0.6 };
    const cels: LayerNode[] = [
      stampGateHeronLayer('up', stampGateHeronPolygon(34, 18, 64, 14, 72, 66, 28, 70), umber, 0.7),
      ...(down ? [stampGateHeronLayer('down', stampGateHeronPolygon(20, 94, 86, 86, 92, 114, 16, 120), umber, 0.7, 'dry')] : []),
    ];
    const view: LayerNode = { key: 'sitting', children: [stampGateHeronLayer('seat', stampGateHeronPolygon(88, 30, 110, 26, 112, 74, 90, 78), umber, 0.7, 'dry')] };
    const leafLayer: LayerNode = {
      ...stampGateHeronLayer('leaf', stampGateHeronPolygon(122, 40, 174, 26, 184, 96, 134, 106), { parts: [{ pigment: phthaloGreen, amount: 1 }], strength: 0.5 }, 0.7),
      sheet: { kind: 'own', paper: stampGateHeronPaper('#d8e6d0', 1.9) },
    };
    return {
      widthPx: CARDS.width, heightPx: CARDS.height, paper: stampGateHeronPaper('#f3eee2', 1), medium: 'watercolour',
      layers: [
        stampGateHeronLayer('sky', stampGateHeronPolygon(0, 0, 200, 0, 200, 140, 0, 140), { parts: [{ pigment: cerulean, amount: 1 }], strength: 0.5 }, 0.8),
        { key: 'collage', sheet: { kind: 'own', paper: stampGateHeronPaper('#f0dcb4', 1.43) }, children: [{ key: 'figure', children: cels }, ...(sitting ? [view] : [])] },
        ...(leaf ? [leafLayer] : []),
      ],
    };
  },
};

/** The figure's rig, its one part showing `up` at rest; `down`, `down` its second cel. */
export const stampGateCardParts = (down: boolean): readonly RigPart[] => [{ id: 'figure', z: 0, parent: null, cels: down ? ['up', 'down'] : ['up'] }];

/** The cards shot's frames: the leaf shown, faded halfway (its baseline's frame) and gone; then the sitting view shown. */
export const STAMP_GATE_CARDS_AT = { shown: 0, faded: 1, gone: 2, sitting: 3 } as const;

/** A visibility by scene second, each row from its `from` on. */
type StampGateCardsVisibility = readonly { readonly from: number; readonly visibility: number }[];

/** The leaf's visibility by scene second. */
export const STAMP_GATE_CARDS_LEAF = [{ from: STAMP_GATE_CARDS_AT.shown, visibility: 1 }, { from: STAMP_GATE_CARDS_AT.faded, visibility: 0.5 }, { from: STAMP_GATE_CARDS_AT.gone, visibility: 0 }] as const;

/** The sitting view's visibility by scene second: switched off until `sitting`. */
export const STAMP_GATE_CARDS_SITTING = [{ from: STAMP_GATE_CARDS_AT.shown, visibility: 0 }, { from: STAMP_GATE_CARDS_AT.sitting, visibility: 1 }] as const;

const visibilityBy = (rows: StampGateCardsVisibility) => ({ at }: PaintMoment) => rows.findLast(({ from }) => from <= at)!.visibility;

/**
 * The cards on one still plane, the figure rigged at rest, the sitting view and the leaf switched and fading by their
 * tables; painted with `down`, `sitting` and `leaf` as the document's properties say.
 */
export function stampGateCardsShot({ down = true, sitting = true, leaf = true }: { down?: boolean; sitting?: boolean; leaf?: boolean } = {}): PaintedShotProps {
  const evaluation = painting(STAMP_GATE_CARDS, { down, sitting, leaf });
  return {
    camera: { stage: stampStage(CARDS, 2), fov: 35, lens: { bloom: 0, shutter: 0 }, plays: [] },
    planes: [{ id: 'cards', depth: 1, source: layersOf(evaluation, leaf ? ['sky', 'collage', 'leaf'] : ['sky', 'collage']) }],
    rigs: { 'cards/figure': { parts: stampGateCardParts(down), pose: {} } },
    visibility: {
      ...(sitting && { 'cards/sitting': visibilityBy(STAMP_GATE_CARDS_SITTING) }),
      ...(leaf && { 'cards/leaf': visibilityBy(STAMP_GATE_CARDS_LEAF) }),
    },
  };
}
