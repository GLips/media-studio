// stamp-gate-shots.ts: the gate's shots (ENGINE 9, tests 6 and 7 through a PaintedShot): the rigged paper heron (neck
// skinned, wing a cel on its own sheet, reeds drawn as pieces), boiling, and dissolving from day to dusk as it's posed;
// the wet-contact sheet, its foot rigged: painted in, on sixes over a warmed span, hidden, and dissolving over a
// dissolving back; the heron alone over HTML, also pinned (shot/page); the rain (stamp-gate-rain.ts); and the cut-out
// cards (stamp-gate-cards.ts). Poses and drops are tables by scene second, so a baseline's inputs name them. What the
// cases measure of their frames is here, pure.

import { compilePaintingSelection } from '#lib/paint/document/models/painting-document-compile.ts';
import type { LayerNode, Mix, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingEvaluation, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampCanonicalJson, type StampCanonicalDatum } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { PaintedShotProps, RigPart, RigPartPose, ScreenPin } from '#lib/paint/shot/models/shot-props.ts';
import { dissolve } from '#lib/paint/shot/models/shot-selection.ts';
import { STAMP_GATE_CARDS, STAMP_GATE_CARDS_AT, STAMP_GATE_CARDS_LEAF, STAMP_GATE_CARDS_SITTING, stampGateCardParts, stampGateCardsShot } from './stamp-gate-cards.ts';
import { STAMP_GATE_FRAME_TOLERANCE } from './stamp-gate-frames.ts';
import {
  STAMP_GATE_HERON_BODY, STAMP_GATE_HERON_MIXES, STAMP_GATE_HERON_MOVE, STAMP_GATE_HERON_VANE, stampGateHeronLayer, stampGateInsidePolygon, stampGateHeronPaper, stampGateHeronPolygon,
  stampGatePaperHeronDocument, type StampGateHeronMixes,
} from './stamp-gate-paper-heron.ts';
import { STAMP_GATE_RAIN, STAMP_GATE_RAIN_PAINTING, stampGateRainShot } from './stamp-gate-rain.ts';
import { STAMP_GATE_RAINY_STREET_AT, STAMP_GATE_RAINY_STREET_PRESENTATION, stampGateRainyStreetEvaluations, stampGateRainyStreetShot } from './stamp-gate-rainy-street.ts';
import { STAMP_GATE_MASKS_BASELINE, STAMP_GATE_MASKS_PRESENTATION, STAMP_GATE_SHOT_MASK_IDS, STAMP_GATE_TINTED_HERON, stampGateMaskedShot } from './stamp-gate-shot-masks.ts';
import { STAMP_GATE_SHOT_GLOW_ID } from './stamp-gate-shot-glow.ts';
import { STAMP_GATE_HERON_POSE, STAMP_GATE_SHEET_IMAGES, STAMP_GATE_WET_CONTACT, stampGateSheetBrushOf } from './stamp-gate-sheets.ts';

/** The shot over a page: its DOM adapter's reads, and a clear back pinned to an element, drawn and read back. */
export const STAMP_GATE_SHOT_PAGE_IDS = ['shot/page'] as const;

/** The shots accepted by eye: each a baseline subject, one frame of its shot. */
export const STAMP_GATE_SHOT_IDS = ['shot/paper-heron', 'shot/wet-contact', 'shot/rain', 'shot/dissolve', 'shot/rigged-dissolve', 'shot/masks', 'shot/rainy-street', 'shot/cards'] as const;
export type StampGateShotId = (typeof STAMP_GATE_SHOT_IDS)[number];

/**
 * The shot cases checked apart from any sheet case, each a page's checks of its shot's frames: the rain's items, a
 * dissolve drawn between its ends, a rigged one posed between its ends, a span warmed, the masked shot's cuts, the
 * rainy street's cost report, the cards' hidden cel, switched-off view and fading owner, and what glows.
 */
export const STAMP_GATE_SHOT_CASE_IDS = [
  'shot/rain', 'shot/dissolve', 'shot/rigged-dissolve', 'shot/warm', ...STAMP_GATE_SHOT_MASK_IDS, 'shot/rainy-street', 'shot/cards', STAMP_GATE_SHOT_GLOW_ID,
] as const;
export type StampGateShotCaseId = (typeof STAMP_GATE_SHOT_CASE_IDS)[number];

/** The fps the gate plays its shots at, as a composition would: a warm span's frames are counted at it. */
export const STAMP_GATE_SHOT_FPS = 30;

