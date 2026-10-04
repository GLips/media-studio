// stamp-gate-shot-masks.ts: the gate's masked shot (ENGINE 6.3's masks through a PaintedShot). The paper heron's pond
// at the back; its heron on a plane of its own, revealed along two strokes by a path mask whose reveal is a table by
// scene second; a disc moving across, a picture or three plane; and nearest, a tint washed over the whole sheet, cut by
// an alphaOf mask to the heron's wing, to all but it, to the whole heron, or to the disc. What the checks measure of
// their frames is here.

import { PAINT_CAMERA_REST, paintCameraPlay, paintPlaneSimilarity, paintStageCentre } from '#lib/paint/animation/models/paint-camera.ts';
import { paintSimilarityApply } from '#lib/paint/animation/models/paint-similarity.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { srgbToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPictureRgba } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { shotPathMaskCapsules } from '#lib/paint/shot/models/shot-masks.ts';
import type { PaintedShotProps, PlaneMask, PlaneProps, ThreeSource } from '#lib/paint/shot/models/shot-props.ts';
import { STAMP_GATE_HERON_VANE, stampGateHeronLayer, stampGateHeronPolygon, stampGateInsidePolygon, stampGatePaperHeronDocument } from './stamp-gate-paper-heron.ts';

/** The masked shot's cases: its path mask's; its alphaOf masks'; and a painted plane's alphaOf of another, over frames and faded. */
export const STAMP_GATE_SHOT_MASK_IDS = ['shot/masks: path', 'shot/masks: alphaOf', 'shot/masks: alphaOf painted'] as const;
export type StampGateShotMaskId = (typeof STAMP_GATE_SHOT_MASK_IDS)[number];

/** A yellow-ochre wash over the whole sheet, after the heron: what the tint plane's mask cuts. */
const TINT = stampGateHeronLayer('tint', stampGateHeronPolygon(0, 0, 200, 0, 200, 140, 0, 140), { parts: [{ pigment: WATERCOLOUR_PIGMENTS.yellowOchre, amount: 1 }], strength: 0.4 }, 0.6);

/** The paper heron with a tint over it all. */
export const STAMP_GATE_TINTED_HERON: PaintingSourceModule = {
  default: function gateTintedHeron() {
    return stampGatePaperHeronDocument([], [TINT]);
  },
};

/** The path mask's strokes, document px: two passes across the heron, a pen-up between. */
const STROKES: readonly (readonly StampPoint[])[] = [[{ x: 10, y: 36 }, { x: 190, y: 36 }], [{ x: 10, y: 84 }, { x: 190, y: 84 }]];
/** The band's width and soft edge, px: the passes' bands overlap, so the whole reveal shows all the heron. */
const BAND = { widthPx: 56, softPx: 4 } as const;
/** The frames' scene seconds: the heron revealed not at all, along part of its first stroke, and wholly. */
export const STAMP_GATE_MASKS_AT = { none: 0, part: 1, whole: 2 } as const;
const REVEALS: readonly { readonly from: number; readonly revealPx: number }[] = [
  { from: STAMP_GATE_MASKS_AT.none, revealPx: 0 },
  { from: STAMP_GATE_MASKS_AT.part, revealPx: 100 },
  // Past the strokes' inked length (360 px): a reveal holds there.
  { from: STAMP_GATE_MASKS_AT.whole, revealPx: 400 },
];
const revealAt = (at: number) => REVEALS.findLast(({ from }) => from <= at)!.revealPx;

/** The disc's plane's depth; its centre at scene second 0 and radius, its plane's px; how far it moves right each second. */
export const STAMP_GATE_MASKS_DISC = { depth: 1.5, x: 50, y: 96, r: 28, perSecond: 40 } as const;
/** Where the disc's centre lies on its plane at scene second `at`. */
export const stampGateMaskDiscCentre = (at: number): StampPoint => ({ x: STAMP_GATE_MASKS_DISC.x + STAMP_GATE_MASKS_DISC.perSecond * at, y: STAMP_GATE_MASKS_DISC.y });

