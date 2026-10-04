// stamp-gate-pieces.ts: the gate's sprig drawn as pieces (shot/pieces). A sprig owns its card and is rigged, so it's
// drawn as pieces: a flag of two cels of different colours, a bud whose cel is a petal and a rim, a seed of a painted
// cel and a clear one, and a leaf last. Every film is laid by its own palette and drying whatever's hidden ahead of
// it: the flag swapped, the rim switched off and the seed hidden by its clear cel each draw as the sprig with what's
// hidden painted clear, every cel a part of its own, so nothing is left out of it.

import type { Layer, LayerNode, Mix, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { PaintedShotProps, RigPart, RigPartPose } from '#lib/paint/shot/models/shot-props.ts';
import { stampGateHeronLayer, stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';

const PIECES = { width: 200, height: 140 } as const;
const { cerulean, yellowOchre, ultramarine, quinacridoneRose, burntSienna, phthaloBlue, phthaloGreen } = WATERCOLOUR_PIGMENTS;
const mixOf = (pigment: Mix['parts'][number]['pigment'], strength: number): Mix => ({ parts: [{ pigment, amount: 1 }], strength });

/** A sprig layer over `polygon`, dry over what's before it unless `first`; painted clear unless `painted`. */
const sprigLayer = (key: string, polygon: readonly number[], mix: Mix, { painted = true, first = false } = {}): Layer =>
  (painted ? stampGateHeronLayer(key, stampGateHeronPolygon(...polygon), mix, 0.7, first ? undefined : 'dry') : { key, washes: [] });

// The layers some frame hides, each painted unless its property is false: the flag's `ochre` and `blue` cels, the
// bud's `rim` and the `seed`. A layer's place on its sheet names its deposits and so seeds them: one left out would
// repaint every later one, so one not painted is painted clear in its place.
const piecesProperties = {
  ochre: { type: 'boolean', default: true }, blue: { type: 'boolean', default: true }, rim: { type: 'boolean', default: true }, seed: { type: 'boolean', default: true },
} as const satisfies PropertySchema;

/**
 * A sky; and a `sprig` owning a card of warm paper: a two-cel flag, a petal-and-rim `bud`, a `seed` and its clear
 * cel, and a `leaf`, each painted dry over the last.
 */
export const STAMP_GATE_PIECES: PaintingSourceModule<typeof piecesProperties> = {
  properties: piecesProperties,
  default: function gatePieces({ ochre, blue, rim, seed }: PropertyValues<typeof piecesProperties>): PaintingDocument {
    const bud: LayerNode = {
      key: 'bud',
      children: [
        sprigLayer('bud-petal', [62, 22, 94, 18, 98, 60, 66, 64], mixOf(quinacridoneRose, 0.6)),
        sprigLayer('bud-rim', [62, 74, 98, 70, 100, 86, 64, 90], mixOf(burntSienna, 0.7), { painted: rim }),
      ],
    };
    const sprig: LayerNode[] = [
      sprigLayer('flag-ochre', [12, 18, 44, 14, 48, 56, 16, 60], mixOf(yellowOchre, 0.7), { painted: ochre, first: true }),
      sprigLayer('flag-blue', [12, 78, 44, 74, 48, 118, 16, 122], mixOf(ultramarine, 0.6), { painted: blue }),
      bud,
      sprigLayer('seed', [112, 30, 144, 26, 148, 70, 116, 74], mixOf(phthaloBlue, 0.5), { painted: seed }),
      { key: 'seed-clear', washes: [] },
      sprigLayer('leaf', [160, 40, 188, 30, 192, 100, 166, 108], mixOf(phthaloGreen, 0.5)),
    ];
    return {
      widthPx: PIECES.width, heightPx: PIECES.height, paper: stampGateHeronPaper('#f3eee2', 1), medium: 'watercolour',
      layers: [
        stampGateHeronLayer('sky', stampGateHeronPolygon(0, 0, 200, 0, 200, 140, 0, 140), mixOf(cerulean, 0.35), 0.8),
        { key: 'sprig', sheet: { kind: 'own', paper: stampGateHeronPaper('#f0dcb4', 1.43) }, children: sprig },
      ],
    };
  },
};

/** The sprig's rig, each part a root: the flag, swapping to its blue cel; the bud; the seed, clearing; the leaf. */
export const STAMP_GATE_PIECES_PARTS: readonly RigPart[] = [
  { id: 'flag', z: 0, parent: null, cels: ['flag-ochre', 'flag-blue'] },
  { id: 'bud', z: 1, parent: null, cels: ['bud'] },
  { id: 'seed', z: 2, parent: null, cels: ['seed', 'seed-clear'] },
  { id: 'leaf', z: 3, parent: null, cels: ['leaf'] },
];

/** The sprig's every cel a part of its own, so all show at rest and none is left out of what's laid. */
export const STAMP_GATE_PIECES_FLAT_PARTS: readonly RigPart[] = ['flag-ochre', 'flag-blue', 'bud', 'seed', 'seed-clear', 'leaf'].map((cel, z) => ({ id: cel, z, parent: null, cels: [cel] }));

/** The pieces shot's frames: at rest; the flag swapped; the rim off; the seed cleared; and all three, its baseline's frame. */
export const STAMP_GATE_PIECES_AT = { rest: 0, swapped: 1, off: 2, cleared: 3, all: 4 } as const;

const SWAPPED = { flag: { cel: 'flag-blue' } } as const, CLEARED = { seed: { cel: 'seed-clear' } } as const;

/** The sprig's pose and its rim's visibility by scene second, each row from its `from` on. */
export const STAMP_GATE_PIECES_TABLE: readonly { readonly from: number; readonly pose: Readonly<Record<string, RigPartPose>>; readonly rim: number }[] = [
  { from: STAMP_GATE_PIECES_AT.rest, pose: {}, rim: 1 },
  { from: STAMP_GATE_PIECES_AT.swapped, pose: SWAPPED, rim: 1 },
  { from: STAMP_GATE_PIECES_AT.off, pose: {}, rim: 0 },
  { from: STAMP_GATE_PIECES_AT.cleared, pose: CLEARED, rim: 1 },
  { from: STAMP_GATE_PIECES_AT.all, pose: { ...SWAPPED, ...CLEARED }, rim: 0 },
];

const rowAt = ({ at }: PaintMoment) => STAMP_GATE_PIECES_TABLE.findLast(({ from }) => from <= at)!;

/** The sprig on one still plane, painted as `painted` says, rigged as `rig` says. */
const piecesShot = (painted: Partial<PropertyValues<typeof piecesProperties>>, rig: Pick<NonNullable<PaintedShotProps['rigs']>[string], 'parts' | 'pose'>): PaintedShotProps => ({
  camera: { stage: stampStage(PIECES, 2), fov: 35, lens: { bloom: 0, shutter: 0 }, plays: [] },
  planes: [{ id: 'pieces', depth: 1, source: layersOf(painting(STAMP_GATE_PIECES, painted), ['sky', 'sprig']) }],
  rigs: { 'pieces/sprig': rig },
});

/** The sprig posed and its rim switched by STAMP_GATE_PIECES_TABLE. */
export const stampGatePiecesShot = (): PaintedShotProps => ({
  ...piecesShot({}, { parts: STAMP_GATE_PIECES_PARTS, pose: (moment) => rowAt(moment).pose }), visibility: { 'pieces/bud-rim': (moment) => rowAt(moment).rim },
});

/**
 * The sprig painted as `painted` says (a layer whose property is false painted clear), every cel shown at rest as a
 * part of its own: what a frame hiding those layers shows.
 */
export const stampGatePiecesFlatShot = (painted: Partial<PropertyValues<typeof piecesProperties>>): PaintedShotProps => piecesShot(painted, { parts: STAMP_GATE_PIECES_FLAT_PARTS, pose: {} });