const { burntSienna, burntUmber, phthaloGreen, ultramarine, yellowOchre } = WATERCOLOUR_PIGMENTS;

/** The neck's outline at rest, document px: up from inside the body's left end. */
const NECK = [36, 54, 46, 48, 34, 28, 38, 12, 28, 12, 24, 30] as const;
/** The lowered neck's, the neck's second cel: out forward and down from the same root. */
const NECK_LOW = [36, 54, 46, 50, 26, 38, 10, 40, 10, 48, 24, 50] as const;
/** Where the neck turns on the body, inside both, and how far its skin blends, px. */
const NECK_PIVOT = { x: 40, y: 50 } as const;
const NECK_BLEND = 12;
/** Where the wing hinges on the body, at the vane's root. */
const WING_PIVOT = { x: 100, y: 50 } as const;
/** The reeds' outlines at rest, document px, overlapping low in the water, clear of the heron wherever it's posed. */
const REED_A = [14, 134, 20, 98, 28, 98, 26, 134] as const;
const REED_B = [18, 128, 38, 96, 46, 100, 28, 132] as const;
const REED_HINGE = { x: 24, y: 128 } as const;
/** How far inside the swung reed's outline its paint is measured, px: clear of its edge's bleed. */
const REED_INSET = 1.5;

/** What the rigged heron is painted with: its water and body, both its necks, and each reed. */
type StampGateRiggedHeronPalette = StampGateHeronMixes & { readonly neck: Mix; readonly reedA: Mix; readonly reedB: Mix };

const DAY: StampGateRiggedHeronPalette = {
  ...STAMP_GATE_HERON_MIXES, neck: { parts: [{ pigment: burntUmber, amount: 1 }], strength: 0.55 },
  reedA: { parts: [{ pigment: yellowOchre, amount: 1 }], strength: 0.7 }, reedB: { parts: [{ pigment: phthaloGreen, amount: 1 }], strength: 0.4 },
};
/** Dusk's: every part the rigs cut painted cooler and darker, so each differs from day's wherever it's posed. */
const DUSK: StampGateRiggedHeronPalette = {
  water: { parts: [{ pigment: ultramarine, amount: 1 }], strength: 0.6 }, body: { parts: [{ pigment: ultramarine, amount: 0.6 }, { pigment: burntUmber, amount: 0.4 }], strength: 0.75 },
  neck: { parts: [{ pigment: ultramarine, amount: 0.6 }, { pigment: burntUmber, amount: 0.4 }], strength: 0.6 },
  reedA: { parts: [{ pigment: burntSienna, amount: 1 }], strength: 0.7 }, reedB: { parts: [{ pigment: ultramarine, amount: 1 }], strength: 0.5 },
};

/**
 * The paper heron painted with `palette`, a `neck` and a `neck-low` laid over its body, all on the scene's sheet, and
 * `reeds`, a group owning a sheet of its own holding two overlapping reeds.
 */
function riggedHeronDocument(palette: StampGateRiggedHeronPalette): PaintingDocument {
  const neck = stampGateHeronLayer('neck', stampGateHeronPolygon(...NECK), palette.neck, 0.7);
  // Painted once the neck is dry, as a later cel is: hidden, a cel's water would leave what it did to the body showing.
  const neckLow = stampGateHeronLayer('neck-low', stampGateHeronPolygon(...NECK_LOW), palette.neck, 0.7, 'dry');
  const reeds: LayerNode = {
    key: 'reeds', sheet: { kind: 'own', paper: stampGateHeronPaper('#e4ead0', 1.2) },
    children: [stampGateHeronLayer('reed-a', stampGateHeronPolygon(...REED_A), palette.reedA, 0.7), stampGateHeronLayer('reed-b', stampGateHeronPolygon(...REED_B), palette.reedB, 0.7)],
  };
  return stampGatePaperHeronDocument([neck, neckLow], [reeds], palette);
}

/** The rigged heron by day. */
export const STAMP_GATE_RIGGED_HERON: PaintingSourceModule = {
  default: function gateRiggedHeron(): PaintingDocument {
    return riggedHeronDocument(DAY);
  },
};

/** The rigged heron at dusk: its layers cut alike, so its rigs cut it as they cut day's. */
export const STAMP_GATE_DUSK_HERON: PaintingSourceModule = {
  default: function gateDuskHeron(): PaintingDocument {
    return riggedHeronDocument(DUSK);
  },
};