/** The shot's stage: a margin past the frame wide enough for a pan of `pan` px to show nothing past it. */
const stageFor = (pan: number) => stampStage({ width: 200, height: 140 }, 2 + 2 * Math.ceil(pan / 2));

/** What a masked shot shows. */
export type StampGateMaskedShot = {
  /** Revealed along its strokes, unmasked, half faded or hidden (its group's visibility 0.5 or 0, its plane still laid), or left out. */
  readonly heron: 'revealed' | 'unmasked' | 'half' | 'hidden' | 'none';
  /** The disc (STAMP_GATE_MASKS_DISC) as a picture plane or drawn by a three plane; none when left out. */
  readonly disc?: 'picture' | ThreeSource;
  /** The tint cut to the heron's wing, to all but it, to the whole heron group, or to the disc; uncut; or left out. */
  readonly tint: 'wing' | 'not wing' | 'heron' | 'disc' | 'uncut' | 'none';
  /** The pond's water cut by a path mask revealing nothing, or faded (its visibility 0). */
  readonly pond?: 'cut' | 'faded';
  /** How far right the camera pans, px; at rest when left out. */
  readonly pan?: number;
};

/** The gate's masked shot as `shown` says, on the tinted heron's sheet. */
export function stampGateMaskedShot({ heron, disc, tint, pond, pan = 0 }: StampGateMaskedShot): PaintedShotProps {
  const stage = stageFor(pan), evaluation = painting(STAMP_GATE_TINTED_HERON), cut: PlaneMask = { kind: 'path', subpaths: STROKES, ...BAND, revealPx: 0 };
  const planes: PlaneProps[] = [{ id: 'pond', depth: 3, source: layersOf(evaluation, ['water']), ...(pond === 'cut' && { masks: [cut] }) }];
  if (heron !== 'none') planes.push({ id: 'heron', depth: 2, source: layersOf(evaluation, ['heron']), ...(heron === 'revealed' && { masks: [{ ...cut, revealPx: ({ at }) => revealAt(at) }] }) });
  if (disc) {
    const source = disc === 'picture' ? { kind: 'picture', extent: { kind: 'everywhere' }, pictureAt: ({ at }: PaintMoment) => Promise.resolve(stampGateMaskDisc(at, stage.margin)) } as const : disc;
    planes.push({ id: 'disc', depth: STAMP_GATE_MASKS_DISC.depth, source });
  }
  const read = { wing: 'heron/wing', 'not wing': 'heron/wing', heron: 'heron/heron', disc: 'disc' } as const, tinted = { id: 'tint', depth: 1, source: layersOf(evaluation, ['tint']) };
  if (tint === 'uncut') planes.push(tinted);
  else if (tint !== 'none') planes.push({ ...tinted, masks: [{ kind: 'alphaOf', drawable: read[tint], invert: tint === 'not wing' }] });
  const plays = pan ? [paintCameraPlay({ kind: 'move', keys: [{ at: 0, pan: { x: pan, y: 0 } }] }, { clock: { at: 0 }, origin: 'pan' })] : [];
  return {
    camera: { stage, fov: 35, lens: { bloom: 0, shutter: 0 }, plays },
    planes,
    visibility: { ...(heron === 'hidden' && { 'heron/heron': 0 }), ...(heron === 'half' && { 'heron/heron': 0.5 }), ...(pond === 'faded' && { 'pond/water': 0 }) },
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

/** What the baseline's frame is drawn from beside its sheets: its strokes, band and reveals, and what the tint reads. */
export const STAMP_GATE_MASKS_PRESENTATION = { strokes: STROKES, band: BAND, reveals: REVEALS, tint: { drawable: 'heron/wing' } } as const;

/** Where the heron's wing and its tip lie, frame px, end exclusive: their outlines' box grown by their paint's bleed. */
export const STAMP_GATE_MASKS_WING: StampBox = { x0: 90, y0: 12, x1: 184, y1: 78 };

const segmentDistance = (p: StampPoint, a: StampPoint, b: StampPoint) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

const differs = (a: ArrayLike<number>, b: ArrayLike<number>, texel: number) => [0, 1, 2].some((c) => Math.abs(a[3 * texel + c] - b[3 * texel + c]) > 2);

/**
 * How the part-revealed frame `part` (RGB bytes, `width` px wide) lies against the frames revealing `none` and the
 * `whole`: texels well inside the revealed band differing from the whole by over 2 levels, texels outside the band
 * differing from none, and texels the reveal changed from none at all.
 */
export function stampGateRevealSplit(part: ArrayLike<number>, none: ArrayLike<number>, whole: ArrayLike<number>, width: number): { inside: number; outside: number; shown: number } {
  const capsules = shotPathMaskCapsules(STROKES, revealAt(STAMP_GATE_MASKS_AT.part)), half = BAND.widthPx / 2;
  let inside = 0, outside = 0, shown = 0;
  for (let texel = 0; texel < part.length / 3; texel++) {
    const p = { x: (texel % width) + 0.5, y: Math.floor(texel / width) + 0.5 }, d = Math.min(...capsules.map(({ a, b }) => segmentDistance(p, a, b)));
    if (differs(part, none, texel)) shown++;
    if (d <= half - BAND.softPx - 1 && differs(part, whole, texel)) inside++;
    if (d >= half + 1 && differs(part, none, texel)) outside++;
  }
  return { inside, outside, shown };
}

/**
 * How frame `cut` (the tint cut by a mask) differs from `bare` (no tint), RGB bytes `width` px wide: texels changed
 * inside `box` and outside it, and how many texels lie outside it; and of the texels well inside the vane (5 px in),
 * how many there are and how many changed.
 */
export function stampGateTintSplit(cut: ArrayLike<number>, bare: ArrayLike<number>, width: number, box: StampBox): { inside: number; outside: number; beyond: number; vane: number; vaneAll: number } {
  let inside = 0, outside = 0, beyond = 0, vane = 0, vaneAll = 0;
  for (let texel = 0; texel < cut.length / 3; texel++) {
    const x = texel % width, y = Math.floor(texel / width), within = x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1, changed = differs(cut, bare, texel);
    const inVane = stampGateInsidePolygon({ x: x + 0.5, y: y + 0.5 }, STAMP_GATE_HERON_VANE, 5);
    if (!within) beyond++;
    if (changed && within) inside++;
    if (changed && !within) outside++;
    if (inVane) vaneAll++;
    if (changed && inVane) vane++;
  }
  return { inside, outside, beyond, vane, vaneAll };
}

/**
 * How much of the tint frame `cut` lays well inside the vane (5 px in), as a share of what `uncut` lays there, both
 * over `bare` (RGB bytes, `width` px wide), in linear light: 1 where its mask read whole coverage, 0 where none.
 */
export function stampGateVaneTintShare(cut: ArrayLike<number>, uncut: ArrayLike<number>, bare: ArrayLike<number>, width: number): number {
  let laid = 0, whole = 0;
  for (let texel = 0; texel < cut.length / 3; texel++) {
    if (!stampGateInsidePolygon({ x: (texel % width) + 0.5, y: Math.floor(texel / width) + 0.5 }, STAMP_GATE_HERON_VANE, 5)) continue;
    for (let c = 3 * texel; c < 3 * texel + 3; c++) {
      const under = srgbToLinear(bare[c] / 255);
      laid += Math.abs(srgbToLinear(cut[c] / 255) - under);
      whole += Math.abs(srgbToLinear(uncut[c] / 255) - under);
    }
  }
  return whole > 0 ? laid / whole : 0;
}
