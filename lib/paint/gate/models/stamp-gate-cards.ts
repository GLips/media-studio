// stamp-gate-cards.ts: the gate's cut-out cards (shot/cards). A collage card holds a figure of two cels, a marks rig
// showing the standing one, so the lying one is hidden; a leaf owns a card of its own and fades out. A hidden cel
// takes no paper, and the leaf takes its card with its paint: halfway it lies between shown and gone, and gone it
// leaves nothing. Both are measured against the document painted without them.

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

const cardsProperties = { down: { type: 'boolean', default: true }, leaf: { type: 'boolean', default: true } } as const satisfies PropertySchema;

/**
 * A sky over the whole sheet; a `collage` card of warm paper holding a `figure` of cels `up` and, `down`, `down`
 * (lying where `up` isn't, painted once `up` is dry so its water leaves `up` alone); and, `leaf`, a `leaf` owning a
 * card of cool paper.
 */
export const STAMP_GATE_CARDS: PaintingSourceModule<typeof cardsProperties> = {
  properties: cardsProperties,
  default: function gateCards({ down, leaf }: PropertyValues<typeof cardsProperties>): PaintingDocument {
    const umber = { parts: [{ pigment: burntUmber, amount: 1 }], strength: 0.6 };
    const cels: LayerNode[] = [
      stampGateHeronLayer('up', stampGateHeronPolygon(34, 18, 64, 14, 72, 66, 28, 70), umber, 0.7),
      ...(down ? [stampGateHeronLayer('down', stampGateHeronPolygon(20, 94, 86, 86, 92, 114, 16, 120), umber, 0.7, 'dry')] : []),
    ];
    const leafLayer: LayerNode = {
      ...stampGateHeronLayer('leaf', stampGateHeronPolygon(122, 40, 174, 26, 184, 96, 134, 106), { parts: [{ pigment: phthaloGreen, amount: 1 }], strength: 0.5 }, 0.7),
      sheet: { kind: 'own', paper: stampGateHeronPaper('#d8e6d0', 1.9) },
    };
    return {
      widthPx: CARDS.width, heightPx: CARDS.height, paper: stampGateHeronPaper('#f3eee2', 1), medium: 'watercolour',
      layers: [
        stampGateHeronLayer('sky', stampGateHeronPolygon(0, 0, 200, 0, 200, 140, 0, 140), { parts: [{ pigment: cerulean, amount: 1 }], strength: 0.5 }, 0.8),
        { key: 'collage', sheet: { kind: 'own', paper: stampGateHeronPaper('#f0dcb4', 1.43) }, children: [{ key: 'figure', children: cels }] },
        ...(leaf ? [leafLayer] : []),
      ],
    };
  },
};

/** The figure's rig, its one part showing `up` at rest; `down`, `down` its second cel. */
export const stampGateCardParts = (down: boolean): readonly RigPart[] => [{ id: 'figure', z: 0, parent: null, cels: down ? ['up', 'down'] : ['up'] }];

/** The cards shot's frames: the leaf shown, faded halfway (its baseline's frame) and gone. */
export const STAMP_GATE_CARDS_AT = { shown: 0, faded: 1, gone: 2 } as const;

/** The leaf's visibility by scene second, each row from its `from` on. */
export const STAMP_GATE_CARDS_LEAF = [{ from: STAMP_GATE_CARDS_AT.shown, visibility: 1 }, { from: STAMP_GATE_CARDS_AT.faded, visibility: 0.5 }, { from: STAMP_GATE_CARDS_AT.gone, visibility: 0 }] as const;

/**
 * The cards on one still plane, the figure rigged at rest, the leaf fading by STAMP_GATE_CARDS_LEAF; painted with
 * `down` and `leaf` as the document's properties say.
 */
export function stampGateCardsShot({ down = true, leaf = true }: { down?: boolean; leaf?: boolean } = {}): PaintedShotProps {
  const evaluation = painting(STAMP_GATE_CARDS, { down, leaf });
  const fading = ({ at }: PaintMoment) => STAMP_GATE_CARDS_LEAF.findLast(({ from }) => from <= at)!.visibility;
  return {
    camera: { stage: stampStage(CARDS, 2), fov: 35, lens: { bloom: 0, shutter: 0 }, plays: [] },
    planes: [{ id: 'cards', depth: 1, source: layersOf(evaluation, leaf ? ['sky', 'collage', 'leaf'] : ['sky', 'collage']) }],
    rigs: { 'cards/figure': { parts: stampGateCardParts(down), pose: {} } },
    ...(leaf && { visibility: { 'cards/leaf': fading } }),
  };
}