/** The heron's rig, on the scene's sheet: its body the root, its neck skinned to it (or lowered), its wing (an own sheet) hinged. */
const HERON_PARTS: readonly RigPart[] = [
  { id: 'body', z: 0, parent: null, cels: ['body'] },
  { id: 'neck', z: 1, parent: 'body', joint: 'skin', pivot: NECK_PIVOT, blend: NECK_BLEND, cels: ['neck', 'neck-low'] },
  { id: 'wing', z: 2, parent: 'body', joint: 'hinge', pivot: WING_PIVOT, cels: ['wing'] },
];

/** The reeds' rig, its group owning its sheet, so drawn as pieces: one reed hinged on the other. */
export const STAMP_GATE_REED_PARTS: readonly RigPart[] = [
  { id: 'reed-a', z: 0, parent: null, cels: ['reed-a'] },
  { id: 'reed-b', z: 1, parent: 'reed-a', joint: 'hinge', pivot: REED_HINGE, cels: ['reed-b'] },
];

type Pose = Readonly<Record<string, RigPartPose>>;
/** A shot's poses by scene second: each row from its `from` on, until the next's. */
type StampGatePoseTable = readonly { readonly from: number; readonly poses: Readonly<Record<string, Pose>> }[];

const poseAt = (table: StampGatePoseTable, rig: string, at: number): Pose => table.findLast(({ from }) => from <= at)?.poses[rig] ?? {};

/**
 * The rigged heron's frames: at rest, moved by STAMP_GATE_HERON_MOVE, posed for its baseline (its neck bent, its wing
 * raised, a reed swung), that pose showing the lowered neck, and the heron then faded halfway and hidden.
 */
export const STAMP_GATE_RIGGED_HERON_AT = { rest: 0, moved: 1, posed: 2, swapped: 3, faded: 4, hidden: 5 } as const;
const POSED_HERON = { body: { x: 8, y: 4 }, neck: { bend: 0.6 }, wing: { rotation: -0.3 } } satisfies Pose;
const POSED_REEDS = { 'reed-b': { rotation: -0.35 } } satisfies Pose;
const HERON_POSES: StampGatePoseTable = [
  { from: STAMP_GATE_RIGGED_HERON_AT.rest, poses: {} },
  { from: STAMP_GATE_RIGGED_HERON_AT.moved, poses: { heron: { body: STAMP_GATE_HERON_MOVE } } },
  { from: STAMP_GATE_RIGGED_HERON_AT.posed, poses: { heron: POSED_HERON, reeds: POSED_REEDS } },
  { from: STAMP_GATE_RIGGED_HERON_AT.swapped, poses: { heron: { ...POSED_HERON, neck: { ...POSED_HERON.neck, cel: 'neck-low' } }, reeds: POSED_REEDS } },
];

/** Where the heron's neck shows when posed or swapped, frame px: left of the body's middle (posed), above the water. */
export const STAMP_GATE_HERON_NECKS = { x0: 0, y0: 0, x1: STAMP_GATE_HERON_BODY.center.x + 8, y1: 116 } as const;

/**
 * The rigged dissolve's frames: the heron by day and at dusk, posed alike; halfway between them, its baseline's frame;
 * halfway at another pose; and halfway at the first pose again.
 */
export const STAMP_GATE_RIGGED_DISSOLVE_AT = { day: 0, dusk: 1, half: 2, reposed: 3, again: 4 } as const;
const RIGGED_DISSOLVE_KS = [
  { from: STAMP_GATE_RIGGED_DISSOLVE_AT.day, k: 0 }, { from: STAMP_GATE_RIGGED_DISSOLVE_AT.dusk, k: 1 }, { from: STAMP_GATE_RIGGED_DISSOLVE_AT.half, k: 0.5 },
] as const;
const REPOSED_HERON = { body: { x: 8, y: 4 }, neck: { bend: -0.4 }, wing: { rotation: 0.2 } } satisfies Pose;
const REPOSED_REEDS = { 'reed-b': { rotation: -0.15 } } satisfies Pose;
const RIGGED_DISSOLVE_POSES: StampGatePoseTable = [
  { from: STAMP_GATE_RIGGED_DISSOLVE_AT.day, poses: { heron: POSED_HERON, reeds: POSED_REEDS } },
  { from: STAMP_GATE_RIGGED_DISSOLVE_AT.reposed, poses: { heron: REPOSED_HERON, reeds: REPOSED_REEDS } },
  { from: STAMP_GATE_RIGGED_DISSOLVE_AT.again, poses: { heron: POSED_HERON, reeds: POSED_REEDS } },
];

