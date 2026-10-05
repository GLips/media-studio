// stamp-gate-shot-masks.ts: the gate's masked shot (ENGINE 6.3's masks through a PaintedShot). The paper heron's pond
// at the back; its heron on a plane of its own, revealed by its document along two strokes; a disc moving across, a
// picture or three plane or a painted spot's instance, faded or held; and nearest, a tint washed over the whole
// sheet, cut by an alphaOf mask to the heron's wing, to all but it, to the whole heron, or to the disc. What the
// checks measure of their frames is here.

import { PAINT_CAMERA_REST, paintCameraPlay, paintPlaneSimilarity, paintStageCentre } from '#lib/paint/animation/models/paint-camera.ts';
import { paintSimilarityApply } from '#lib/paint/animation/models/paint-similarity.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import type { PaintingDocument, Reveal } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPictureRgba } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { InstancedPlaneProps, PaintedShotProps, PlaneInstance, PlaneProps, ThreeSource } from '#lib/paint/shot/models/shot-props.ts';
import { dissolve } from '#lib/paint/shot/models/shot-selection.ts';
import { stampGateTexelDiffers } from './stamp-gate-frames.ts';
import { STAMP_GATE_HERON_VANE, stampGateHeronLayer, stampGateHeronPolygon, stampGateInsidePolygon, stampGatePaperHeronDocument } from './stamp-gate-paper-heron.ts';

/**
 * The masked shot's cases: its alphaOf masks'; a painted plane's alphaOf of another, over frames as its heron is
 * revealed, faded and dissolving; and the disc's sources faded, held and instanced, as drawn and as read.
 */
export const STAMP_GATE_SHOT_MASK_IDS = ['shot/masks: alphaOf', 'shot/masks: alphaOf painted', 'shot/masks: sources'] as const;
export type StampGateShotMaskId = (typeof STAMP_GATE_SHOT_MASK_IDS)[number];

/** A yellow-ochre wash over the whole sheet, after the heron: what the tint plane's mask cuts. */
const TINT = stampGateHeronLayer('tint', stampGateHeronPolygon(0, 0, 200, 0, 200, 140, 0, 140), { parts: [{ pigment: WATERCOLOUR_PIGMENTS.yellowOchre, amount: 1 }], strength: 0.4 }, 0.6);

/** The frames' scene seconds: the heron revealed not at all, along part of its first stroke, and wholly. */
export const STAMP_GATE_MASKS_AT = { none: 0, part: 1.8, whole: 5 } as const;

/**
 * The heron's reveal: two passes across it, a pen-up between, from 0.5 s at 100 px a second, their bands overlapping
 * so the whole reveal shows all the heron, its wing's cards too.
 */
const MASKS_REVEAL = {
  kind: 'strokes',
  strokes: [
    { points: [{ x: 10, y: 36 }, { x: 190, y: 36 }], widthPx: 56, from: 0.5, to: 2.3 },
    { points: [{ x: 10, y: 84 }, { x: 190, y: 84 }], widthPx: 56, from: 2.3, to: 4.1 },
  ],
} as const satisfies Reveal;

const tintedProperties = { revealed: { type: 'boolean', default: false } } as const satisfies PropertySchema;

/** The paper heron with a tint over it all, its heron group revealed along MASKS_REVEAL's strokes when `revealed`. */
export const STAMP_GATE_TINTED_HERON: PaintingSourceModule<typeof tintedProperties> = {
  properties: tintedProperties,
  default: function gateTintedHeron({ revealed }: PropertyValues<typeof tintedProperties>) {
    const tinted = stampGatePaperHeronDocument([], [TINT]);
    return revealed ? { ...tinted, layers: tinted.layers.map((node) => (node.key === 'heron' ? { ...node, reveal: MASKS_REVEAL } : node)) } : tinted;
  },
};

/**
 * The disc's plane's depth; its centre at scene second 0 and radius, its plane's px, and the painted spot's radius,
 * inside it so its bleed stays in the disc's box; how far it moves right each second.
 */
export const STAMP_GATE_MASKS_DISC = { depth: 1.5, x: 50, y: 96, r: 28, spot: 20, perSecond: 40 } as const;
/** Where the disc's centre lies on its plane at scene second `at`. */
export const stampGateMaskDiscCentre = (at: number): StampPoint => ({ x: STAMP_GATE_MASKS_DISC.x + STAMP_GATE_MASKS_DISC.perSecond * at, y: STAMP_GATE_MASKS_DISC.y });

/** A burnt-umber spot painted on the heron's paper where the disc's centre lies at scene second 0: an instance's variant. */
export const STAMP_GATE_MASKS_SPOT: PaintingSourceModule = {
  default: function gateMaskSpot(): PaintingDocument {
    const { x, y } = stampGateMaskDiscCentre(0), spot = { kind: 'ellipse', center: { x, y }, radiusX: STAMP_GATE_MASKS_DISC.spot, radiusY: STAMP_GATE_MASKS_DISC.spot } as const;
    return { ...stampGatePaperHeronDocument(), layers: [stampGateHeronLayer('spot', spot, { parts: [{ pigment: WATERCOLOUR_PIGMENTS.burntUmber, amount: 1 }], strength: 0.8 }, 0.7)] };
  },
};

