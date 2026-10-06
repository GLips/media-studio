// stamp-gate-shot-masks.ts: the gate's masked shot (ENGINE 6.3's masks through a PaintedShot). The paper heron's pond
// at the back; its heron on a plane of its own, revealed by its document along two strokes; a disc moving across, a
// picture or three plane or a painted spot's instance, faded or held; and nearest, a tint washed over the whole
// sheet, cut by an alphaOf mask to the heron's wing, to all but it, to the whole heron, or to the disc, under a camera
// at rest, panned, or panning, its shutter shut or the film's. What the checks measure of their frames is here.

import { paintShotViewAt } from '#lib/paint/animation/models/paint-camera-depths.ts';
import { paintKeyed } from '#lib/paint/animation/models/paint-keyed.ts';
import { PAINT_CAMERA_REST, paintCameraPlay, paintPlaneSimilarity, paintStageCentre } from '#lib/paint/animation/models/paint-camera.ts';
import { paintSimilarityApply, paintSimilarityBox, paintSimilarityInverse, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import type { PaintingDocument, Reveal } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPictureRgba } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { InstancedPlaneProps, PlaneInstance, PlaneProps, ThreeSource } from '#lib/paint/shot/models/shot-props.ts';
import { dissolve } from '#lib/paint/shot/models/shot-selection.ts';
import { stampGateTexelDiffers } from './stamp-gate-frames.ts';
import { STAMP_GATE_HERON_VANE, stampGateHeronLayer, stampGateHeronPolygon, stampGateInsidePolygon, stampGatePaperHeronDocument } from './stamp-gate-paper-heron.ts';
import { stampGateShotSpan, type StampGateShot } from './stamp-gate-shot-span.ts';

/**
 * The masked shot's cases: its alphaOf masks'; a painted plane's alphaOf of another, over frames as its heron is
 * revealed, faded and dissolving; the disc's sources faded, held and instanced, as drawn and as read; and a mask
 * across two depths under a pan.
 */
export const STAMP_GATE_SHOT_MASK_IDS = ['shot/masks: alphaOf', 'shot/masks: alphaOf painted', 'shot/masks: sources', 'shot/masks: across depths', 'shot/masks: across depths open'] as const;
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
  /** The tint's depth; 1, nearest, when left out. */
  readonly tintDepth?: number;
  /** How far right the camera pans, px; at rest when left out. */
  readonly pan?: number;
  /** How many seconds the camera takes to pan evenly from rest to `pan`; panned from the start when left out. */
  readonly panOver?: number;
  /** The camera's shutter: shut (when left out), or the film's, a lens's default, open half a frame. */
  readonly shutter?: 'shut' | 'film';
};