/**
 * The rigged heron dissolving from day to dusk on its one plane, its heron's marks on the shared sheet and its reeds
 * as pieces, both posed by RIGGED_DISSOLVE_POSES whichever end shows; `heard` hears each pose read, by group; `warm`,
 * a span warmed before any frame is drawn.
 */
export function stampGateRiggedDissolveShot({ heard, warm }: { heard?: (group: string) => void; warm?: PaintedShotProps['warm'] } = {}): PaintedShotProps {
  const day = painting(STAMP_GATE_RIGGED_HERON), dusk = painting(STAMP_GATE_DUSK_HERON), layers = ['water', 'heron', 'reeds'];
  const k = (at: number) => RIGGED_DISSOLVE_KS.findLast(({ from }) => from <= at)!.k;
  return {
    ...oneSheetShot('paper', day, layers, { heron: HERON_PARTS, reeds: STAMP_GATE_REED_PARTS }, RIGGED_DISSOLVE_POSES, heard),
    planes: [{ id: 'paper', depth: 1, source: ({ at }: PaintMoment) => dissolve(layersOf(day, layers), layersOf(dusk, layers), k(at)) }],
    ...(warm && { warm }),
  };
}

/** The rigged dissolve's two paintings, as a solve names them: what each frame posed anew solves a sheet of. */
export const stampGateRiggedDissolveSources = () => [painting(STAMP_GATE_RIGGED_HERON).source, painting(STAMP_GATE_DUSK_HERON).source].toSorted();

/** The wet-contact shot's frames: the foot at rest, then posed by its rig as the sheet case poses its group. */
export const STAMP_GATE_WET_CONTACT_AT = { rest: 1, posed: 3 } as const;
const FOOT_POSES: StampGatePoseTable = [
  { from: STAMP_GATE_WET_CONTACT_AT.rest, poses: {} },
  { from: STAMP_GATE_WET_CONTACT_AT.posed, poses: { heron: { leg: { x: STAMP_GATE_HERON_POSE.kx, y: STAMP_GATE_HERON_POSE.ky } } } },
];

/**
 * A shot of one painted plane `plane` over `evaluation`'s `layers`, a still camera on its document, its `rigs` posed by
 * `table`; `heard` hears each pose read, by group.
 */
function oneSheetShot(
  plane: string, evaluation: PaintingEvaluation, layers: readonly string[], rigs: Readonly<Record<string, readonly RigPart[]>>, table: StampGatePoseTable, heard?: (group: string) => void,
): PaintedShotProps {
  const { widthPx: width, heightPx: height } = evaluation.document;
  const pose = (group: string) => ({ at }: PaintMoment) => {
    heard?.(group);
    return poseAt(table, group, at);
  };
  return {
    camera: { stage: stampStage({ width, height }, 2), fov: 35, lens: { bloom: 0, shutter: 0 } },
    planes: [{ id: plane, depth: 1, source: layersOf(evaluation, layers) }],
    rigs: Object.fromEntries(Object.entries(rigs).map(([group, parts]) => [`${plane}/${group}`, { parts, pose: pose(group) }])),
  };
}

const { faded: FADED, hidden: HIDDEN } = STAMP_GATE_RIGGED_HERON_AT;

/** The rigged heron's visibility at `at`: shown before FADED, half shown until HIDDEN, then hidden. */
function riggedHeronVisibility(at: number): number {
  if (at < FADED) return 1;
  return at < HIDDEN ? 0.5 : 0;
}

/** The rigged heron's shot; `reedsRigged` false leaves the reeds unrigged, painted as their sheet paints them. */
export const stampGateRiggedHeronShot = (reedsRigged = true): PaintedShotProps => ({
  ...oneSheetShot('paper', painting(STAMP_GATE_RIGGED_HERON), ['water', 'heron', 'reeds'], { heron: HERON_PARTS, ...(reedsRigged && { reeds: STAMP_GATE_REED_PARTS }) }, HERON_POSES),
  visibility: { 'paper/heron': ({ at }) => riggedHeronVisibility(at) },
});

/** Two frames of consecutive boil epochs of the boiling heron, scene seconds, mid-frame: both before it moves. */
export const STAMP_GATE_HERON_BOIL_AT = [1.5 / PAINT_ANIMATION_FPS, 2.5 / PAINT_ANIMATION_FPS] as const;

/** The rigged heron boiling every frame, its wobble on the heron's group, whose rig takes it. */
export const stampGateBoilingHeronShot = (): PaintedShotProps => ({
  ...stampGateRiggedHeronShot(), motion: { nodes: [{ id: 'paper/heron', marks: { boil: { every: 1 } } }] },
});

