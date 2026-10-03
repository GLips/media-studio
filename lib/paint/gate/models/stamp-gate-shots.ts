// stamp-gate-shots.ts: the gate's shots (ENGINE 9, tests 6 and 7 drawn through a PaintedShot): the rigged heron, the
// paper heron with a neck skinned to its body on the scene's sheet (a lowered neck its second cel), its wing a cel
// moving its own sheet whole, and a clump of reeds whose group owns its sheet, drawn as pieces; and the wet-contact
// sheet with its heron's foot posed by a rig. Each shot's poses are a table by scene second, so its baseline's inputs name them. What the cases measure of
// their frames is here, pure.

import { compilePaintingSelection } from '#lib/paint/document/models/painting-document-compile.ts';
import type { LayerNode, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingEvaluation, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { PaintedShotProps, RigPart, RigPartPose } from '#lib/paint/shot/models/shot-props.ts';
import {
  STAMP_GATE_HERON_BODY, STAMP_GATE_HERON_MOVE, STAMP_GATE_HERON_VANE, stampGateHeronLayer, stampGateHeronPaper, stampGateHeronPolygon, stampGatePaperHeronDocument,
} from './stamp-gate-paper-heron.ts';
import { STAMP_GATE_HERON_POSE, STAMP_GATE_SHEET_IMAGES, STAMP_GATE_WET_CONTACT, stampGateSheetBrushOf } from './stamp-gate-sheets.ts';

/** The shots accepted by eye: each a baseline subject, one frame of its shot. */
export const STAMP_GATE_SHOT_IDS = ['shot/paper-heron', 'shot/wet-contact'] as const;
export type StampGateShotId = (typeof STAMP_GATE_SHOT_IDS)[number];

const { burntUmber, yellowOchre, phthaloGreen } = WATERCOLOUR_PIGMENTS;

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

const neck: LayerNode = stampGateHeronLayer('neck', stampGateHeronPolygon(...NECK), { parts: [{ pigment: burntUmber, amount: 1 }], strength: 0.55 }, 0.7);
// Painted once the neck is dry, as a later cel is: hidden, a cel's water would leave what it did to the body showing.
const neckLow: LayerNode = stampGateHeronLayer('neck-low', stampGateHeronPolygon(...NECK_LOW), { parts: [{ pigment: burntUmber, amount: 1 }], strength: 0.55 }, 0.7, 'dry');
const reeds: LayerNode = {
  key: 'reeds', sheet: { kind: 'own', paper: stampGateHeronPaper('#e4ead0', 1.2) },
  children: [
    stampGateHeronLayer('reed-a', stampGateHeronPolygon(...REED_A), { parts: [{ pigment: yellowOchre, amount: 1 }], strength: 0.7 }, 0.7),
    stampGateHeronLayer('reed-b', stampGateHeronPolygon(...REED_B), { parts: [{ pigment: phthaloGreen, amount: 1 }], strength: 0.4 }, 0.7),
  ],
};

/**
 * The paper heron with a `neck` and a `neck-low` laid over its body, all on the scene's sheet, and `reeds`, a group
 * owning a sheet of its own holding two overlapping reeds.
 */
export const STAMP_GATE_RIGGED_HERON: PaintingSourceModule = {
  default: function gateRiggedHeron(): PaintingDocument {
    return stampGatePaperHeronDocument([neck, neckLow], [reeds]);
  },
};

/** The heron's rig, on the scene's sheet: its body the root, its neck skinned to it (or lowered), its wing (an own sheet) hinged. */
const HERON_PARTS: readonly RigPart[] = [
  { id: 'body', z: 0, parent: null, cels: ['body'] },
  { id: 'neck', z: 1, parent: 'body', joint: 'skin', pivot: NECK_PIVOT, blend: NECK_BLEND, cels: ['neck', 'neck-low'] },
  { id: 'wing', z: 2, parent: 'body', joint: 'hinge', pivot: WING_PIVOT, cels: ['wing'] },
];

/** The reeds' rig, its group owning its sheet, so drawn as pieces: one reed hinged on the other. */
const REED_PARTS: readonly RigPart[] = [
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

/** The wet-contact shot's frames: the foot at rest, then posed by its rig as the sheet case poses its group. */
export const STAMP_GATE_WET_CONTACT_AT = { rest: 1, posed: 3 } as const;
const FOOT_POSES: StampGatePoseTable = [
  { from: STAMP_GATE_WET_CONTACT_AT.rest, poses: {} },
  { from: STAMP_GATE_WET_CONTACT_AT.posed, poses: { heron: { leg: { x: STAMP_GATE_HERON_POSE.kx, y: STAMP_GATE_HERON_POSE.ky } } } },
];

/** A shot of one painted plane `plane` over `evaluation`'s `layers`, a still camera on its document, its `rigs` posed by `table`. */
function oneSheetShot(plane: string, evaluation: PaintingEvaluation, layers: readonly string[], rigs: Readonly<Record<string, readonly RigPart[]>>, table: StampGatePoseTable): PaintedShotProps {
  const { widthPx: width, heightPx: height } = evaluation.document;
  return {
    camera: { stage: stampStage({ width, height }, 2), fov: 35, lens: { bloom: 0, shutter: 0 }, plays: [] },
    planes: [{ id: plane, depth: 1, source: layersOf(evaluation, layers) }],
    rigs: Object.fromEntries(Object.entries(rigs).map(([group, parts]) => [`${plane}/${group}`, { parts, pose: ({ at }) => poseAt(table, group, at) }])),
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
  ...oneSheetShot('paper', painting(STAMP_GATE_RIGGED_HERON), ['water', 'heron', 'reeds'], { heron: HERON_PARTS, ...(reedsRigged && { reeds: REED_PARTS }) }, HERON_POSES),
  visibility: { 'paper/heron': ({ at }) => riggedHeronVisibility(at) },
});

/** The wet-contact shot: the shallows and the heron, its foot the one part of its rig. */
export const stampGateWetContactShot = (): PaintedShotProps =>
  oneSheetShot('pond', painting(STAMP_GATE_WET_CONTACT), ['shallows', 'heron'], { heron: [{ id: 'leg', z: 0, parent: null, cels: ['foot'] }] }, FOOT_POSES);

/** Each shot baseline: its shot, the frame it shows, and its sources and poses as its inputs name them. */
const SHOT_BASELINES: Readonly<Record<StampGateShotId, { shot: () => PaintedShotProps; at: number; evaluation: () => PaintingEvaluation; rigs: Readonly<Record<string, readonly RigPart[]>>; poses: StampGatePoseTable }>> = {
  'shot/paper-heron': { shot: stampGateRiggedHeronShot, at: STAMP_GATE_RIGGED_HERON_AT.posed, evaluation: () => painting(STAMP_GATE_RIGGED_HERON), rigs: { heron: HERON_PARTS, reeds: REED_PARTS }, poses: HERON_POSES },
  'shot/wet-contact': { shot: stampGateWetContactShot, at: STAMP_GATE_WET_CONTACT_AT.posed, evaluation: () => painting(STAMP_GATE_WET_CONTACT), rigs: { heron: [{ id: 'leg', z: 0, parent: null, cels: ['foot'] }] }, poses: FOOT_POSES },
};

/** Shot baseline `id`'s shot and the scene second its frame shows. */
export function stampGateShotBaseline(id: StampGateShotId): { shot: PaintedShotProps; at: number } {
  const { shot, at } = SHOT_BASELINES[id];
  return { shot: shot(), at };
}

/** What shot baseline `id` is drawn from, as text: its sheets' programs and steps, its rigs, its poses, its frame and the images it loads. */
export function stampGateShotInputs(id: StampGateShotId): string {
  const { evaluation, rigs, poses, at } = SHOT_BASELINES[id], compiled = compilePaintingSelection(evaluation(), stampGateSheetBrushOf);
  return stampCanonicalJson({ programs: compiled.sheets.map(({ program }) => program), steps: compiled.steps, rigs, poses, at, images: STAMP_GATE_SHEET_IMAGES });
}

const insideEllipse = ({ x, y }: StampPoint, centre: StampPoint, rx: number, ry: number) => ((x - centre.x) / rx) ** 2 + ((y - centre.y) / ry) ** 2 <= 1;

/** Whether `p` lies inside convex `polygon` (x, y pairs, either winding) at least `inset` px from each edge. */
function insidePolygon(p: StampPoint, polygon: readonly number[], inset: number): boolean {
  const n = polygon.length / 2, sides: number[] = [];
  for (let i = 0; i < n; i++) {
    const ax = polygon[2 * i], ay = polygon[2 * i + 1], bx = polygon[(2 * i + 2) % polygon.length], by = polygon[(2 * i + 3) % polygon.length];
    sides.push(((bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax)) / Math.hypot(bx - ax, by - ay));
  }
  return sides.every((d) => d >= inset) || sides.every((d) => d <= -inset);
}

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
    wing: windowOf((p) => insidePolygon(p, STAMP_GATE_HERON_VANE, WINDOW_INSET)),
  };
}