/** The spot laid as one item at the disc's depth, its centre where the disc's is at scene second `at`. */
const spotAt = (at: number): PlaneInstance => {
  const from = stampGateMaskDiscCentre(0), to = stampGateMaskDiscCentre(at);
  return { key: 'spot', variant: 'spot', depth: STAMP_GATE_MASKS_DISC.depth, lay: { placement: { x: to.x - from.x, y: to.y - from.y, rotation: 0, scale: 1 }, pivot: from } };
};

/** The shot's stage: a margin past the frame wide enough for a pan of `pan` px to show nothing past it. */
const stageFor = (pan: number) => stampStage({ width: 200, height: 140 }, 2 + 2 * Math.ceil(pan / 2));

/** The pond's depth: the back, a pan moving it a third as far as the frame. */
const POND_DEPTH = 3;
/**
 * The pond laid about its middle large enough that a pan of `pan` px shows it still: painted the frame's size, it
 * grows by what the pan moves it past each side.
 */
const pondLay = (pan: number) => ({ placement: { x: 0, y: 0, rotation: 0, scale: 1 + pan / POND_DEPTH / 100 }, pivot: { x: 100, y: 70 } });

/** What a masked shot shows. */
export type StampGateMaskedShot = {
  /**
   * Revealed by its document at each frame's second, unrevealed, half faded or hidden (its group's visibility 0.5 or 0,
   * its plane still laid), dissolving halfway to the pond's water (none of which lies under it), or left out.
   */
  readonly heron: 'revealed' | 'unmasked' | 'half' | 'hidden' | 'dissolving' | 'none';
  /**
   * The disc (STAMP_GATE_MASKS_DISC) as a picture plane, drawn by a three plane, or the painted spot as an instanced
   * plane's one item; none when left out.
   */
  readonly disc?: 'picture' | 'spot' | ThreeSource;
  /** The disc's plane's visibility; 1 when left out. */
  readonly discVisibility?: number;
  /** How many frames the disc's source holds each moment it reads (its `sourceClock`); unheld when left out. */
  readonly discHold?: number;
  /** The tint cut to the heron's wing, to all but it, to the whole heron group, or to the disc; uncut; or left out. */
  readonly tint: 'wing' | 'not wing' | 'heron' | 'disc' | 'uncut' | 'none';
  /** How far right the camera pans, px; at rest when left out. */
  readonly pan?: number;
};

/** The gate's masked shot as `shown` says, on the tinted heron's sheet. */
export function stampGateMaskedShot({ heron, disc, discVisibility, discHold, tint, pan = 0 }: StampGateMaskedShot): PaintedShotProps {
  const stage = stageFor(pan), evaluation = painting(STAMP_GATE_TINTED_HERON), revealed = painting(STAMP_GATE_TINTED_HERON, { revealed: true });
  const planes: (PlaneProps | InstancedPlaneProps)[] = [{ id: 'pond', depth: POND_DEPTH, source: layersOf(evaluation, ['water']), ...(pan > 0 && { lay: pondLay(pan) }) }];
  if (heron === 'revealed') planes.push({ id: 'heron', depth: 2, source: ({ at }) => layersOf(revealed, ['heron'], { at }) });
  else if (heron !== 'none') {
    const source = heron === 'dissolving' ? dissolve(layersOf(evaluation, ['heron']), layersOf(evaluation, ['water']), 0.5) : layersOf(evaluation, ['heron']);
    planes.push({ id: 'heron', depth: 2, source });
  }
  if (disc === 'spot') {
    const depths = { near: STAMP_GATE_MASKS_DISC.depth - 0.25, far: STAMP_GATE_MASKS_DISC.depth + 0.25 }, variants = { spot: layersOf(painting(STAMP_GATE_MASKS_SPOT), ['spot']) };
    planes.push({ kind: 'instanced', id: 'disc', depths, variants, instances: ({ at }) => [spotAt(at)] });
  } else if (disc) {
    const source = disc === 'picture' ? { kind: 'picture', extent: { kind: 'everywhere' }, pictureAt: ({ at }: PaintMoment) => Promise.resolve(stampGateMaskDisc(at, stage.margin)) } as const : disc;
    planes.push({ id: 'disc', depth: STAMP_GATE_MASKS_DISC.depth, source, ...(discHold && { sourceClock: { hold: discHold } }) });
  }
  const read = { wing: 'heron/wing', 'not wing': 'heron/wing', heron: 'heron/heron', disc: 'disc' } as const, tinted = { id: 'tint', depth: 1, source: layersOf(evaluation, ['tint']) };
  if (tint === 'uncut') planes.push(tinted);
  else if (tint !== 'none') planes.push({ ...tinted, masks: [{ kind: 'alphaOf', drawable: read[tint], invert: tint === 'not wing' }] });
  const plays = pan ? [paintCameraPlay({ kind: 'move', keys: [{ at: 0, pan: { x: pan, y: 0 } }] }, { clock: { at: 0 }, origin: 'pan' })] : [];
  return {
    camera: { stage, fov: 35, lens: { bloom: 0, shutter: 'shut' }, plays },
    planes,
    visibility: {
      ...(heron === 'hidden' && { 'heron/heron': 0 }), ...(heron === 'half' && { 'heron/heron': 0.5 }),
      ...(discVisibility !== undefined && { disc: discVisibility }),
    },
  };
}