const FOOT_RIG: readonly RigPart[] = [{ id: 'leg', z: 0, parent: null, cels: ['foot'] }];

/**
 * The paper heron's heron alone on a transparent ground, unrigged: a back clear round its paint, over HTML. Where its
 * document puts it, or laid by `lay`.
 */
export function stampGateClearBackShot(lay?: ScreenPin): PaintedShotProps {
  const evaluation = painting(STAMP_GATE_RIGGED_HERON), source = layersOf(evaluation, ['heron'], { ground: 'transparent' });
  return { ...oneSheetShot('paper', evaluation, ['heron'], {}, []), planes: [lay ? { id: 'paper', depth: 1, lay, source } : { id: 'paper', depth: 1, source }] };
}

/** The clear back's heron pinned by its document point `sourcePx` to the element whose `data-pin` is `heron`. */
export const stampGatePinnedHeronShot = (sourcePx: StampPoint): PaintedShotProps => stampGateClearBackShot({ kind: 'pin', points: [{ sourcePx, element: 'heron' }] });

/**
 * How a clear canvas's alphas (a byte a texel, stampGateGlazeAlpha's) lie: how many texels are clear, how many at
 * least half opaque, the most opaque of its corners, which the heron's paint stays clear of, and its alpha's centroid
 * in frame px, a texel's centre half a px in.
 */
export function stampGateClearAlpha(alphas: ArrayLike<number>, width: number, height: number): { clear: number; opaque: number; corner: number; centroid: StampPoint } {
  let clear = 0, opaque = 0, sum = 0, x = 0, y = 0;
  for (let texel = 0; texel < width * height; texel++) {
    const alpha = alphas[texel];
    if (alpha === 0) clear++;
    if (alpha >= 128) opaque++;
    sum += alpha;
    x += alpha * ((texel % width) + 0.5);
    y += alpha * (Math.floor(texel / width) + 0.5);
  }
  const corner = Math.max(...[0, width - 1, (height - 1) * width, height * width - 1].map((texel) => alphas[texel]));
  return { clear, opaque, corner, centroid: { x: x / sum, y: y / sum } };
}

/** The wet-contact shot: the shallows and the heron, its foot the one part of its rig. */
export const stampGateWetContactShot = (): PaintedShotProps => oneSheetShot('pond', painting(STAMP_GATE_WET_CONTACT), ['shallows', 'heron'], { heron: FOOT_RIG }, FOOT_POSES);

/** The painting-in shot's frames: before the foot's first stroke, so its cel is clear, and posed once it's painted. */
export const STAMP_GATE_PAINTING_IN_AT = { unpainted: 0.25, posed: STAMP_GATE_WET_CONTACT_AT.posed } as const;

/** The wet-contact shot painted in as it plays: each frame shows the sheet's paint as far as its own moment. */
export function stampGateWetContactPaintingInShot(): PaintedShotProps {
  const evaluation = painting(STAMP_GATE_WET_CONTACT);
  return { ...stampGateWetContactShot(), planes: [{ id: 'pond', depth: 1, source: ({ at }: PaintMoment) => layersOf(evaluation, ['shallows', 'heron'], { at }) }] };
}

/** The hidden-foot shot's frames: the foot at rest and shown, then at rest and hidden. */
export const STAMP_GATE_HIDDEN_FOOT_AT = { shown: STAMP_GATE_WET_CONTACT_AT.rest, hidden: STAMP_GATE_WET_CONTACT_AT.rest + 1 } as const;

/** The wet-contact shot, its foot hidden from STAMP_GATE_HIDDEN_FOOT_AT.hidden on, before it's posed. */
export const stampGateHiddenFootShot = (): PaintedShotProps => ({
  ...stampGateWetContactShot(), visibility: { 'pond/foot': ({ at }) => (at < STAMP_GATE_HIDDEN_FOOT_AT.hidden ? 1 : 0) },
});

/** The wet-contact sheet's shallows painted with no heron on it: as they'd be without the foot's water. */
export const stampGateShallowsAloneShot = (): PaintedShotProps => oneSheetShot('pond', painting(STAMP_GATE_WET_CONTACT, { heron: false }), ['shallows'], {}, []);

/**
 * The warm shot's span, scene seconds, and two frames inside it, drawn once it's warmed: each a frame its warm skips,
 * pairing its plane's held moments (source and plane clocks) as an earlier frame does, but posing its foot otherwise
 * than the frame before it on the source's clock alone did.
 */