/**
 * How near a reed's outline a pixel's centre lies to be its edge, px: where its paint thins below its card's cover, so
 * pieces laid by their alpha may differ from their sheet laid as itself (ENGINE 6.5, contract limit 5).
 */
const REED_EDGE = 1.5;

/** How far `p` lies from segment `a`–`b`. */
function segmentDistance(p: StampPoint, a: StampPoint, b: StampPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, along = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - along * dx, p.y - a.y - along * dy);
}

/**
 * How the rigged heron's reeds at rest, drawn as pieces (`pieces`, RGB bytes) differ from their sheet laid unrigged
 * (`painted`), over a `width`-px-wide frame: the most a channel differs within REED_EDGE of either reed's outline, and
 * anywhere else.
 */
export function stampGateReedsAtRest(pieces: ArrayLike<number>, painted: ArrayLike<number>, width: number): { edge: number; elsewhere: number } {
  const outlines = [REED_A, REED_B].flatMap((polygon) => Array.from({ length: polygon.length / 2 }, (_, i) => [
    { x: polygon[2 * i], y: polygon[2 * i + 1] }, { x: polygon[(2 * i + 2) % polygon.length], y: polygon[(2 * i + 3) % polygon.length] },
  ] as const));
  let edge = 0, elsewhere = 0;
  for (let i = 0; i < pieces.length; i++) {
    const d = Math.abs(pieces[i] - painted[i]), texel = Math.floor(i / 3), p = { x: (texel % width) + 0.5, y: Math.floor(texel / width) + 0.5 };
    if (!d) continue;
    if (outlines.some(([a, b]) => segmentDistance(p, a, b) <= REED_EDGE)) edge = Math.max(edge, d);
    else elsewhere = Math.max(elsewhere, d);
  }
  return { edge, elsewhere };
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