/** The gate's masked shot as `shown` says, on the tinted heron's sheet. */
export function stampGateMaskedShot({ heron, disc, discVisibility, discHold, tint, tintDepth = 1, pan = 0, panOver, shutter }: StampGateMaskedShot): StampGateShot {
  const stage = stageFor(pan), evaluation = painting(STAMP_GATE_TINTED_HERON), revealed = painting(STAMP_GATE_TINTED_HERON, { revealed: true });
  const planes: (PlaneProps | InstancedPlaneProps)[] = [{ id: 'pond', depth: POND_DEPTH, source: layersOf(evaluation, ['water']), ...(pan > 0 && { lay: pondLay(pan) }) }];
  if (heron === 'revealed') planes.push({ id: 'heron', depth: 2, source: ({ at }) => layersOf(revealed, ['heron'], { at }) });
  else if (heron !== 'none') {
    const source = heron === 'dissolving' ? dissolve(layersOf(evaluation, ['heron']), layersOf(evaluation, ['water']), 0.5) : layersOf(evaluation, ['heron']);
    const visibility = { hidden: 0, half: 0.5, unmasked: undefined, dissolving: undefined }[heron];
    planes.push({ id: 'heron', depth: 2, source, occurrences: { heron: { visibility } } });
  }
  const discShown = discVisibility !== undefined && { visibility: discVisibility };
  if (disc === 'spot') {
    const depths = { near: STAMP_GATE_MASKS_DISC.depth - 0.25, far: STAMP_GATE_MASKS_DISC.depth + 0.25 }, variants = { spot: layersOf(painting(STAMP_GATE_MASKS_SPOT), ['spot']) };
    planes.push({ kind: 'instanced', id: 'disc', depths, variants, instances: ({ at }) => [spotAt(at)], ...discShown });
  } else if (disc) {
    const source = disc === 'picture' ? { kind: 'picture', extent: { kind: 'everywhere' }, pictureAt: ({ at }: PaintMoment) => Promise.resolve(stampGateMaskDisc(at, stage.margin)) } as const : disc;
    planes.push({ id: 'disc', depth: STAMP_GATE_MASKS_DISC.depth, source, ...(discHold && { sourceClock: { hold: discHold } }), ...discShown });
  }
  const read = { wing: 'heron/wing', 'not wing': 'heron/wing', heron: 'heron/heron', disc: 'disc' } as const, tinted = { id: 'tint', depth: tintDepth, source: layersOf(evaluation, ['tint']) };
  if (tint === 'uncut') planes.push(tinted);
  else if (tint !== 'none') planes.push({ ...tinted, masks: [{ kind: 'alphaOf', drawable: read[tint], invert: tint === 'not wing' }] });
  const panned = { pan: { x: pan, y: 0 } };
  const move = panOver ? paintKeyed([{ at: 0, value: { pan: { x: 0, y: 0 } } }, { at: panOver, value: panned }]) : panned;
  const plays = pan ? [paintCameraPlay({ kind: 'move', value: move }, { clock: { at: 0 }, origin: 'pan' })] : [];
  return {
    camera: { stage, fov: 35, lens: shutter === 'film' ? { bloom: 0 } : { bloom: 0, shutter: 'shut' }, plays },
    planes,
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

/** Where the disc shows at scene second `at` as `view` shows its plane: frame px, end exclusive, 2 px past its edge. */
export function stampGateMaskDiscBox(at: number, view: PaintSimilarity): StampBox {
  const { r } = STAMP_GATE_MASKS_DISC, { x, y } = paintSimilarityApply(view, stampGateMaskDiscCentre(at));
  return { x0: Math.floor(x - r - 2), y0: Math.floor(y - r - 2), x1: Math.ceil(x + r + 2), y1: Math.ceil(y + r + 2) };
}

/** The masked shot's baseline: the heron part revealed, its wing tinted where it shows. */
export const STAMP_GATE_MASKS_BASELINE = { shown: { heron: 'revealed', tint: 'wing' }, at: STAMP_GATE_MASKS_AT.part } as const satisfies { shown: StampGateMaskedShot; at: number };

/**
 * The mask across depths: the tint, at depth 1, cut to the wing of the heron at depth 2 as the camera pans 24 px over
 * a second, parting the two depths by 12 px; its frames' scene seconds; its baseline, the pan's end.
 */
export const STAMP_GATE_MASKS_ACROSS = {
  shown: { heron: 'unmasked', tint: 'wing', pan: 24, panOver: 1 }, times: [0, 0.5, 1], at: 1,
} as const satisfies { shown: StampGateMaskedShot; times: readonly number[]; at: number };

/**
 * The mask across depths under the film's shutter, the lens's default: the camera whipping PAN px across in half a
 * second, the tint at depth 1 sliding past the wing at depth 2 as it goes; its frame mid-pan, the baseline's too.
 */
export const STAMP_GATE_MASKS_WHIP = {
  shown: { heron: 'unmasked', tint: 'wing', pan: 192, panOver: 0.5, shutter: 'film' }, at: 0.25,
} as const satisfies { shown: StampGateMaskedShot; at: number };

/** What the baseline's frame is drawn from beside its sheets: its heron's reveal, and what the tint reads. */
export const STAMP_GATE_MASKS_PRESENTATION = { reveal: MASKS_REVEAL, tint: { drawable: 'heron/wing' } } as const;

/** Where the heron's wing and its tip lie, frame px, end exclusive: their outlines' box grown by their paint's bleed. */
export const STAMP_GATE_MASKS_WING: StampBox = { x0: 90, y0: 12, x1: 184, y1: 78 };

/** Whether frame px `p` lies well inside the vane, 5 px in. */
export const stampGateWellInsideVane = (p: StampPoint) => stampGateInsidePolygon(p, STAMP_GATE_HERON_VANE, 5);

/** How the masked shot `shown`'s own camera shows a plane at `depth` at scene second `at`, plane px to frame px. */
export const stampGateMaskedView = (shown: StampGateMaskedShot, depth: number, at: number): PaintSimilarity => paintShotViewAt(stampGateMaskedShot(shown).camera, stampGateShotSpan([at]), depth, paintMoment(at));

/**
 * How frame `cut` (the tint cut by a mask) differs from `bare` (no tint), RGB bytes `width` px wide, the heron's
 * plane shown through `view` (at rest when left out): texels changed inside `box` and outside it, texels outside it,
 * and of the texels well inside the vane (5 px in), how many there are and how many changed.
 */
export function stampGateTintSplit(
  cut: ArrayLike<number>, bare: ArrayLike<number>, width: number, box: StampBox, view: PaintSimilarity = { ma: 1, mb: 0, kx: 0, ky: 0 },
): { inside: number; outside: number; beyond: number; vane: number; vaneAll: number } {
  const shownBox = paintSimilarityBox(view, box), toHeron = paintSimilarityInverse(view);
  let inside = 0, outside = 0, beyond = 0, vane = 0, vaneAll = 0;
  for (let texel = 0; texel < cut.length / 3; texel++) {
    const x = texel % width, y = Math.floor(texel / width), changed = stampGateTexelDiffers(cut, bare, texel, 3);
    const within = x >= shownBox.x0 && x < shownBox.x1 && y >= shownBox.y0 && y < shownBox.y1;
    const inVane = stampGateWellInsideVane(paintSimilarityApply(toHeron, { x: x + 0.5, y: y + 0.5 }));
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

/**
 * Whether any texel (with `every`, every texel) of `flags`, one a texel `width` wide, within `reach` texels each way of
 * each texel is set; a texel past the frame counts as unset.
 */
function texelsAround(flags: readonly boolean[], width: number, reach: number, every: boolean): boolean[] {
  const height = flags.length / width;
  return flags.map((_, i) => {
    const x = i % width, y = Math.floor(i / width);
    for (let j = y - reach; j <= y + reach; j++) {
      for (let k = x - reach; k <= x + reach; k++) {
        const set = j >= 0 && j < height && k >= 0 && k < width && flags[j * width + k];
        if (set !== every) return !every;
      }
    }
    return every;
  });
}

/**
 * Where frame `cut`'s tint (its texels changed from `bare`) lies against its twin's (`twinCut` against `twinBare`), RGB
 * bytes `width` px wide: texels it tints farther than `reach` px from any its twin tints (`strays`), texels its twin
 * tints `reach` px inside its tint that it leaves (`missed`), and how many each tints.
 */
export function stampGateTintAgainstTwin(
  [cut, bare]: readonly [ArrayLike<number>, ArrayLike<number>], [twinCut, twinBare]: readonly [ArrayLike<number>, ArrayLike<number>], width: number, reach: number,
): { strays: number; missed: number; tinted: number; twinTinted: number } {
  const count = cut.length / 3, tinted = Array.from({ length: count }, (_, i) => stampGateTexelDiffers(cut, bare, i, 3));
  const twin = Array.from({ length: count }, (_, i) => stampGateTexelDiffers(twinCut, twinBare, i, 3));
  const near = texelsAround(twin, width, reach, false), within = texelsAround(twin, width, reach, true);
  let strays = 0, missed = 0;
  for (let i = 0; i < count; i++) {
    if (tinted[i] && !near[i]) strays++;
    if (within[i] && !tinted[i]) missed++;
  }
  return { strays, missed, tinted: tinted.filter(Boolean).length, twinTinted: twin.filter(Boolean).length };
}