export const STAMP_GATE_WARM = { from: 0.5, to: 1 } as const;
export const STAMP_GATE_WARMED_AT = [20 / STAMP_GATE_SHOT_FPS, 28 / STAMP_GATE_SHOT_FPS] as const;

/**
 * The warm shot's foot, at rest and posed in turn each eighth of a second through its span, as the plane's clock
 * moves: at rest wherever the source's clock moves on, so a warm pairing the source's moments alone never poses it.
 */
const WARM_FOOT_POSED = { heron: { leg: { x: STAMP_GATE_HERON_POSE.kx, y: STAMP_GATE_HERON_POSE.ky } } } as const;
const WARM_FOOT_POSES: StampGatePoseTable = [
  { from: 0.5, poses: {} }, { from: 0.625, poses: WARM_FOOT_POSED }, { from: 0.75, poses: {} }, { from: 0.875, poses: WARM_FOOT_POSED }, { from: 1, poses: {} },
];

/**
 * The wet-contact shot painted in on sixes, a new prefix each quarter second, its plane held on threes as its foot
 * flips between rest and posed; its second half-second warmed.
 */
export function stampGateWarmShot(): PaintedShotProps {
  const evaluation = painting(STAMP_GATE_WET_CONTACT);
  return {
    ...oneSheetShot('pond', evaluation, ['shallows', 'heron'], { heron: FOOT_RIG }, WARM_FOOT_POSES), warm: STAMP_GATE_WARM,
    planes: [{ id: 'pond', depth: 1, clock: { hold: 3 }, sourceClock: { hold: 6 }, source: ({ at }: PaintMoment) => layersOf(evaluation, ['shallows', 'heron'], { at }) }],
  };
}

/**
 * The dissolve shot's frames: its heron together, apart and halfway over the shallows alone; then, its plane hidden,
 * the pond painted with the heron in it, the shallows alone, and halfway between them; and both halfway, the heron
 * shown, its baseline's frame.
 */
export const STAMP_GATE_DISSOLVE_AT = { together: 0, apart: 1, half: 2, inPond: 3, alone: 4, backHalf: 5, bothHalf: 6 } as const;

/**
 * Each frame's `k`s, the heron plane's, together (0) to apart (1), and the back's, the pond painted with the heron in
 * it (0) to the shallows alone (1); and whether the heron plane shows.
 */
const DISSOLVE_KS = [
  { at: STAMP_GATE_DISSOLVE_AT.together, heron: 0, back: 1, shown: 1 }, { at: STAMP_GATE_DISSOLVE_AT.apart, heron: 1, back: 1, shown: 1 },
  { at: STAMP_GATE_DISSOLVE_AT.half, heron: 0.5, back: 1, shown: 1 }, { at: STAMP_GATE_DISSOLVE_AT.inPond, heron: 0, back: 0, shown: 0 },
  { at: STAMP_GATE_DISSOLVE_AT.alone, heron: 0, back: 1, shown: 0 }, { at: STAMP_GATE_DISSOLVE_AT.backHalf, heron: 0, back: 0.5, shown: 0 },
  { at: STAMP_GATE_DISSOLVE_AT.bothHalf, heron: 0.5, back: 0.5, shown: 1 },
] as const;

/** The dissolve shot's evaluations: the shallows alone; the heron on the scene's sheet, and on a sheet of its own. */
const dissolveEvaluations = () => ({
  shallows: painting(STAMP_GATE_WET_CONTACT, { heron: false }), together: painting(STAMP_GATE_WET_CONTACT), apart: painting(STAMP_GATE_WET_CONTACT, { apart: true }),
});

/**
 * The wet-contact heron on a plane of its own, dissolving from its foot as the scene's sheet paints it (`together`)
 * to its foot cut out on a sheet of its own (`apart`), over the back, dissolving from the pond painted with the heron
 * in it to the shallows alone; each, and whether the heron plane shows, by DISSOLVE_KS.
 */
export function stampGateDissolveShot(): PaintedShotProps {
  const { shallows, together, apart } = dissolveEvaluations(), { widthPx: width, heightPx: height } = together.document;
  const ks = ({ at }: PaintMoment) => DISSOLVE_KS.find((row) => row.at === at) ?? DISSOLVE_KS[0];
  return {
    camera: { stage: stampStage({ width, height }, 2), fov: 35, lens: { bloom: 0, shutter: 0 } },
    planes: [
      { id: 'pond', depth: 1, source: (moment: PaintMoment) => dissolve(layersOf(together, ['shallows', 'heron']), layersOf(shallows, ['shallows']), ks(moment).back) },
      { id: 'heron', depth: 1, source: (moment: PaintMoment) => dissolve(layersOf(together, ['heron']), layersOf(apart, ['heron']), ks(moment).heron) },
    ],
    visibility: { heron: (moment) => ks(moment).shown },
  };
}

