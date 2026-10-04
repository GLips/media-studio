// stamp-gate-shots.ts: the gate's shots (ENGINE 9, tests 6 and 7 drawn through a PaintedShot): the rigged heron, the
// paper heron with a neck skinned to its body on the scene's sheet (a lowered neck its second cel), its wing a cel
// moving its own sheet whole, and a clump of reeds whose group owns its sheet, drawn as pieces, also boiling; and the
// wet-contact sheet with its heron's foot posed by a rig, also painted in as it plays; the heron alone, a clear back
// over HTML, also pinned (shot/page); and the rain (stamp-gate-rain.ts). Each shot's poses are a table by scene
// second, and the rain's drops one of their own, so its baseline's inputs name them. What the cases measure of their
// frames is here, pure.

import { compilePaintingSelection } from '#lib/paint/document/models/painting-document-compile.ts';
import type { LayerNode, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingEvaluation, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampCanonicalJson, type StampCanonicalDatum } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { PaintedShotProps, RigPart, RigPartPose, ScreenPin } from '#lib/paint/shot/models/shot-props.ts';
import {
  STAMP_GATE_HERON_BODY, STAMP_GATE_HERON_MOVE, STAMP_GATE_HERON_VANE, stampGateHeronLayer, stampGateHeronPaper, stampGateHeronPolygon, stampGatePaperHeronDocument,
} from './stamp-gate-paper-heron.ts';
import { STAMP_GATE_RAIN, STAMP_GATE_RAINY_STREET, stampGateRainShot } from './stamp-gate-rain.ts';
import { STAMP_GATE_HERON_POSE, STAMP_GATE_SHEET_IMAGES, STAMP_GATE_WET_CONTACT, stampGateSheetBrushOf } from './stamp-gate-sheets.ts';

/** The shot over a page: its DOM adapter's reads, and a clear back pinned to an element, drawn and read back. */
export const STAMP_GATE_SHOT_PAGE_IDS = ['shot/page'] as const;

/** The shots accepted by eye: each a baseline subject, one frame of its shot. */
export const STAMP_GATE_SHOT_IDS = ['shot/paper-heron', 'shot/wet-contact', 'shot/rain'] as const;

/** The shot cases checked apart from any sheet case: each a page's checks of its shot's frames. */
export const STAMP_GATE_SHOT_CASE_IDS = ['shot/rain'] as const;
export type StampGateShotCaseId = (typeof STAMP_GATE_SHOT_CASE_IDS)[number];
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
/** How far inside the swung reed's outline its paint is measured, px: clear of its edge's bleed. */
const REED_INSET = 1.5;

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

/** Two frames of consecutive boil epochs of the boiling heron, scene seconds, mid-frame: both before it moves. */
export const STAMP_GATE_HERON_BOIL_AT = [1.5 / PAINT_ANIMATION_FPS, 2.5 / PAINT_ANIMATION_FPS] as const;

/** The rigged heron boiling every frame, its wobble on the heron's group, whose rig takes it. */
export const stampGateBoilingHeronShot = (): PaintedShotProps => ({
  ...stampGateRiggedHeronShot(), motion: { nodes: [{ id: 'paper/heron', marks: { boil: { every: 1 } } }], plays: [] },
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
 * How a clear canvas's RGBA bytes (as the browser reads it back, unpremultiplied) lie: how many texels are clear, how
 * many at least half opaque, the most opaque of its corners, which the heron's paint stays clear of, and its alpha's
 * centroid in frame px, a texel's centre half a px in.
 */
export function stampGateClearAlpha(rgba: ArrayLike<number>, width: number, height: number): { clear: number; opaque: number; corner: number; centroid: StampPoint } {
  let clear = 0, opaque = 0, sum = 0, x = 0, y = 0;
  for (let texel = 0; texel < width * height; texel++) {
    const alpha = rgba[texel * 4 + 3];
    if (alpha === 0) clear++;
    if (alpha >= 128) opaque++;
    sum += alpha;
    x += alpha * ((texel % width) + 0.5);
    y += alpha * (Math.floor(texel / width) + 0.5);
  }
  const corner = Math.max(...[0, width - 1, (height - 1) * width, height * width - 1].map((texel) => rgba[texel * 4 + 3]));
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

/** Each shot baseline: its shot, the frame it shows, and its sources, poses and instances as its inputs name them. */
const SHOT_BASELINES: Readonly<Record<StampGateShotId, {
  shot: () => PaintedShotProps; at: number; evaluation: () => PaintingEvaluation; rigs: Readonly<Record<string, readonly RigPart[]>>; poses: StampGatePoseTable; instances?: StampCanonicalDatum;
}>> = {
  'shot/paper-heron': { shot: stampGateRiggedHeronShot, at: STAMP_GATE_RIGGED_HERON_AT.posed, evaluation: () => painting(STAMP_GATE_RIGGED_HERON), rigs: { heron: HERON_PARTS, reeds: REED_PARTS }, poses: HERON_POSES },
  'shot/wet-contact': { shot: stampGateWetContactShot, at: STAMP_GATE_WET_CONTACT_AT.posed, evaluation: () => painting(STAMP_GATE_WET_CONTACT), rigs: { heron: FOOT_RIG }, poses: FOOT_POSES },
  'shot/rain': { shot: stampGateRainShot, at: STAMP_GATE_RAIN.at.first, evaluation: () => painting(STAMP_GATE_RAINY_STREET), rigs: {}, poses: [], instances: STAMP_GATE_RAIN },
};

/** Shot baseline `id`'s shot and the scene second its frame shows. */
export function stampGateShotBaseline(id: StampGateShotId): { shot: PaintedShotProps; at: number } {
  const { shot, at } = SHOT_BASELINES[id];
  return { shot: shot(), at };
}

/** What shot baseline `id` is drawn from, as text: its sheets' programs and steps, its rigs, its poses, its instances, its frame and the images it loads. */
export function stampGateShotInputs(id: StampGateShotId): string {
  const { evaluation, rigs, poses, at, instances } = SHOT_BASELINES[id], compiled = compilePaintingSelection(evaluation(), stampGateSheetBrushOf);
  return stampCanonicalJson({ programs: compiled.sheets.map(({ program }) => program), steps: compiled.steps, rigs, poses, at, images: STAMP_GATE_SHEET_IMAGES, ...(instances !== undefined && { instances }) });
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
 * How many texels of the swung reed's paint at rest, well inside its outline, differ by over 2 levels between the
 * rigged heron's `rest` and `swung` frames (RGB bytes, `width` px wide): none where its pieces weren't drawn or posed.
 */
export function stampGateReedSwung(rest: ArrayLike<number>, swung: ArrayLike<number>, width: number): number {
  let changed = 0;
  for (let texel = 0; texel < rest.length / 3; texel++) {
    const p = { x: (texel % width) + 0.5, y: Math.floor(texel / width) + 0.5 };
    if (!insidePolygon(p, REED_B, REED_INSET)) continue;
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