/** The disc at scene second `at` as a picture over a stage `margin` px past the frame: an opaque cool grey, its edge a texel soft. */
function stampGateMaskDisc(at: number, margin: number): StampPictureRgba {
  const { r } = STAMP_GATE_MASKS_DISC, centre = stampGateMaskDiscCentre(at), x0 = Math.floor(centre.x - r - 1), y0 = Math.floor(centre.y - r - 1);
  const box = { x: x0 + margin, y: y0 + margin, w: 2 * r + 3, h: 2 * r + 3 }, rgba = new Float32Array(box.w * box.h * 4);
  for (let j = 0; j < box.h; j++) {
    for (let i = 0; i < box.w; i++) {
      const a = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(x0 + i + 0.5 - centre.x, y0 + j + 0.5 - centre.y)));
      rgba.set([0.2 * a, 0.25 * a, 0.3 * a, a], (j * box.w + i) * 4);
    }
  }
  return { box, rgba };
}

/** Where the disc shows at scene second `at` through a camera panned `pan` px right: frame px, end exclusive, 2 px past its edge. */
export function stampGateMaskDiscBox(at: number, pan = 0): StampBox {
  const { depth, r } = STAMP_GATE_MASKS_DISC, view = paintPlaneSimilarity({ ...PAINT_CAMERA_REST, pan: { x: pan, y: 0 } }, depth, paintStageCentre(stageFor(pan)));
  const { x, y } = paintSimilarityApply(view, stampGateMaskDiscCentre(at));
  return { x0: Math.floor(x - r - 2), y0: Math.floor(y - r - 2), x1: Math.ceil(x + r + 2), y1: Math.ceil(y + r + 2) };
}

/** The masked shot's baseline: the heron part revealed, its wing tinted where it shows. */
export const STAMP_GATE_MASKS_BASELINE = { shown: { heron: 'revealed', tint: 'wing' }, at: STAMP_GATE_MASKS_AT.part } as const satisfies { shown: StampGateMaskedShot; at: number };

/** What the baseline's frame is drawn from beside its sheets: its heron's reveal, and what the tint reads. */
export const STAMP_GATE_MASKS_PRESENTATION = { reveal: MASKS_REVEAL, tint: { drawable: 'heron/wing' } } as const;

/** Where the heron's wing and its tip lie, frame px, end exclusive: their outlines' box grown by their paint's bleed. */
export const STAMP_GATE_MASKS_WING: StampBox = { x0: 90, y0: 12, x1: 184, y1: 78 };

/** Whether frame px `p` lies well inside the vane, 5 px in. */
export const stampGateWellInsideVane = (p: StampPoint) => stampGateInsidePolygon(p, STAMP_GATE_HERON_VANE, 5);

/**
 * How frame `cut` (the tint cut by a mask) differs from `bare` (no tint), RGB bytes `width` px wide: texels changed
 * inside `box` and outside it, and how many texels lie outside it; and of the texels well inside the vane (5 px in),
 * how many there are and how many changed.
 */
export function stampGateTintSplit(cut: ArrayLike<number>, bare: ArrayLike<number>, width: number, box: StampBox): { inside: number; outside: number; beyond: number; vane: number; vaneAll: number } {
  let inside = 0, outside = 0, beyond = 0, vane = 0, vaneAll = 0;
  for (let texel = 0; texel < cut.length / 3; texel++) {
    const x = texel % width, y = Math.floor(texel / width), within = x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1, changed = stampGateTexelDiffers(cut, bare, texel, 3);
    const inVane = stampGateWellInsideVane({ x: x + 0.5, y: y + 0.5 });
    if (!within) beyond++;
    if (changed && within) inside++;
    if (changed && !within) outside++;
    if (inVane) vaneAll++;
    if (changed && inVane) vane++;
  }
  return { inside, outside, beyond, vane, vaneAll };
}

/** Whether frame px `p` lies within `radius` px of the disc's centre at scene second `at`, the camera at rest. */
export function stampGateNearDiscCentre(at: number, radius: number): (p: StampPoint) => boolean {
  const view = paintPlaneSimilarity(PAINT_CAMERA_REST, STAMP_GATE_MASKS_DISC.depth, paintStageCentre(stageFor(0))), centre = paintSimilarityApply(view, stampGateMaskDiscCentre(at));
  return (p) => Math.hypot(p.x - centre.x, p.y - centre.y) <= radius;
}