/**
 * Each shot baseline: its shot, the frame it shows, and as its inputs name them its sources (each evaluation drawn),
 * rigs, poses and `extra`, what else its shot reads.
 */
const SHOT_BASELINES: Readonly<Record<StampGateShotId, {
  shot: () => PaintedShotProps; at: number; evaluations: () => readonly PaintingEvaluation[]; rigs: Readonly<Record<string, readonly RigPart[]>>; poses: StampGatePoseTable;
  extra?: StampCanonicalDatum;
}>> = {
  'shot/paper-heron': { shot: stampGateRiggedHeronShot, at: STAMP_GATE_RIGGED_HERON_AT.posed, evaluations: () => [painting(STAMP_GATE_RIGGED_HERON)], rigs: { heron: HERON_PARTS, reeds: STAMP_GATE_REED_PARTS }, poses: HERON_POSES },
  'shot/wet-contact': { shot: stampGateWetContactShot, at: STAMP_GATE_WET_CONTACT_AT.posed, evaluations: () => [painting(STAMP_GATE_WET_CONTACT)], rigs: { heron: FOOT_RIG }, poses: FOOT_POSES },
  'shot/rain': { shot: stampGateRainShot, at: STAMP_GATE_RAIN.at.first, evaluations: () => [painting(STAMP_GATE_RAIN_PAINTING)], rigs: {}, poses: [], extra: STAMP_GATE_RAIN },
  'shot/dissolve': {
    shot: stampGateDissolveShot, at: STAMP_GATE_DISSOLVE_AT.bothHalf, evaluations: () => Object.values(dissolveEvaluations()), rigs: {}, poses: [], extra: { ks: DISSOLVE_KS },
  },
  'shot/rigged-dissolve': {
    shot: stampGateRiggedDissolveShot, at: STAMP_GATE_RIGGED_DISSOLVE_AT.half, evaluations: () => [painting(STAMP_GATE_RIGGED_HERON), painting(STAMP_GATE_DUSK_HERON)],
    rigs: { heron: HERON_PARTS, reeds: STAMP_GATE_REED_PARTS }, poses: RIGGED_DISSOLVE_POSES, extra: { ks: RIGGED_DISSOLVE_KS },
  },
  'shot/masks': {
    shot: () => stampGateMaskedShot(STAMP_GATE_MASKS_BASELINE.shown), at: STAMP_GATE_MASKS_BASELINE.at, evaluations: () => [painting(STAMP_GATE_TINTED_HERON), painting(STAMP_GATE_TINTED_HERON, { revealed: true })],
    rigs: {}, poses: [], extra: STAMP_GATE_MASKS_PRESENTATION,
  },
  'shot/rainy-street': {
    shot: stampGateRainyStreetShot, at: STAMP_GATE_RAINY_STREET_AT.baseline, evaluations: stampGateRainyStreetEvaluations, rigs: {}, poses: [], extra: STAMP_GATE_RAINY_STREET_PRESENTATION,
  },
  'shot/cards': {
    shot: stampGateCardsShot, at: STAMP_GATE_CARDS_AT.faded, evaluations: () => [painting(STAMP_GATE_CARDS)], rigs: { figure: stampGateCardParts(true) }, poses: [], extra: { leaf: STAMP_GATE_CARDS_LEAF, sitting: STAMP_GATE_CARDS_SITTING },
  },
};

/** Shot baseline `id`'s shot and the scene second its frame shows. */
export function stampGateShotBaseline(id: StampGateShotId): { shot: PaintedShotProps; at: number } {
  const { shot, at } = SHOT_BASELINES[id];
  return { shot: shot(), at };
}

/** `evaluation`'s sheets' programs and steps, compiled whole. */
function shotEvaluationInputs(evaluation: PaintingEvaluation) {
  const compiled = compilePaintingSelection(evaluation, stampGateSheetBrushOf);
  return { programs: compiled.sheets.map(({ program }) => program), steps: compiled.steps };
}

/** What shot baseline `id` is drawn from, as text: its sheets' programs and steps, its rigs, poses and extra, its frame and the images it loads. */
export function stampGateShotInputs(id: StampGateShotId): string {
  const { evaluations, rigs, poses, extra, at } = SHOT_BASELINES[id];
  return stampCanonicalJson({ evaluations: evaluations().map(shotEvaluationInputs), rigs, poses, extra, at, images: STAMP_GATE_SHEET_IMAGES });
}

const insideEllipse = ({ x, y }: StampPoint, centre: StampPoint, rx: number, ry: number) => ((x - centre.x) / rx) ** 2 + ((y - centre.y) / ry) ** 2 <= 1;

/** How far inside a part's paint a window lies, px: clear of its edges' bleed. */
const WINDOW_INSET = 5;

/**
 * The rigged heron's grain windows over its `width` × `height` frame (1 inside): the body's, inside its paint at rest
 * and moved, right of where the moved neck meets it; the wing's, inside its vane at rest.
 */
export function stampGateRiggedHeronWindows(width: number, height: number): { body: Uint8Array; wing: Uint8Array } {
  const { center, radiusX, radiusY } = STAMP_GATE_HERON_BODY, moved = { x: center.x + STAMP_GATE_HERON_MOVE.x, y: center.y + STAMP_GATE_HERON_MOVE.y };
  const neckReach = Math.max(...NECK.filter((_, i) => i % 2 === 0)) + STAMP_GATE_HERON_MOVE.x + WINDOW_INSET;
  const windowOf = (inside: (p: StampPoint) => boolean) => Uint8Array.from({ length: width * height }, (_, i) => (inside({ x: (i % width) + 0.5, y: Math.floor(i / width) + 0.5 }) ? 1 : 0));
  return {
    body: windowOf((p) => p.x >= neckReach && [center, moved].every((c) => insideEllipse(p, c, radiusX - WINDOW_INSET, radiusY - WINDOW_INSET))),
    wing: windowOf((p) => stampGateInsidePolygon(p, STAMP_GATE_HERON_VANE, WINDOW_INSET)),
  };
}

/**
 * How many texels of the swung reed's paint at rest, well inside its outline, differ by over 2 levels between the
 * rigged heron's `rest` and `swung` frames (RGB bytes, `width` px wide): none where its pieces weren't drawn or posed.
 */
export function stampGateReedSwung(rest: ArrayLike<number>, swung: ArrayLike<number>, width: number): number {
  let changed = 0;
  for (let texel = 0; texel < rest.length / 3; texel++) {
    const p = { x: (texel % width) + 0.5, y: Math.floor(texel / width) + 0.5 };
    if (!stampGateInsidePolygon(p, REED_B, REED_INSET)) continue;
    if ([0, 1, 2].some((c) => Math.abs(rest[3 * texel + c] - swung[3 * texel + c]) > 2)) changed++;
  }
  return changed;
}

/**
 * How frame `faded` lies against `shown` and `hidden` (RGB bytes alike): the most a channel strays outside the two;
 * of the channels where they differ by over 16 levels, how many, and how many `faded` holds 4 levels or more from both.
 */
export function stampGateFadeBetween(shown: ArrayLike<number>, faded: ArrayLike<number>, hidden: ArrayLike<number>): { outside: number; apart: number; between: number } {
  let outside = 0, apart = 0, between = 0;
  for (let i = 0; i < shown.length; i++) {
    const low = Math.min(shown[i], hidden[i]), high = Math.max(shown[i], hidden[i]), v = faded[i];
    outside = Math.max(outside, low - v, v - high);
    if (high - low <= 16) continue;
    apart++;
    if (v - low >= 4 && high - v >= 4) between++;
  }
  return { outside, apart, between };
}

/**
 * Whether a fade's middle frame lies between its ends (stampGateFadeBetween's count): within the frame tolerance
 * outside them everywhere, and inside them in every channel they differ in.
 */
export const stampGateFadeLiesBetween = ({ outside, apart, between }: ReturnType<typeof stampGateFadeBetween>) =>
  outside <= STAMP_GATE_FRAME_TOLERANCE.max && apart > 0 && between === apart;

/** The box of `width`-px-wide RGB frames `a` and `b`'s pixels differing past 2 levels, frame px, end exclusive; null where none do. */
export function stampGateDifferenceBox(a: ArrayLike<number>, b: ArrayLike<number>, width: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) <= 2) continue;
    const texel = Math.floor(i / 3), x = texel % width, y = Math.floor(texel / width);
    box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x + 1), y1: Math.max(box.y1, y + 1) } : { x0: x, y0: y, x1: x + 1, y1: y + 1 };
  }
  return box;
}
