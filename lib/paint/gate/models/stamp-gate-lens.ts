// stamp-gate-lens.ts: the gate's lens cases, what a frame's lens does to a plane (stamp-plane.ts,
// stamp-paint-plane-passes.ts). A plane's defocus is held to a gaussian worked out here on the CPU in linear light; a
// glow to adding light only past its threshold, nothing at amount 0, nothing under opaque paint laid after it on its
// plane or on a nearer one, and the same frame when the picture holding its light is restored.

import { lensGaussianReach, lensSigmaStepped } from '#lib/picture/lens/models/lens-focus.ts';
import { linearToSrgb, srgbToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import { compileStampPaintRecipe, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPaintEnvironment } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { StampGroupGlow, StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampScenePlanes, STAMP_SINGLE_PLANE_ID, type StampLaidPlanes, type StampLensFrame, type StampPlaneLook } from '#lib/paint/painting/models/stamp-plane.ts';
import { STAMP_GATE_IMAGES, STAMP_GATE_WHITE, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import { stampGateFrameDifference, type StampGateFrameDifference } from './stamp-gate-frames.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';

export const STAMP_GATE_LENS_IDS = ['lens/defocus', 'lens/glow', 'lens/motion'];

const LENS_SIZE = { width: 160, height: 100 };
const LENS_FLAT: StampPaintEnvironment = { paper: STAMP_GATE_WHITE, mixing: { kind: 'flat' } };
/** A plane where it's painted, sharp. */
export const STAMP_GATE_REST_LOOK: StampPlaneLook = { view: { ma: 1, mb: 0, kx: 0, ky: 0 }, defocus: 0, distance: 1, shutter: null };

/** The defocus case's sigma, frame px, and the scale it's also seen at: its picture then blurs by the sigma over it. */
export const STAMP_GATE_DEFOCUS_SIGMA = 4;
export const STAMP_GATE_DEFOCUS_SCALE = 1.5;
/**
 * The defocus case's stage margin, px. A gaussian counts what lies past the stage as clear, and the CPU's counts white
 * paper there, so the margin paints paper past the reach of the stepped sigma: 12 px at rest, 9 plane px scaled.
 */
export const STAMP_GATE_DEFOCUS_MARGIN = 16;
/**
 * How far a defocused frame may sit from the CPU's gaussian of the sharp one, levels: each frame's dither and
 * rounding. Scaled, the picture's gaussian then the view's bilinear upscale stand for the frame's gaussian of the
 * upscaled frame, close but not exact.
 */
export const STAMP_GATE_DEFOCUS_TOLERANCE = 2;

/**
 * Strokes of flat colour glazed in the middle of plain white paper, well clear of the frame's edges: laid by glaze,
 * a frame is linear in the painting, so the picture's gaussian is the frame's, round the paper's white.
 */
export function stampGateDefocusPainting(): StampGatePainting {
  const brush = stampGateBrush('Defocus', { flow: 0.8 });
  const painting = compileStampPaintRecipe(stampPaintRecipe(LENS_FLAT, (p) => {
    p.group('patch', { composite: 'glaze', opacity: 1 }, (g) => g.passage('p', {}, (pass) => {
      pass.stroke('red', { brush, size: 12, well: { paint: { kind: 'color', color: '#c0302a' } }, path: [{ x: 52, y: 38 }, { x: 108, y: 42 }] });
      pass.stroke('blue', { brush, size: 8, well: { paint: { kind: 'color', color: '#203a8a' } }, path: [{ x: 60, y: 62 }, { x: 100, y: 56 }] });
    }));
  }));
  return { painting, ...LENS_SIZE, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

/** The defocus case's lens: its one plane `defocus` frame px out of focus, seen at `scale` about the frame's centre. */
export function stampGateDefocusLens(defocus: number, scale = 1): StampLensFrame {
  // p ↦ s·p + (1 − s)·c keeps the centre c where it is.
  const view = { ma: scale, mb: 0, kx: (1 - scale) * LENS_SIZE.width / 2, ky: (1 - scale) * LENS_SIZE.height / 2 };
  return { planes: new Map([[STAMP_SINGLE_PLANE_ID, { ...STAMP_GATE_REST_LOOK, view, defocus }]]), bloom: 0, focus: null, moving: false };
}

/**
 * A separable gaussian of `sigma` px over `channels` interleaved channels of a `width` × `height` image, round
 * `ground` (what lies past the image), weighted as the renderer weighs it: over three sigmas, normalised over every tap.
 */
export function stampGateGaussian(values: ArrayLike<number>, width: number, height: number, channels: number, sigma: number, ground: number): Float64Array {
  const reach = lensGaussianReach(sigma), weights = Array.from({ length: 2 * reach + 1 }, (_, k) => Math.exp(-0.5 * ((k - reach) ** 2) / (sigma * sigma)));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const pass = (from: Float64Array, dx: number, dy: number) => {
    const to = new Float64Array(from.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < channels; c++) {
      let sum = 0;
      for (let k = -reach; k <= reach; k++) {
        const sx = x + k * dx, sy = y + k * dy;
        if (sx >= 0 && sx < width && sy >= 0 && sy < height) sum += weights[k + reach] * from[(sy * width + sx) * channels + c];
      }
      to[(y * width + x) * channels + c] = sum / total;
    }
    return to;
  };
  const off = Float64Array.from(values, (v) => v - ground);
  return pass(pass(off, 1, 0), 0, 1).map((v) => v + ground);
}

/**
 * The CPU's defocus of an RGBA frame of the lens case's size: its bytes decoded to linear light, a gaussian of `sigma`
 * round white paper, encoded again; RGB levels, unrounded.
 */
function linearGaussian(frame: ArrayLike<number>, sigma: number): Float64Array {
  const { width, height } = LENS_SIZE;
  const linear = Float64Array.from({ length: width * height * 3 }, (_, i) => srgbToLinear(frame[Math.floor(i / 3) * 4 + (i % 3)] / 255));
  return stampGateGaussian(linear, width, height, 3, sigma, 1).map((v) => 255 * linearToSrgb(v));
}

/** The most an RGBA frame's RGB sits from `expected` (RGB levels) anywhere. */
function fromGaussian(frame: ArrayLike<number>, expected: ArrayLike<number>) {
  let most = 0;
  for (let i = 0; i < expected.length; i++) most = Math.max(most, Math.abs(frame[Math.floor(i / 3) * 4 + (i % 3)] - expected[i]));
  return most;
}

/**
 * Whether a lens of defocus 0 draws the frame drawn without one exactly, and a defocused frame, at rest and scaled, is
 * the CPU's gaussian of its sharp frame in linear light within tolerance (and not the sharp frame: the blur must show).
 */
export function checkStampGateDefocus({ sharp, zero, blurred, scaledSharp, scaledBlurred }: Record<'sharp' | 'zero' | 'blurred' | 'scaledSharp' | 'scaledBlurred', ArrayLike<number>>): StampGateWashCheck {
  const none = stampGateFrameDifference(sharp, zero);
  // The renderer holds a picture's sigma to its steps, so the frame's is the step nearest the sigma over the scale, rescaled.
  const frameSigma = (scale: number) => scale * lensSigmaStepped(STAMP_GATE_DEFOCUS_SIGMA / scale);
  const still = fromGaussian(blurred, linearGaussian(sharp, frameSigma(1)));
  const scaled = fromGaussian(scaledBlurred, linearGaussian(scaledSharp, frameSigma(STAMP_GATE_DEFOCUS_SCALE)));
  const shown = stampGateFrameDifference(sharp, blurred).max;
  return {
    id: `lens/defocus: a defocus is a ${STAMP_GATE_DEFOCUS_SIGMA} px gaussian in linear light, at rest or scaled, and none at 0`,
    passed: none.max === 0 && still <= STAMP_GATE_DEFOCUS_TOLERANCE && scaled <= STAMP_GATE_DEFOCUS_TOLERANCE && shown > 40,
    detail: `defocus 0 against no lens: max ${none.max} (past 0 fails); at rest against the CPU's gaussian: max ${still.toFixed(2)} (past ${STAMP_GATE_DEFOCUS_TOLERANCE} fails); `
      + `seen ×${STAMP_GATE_DEFOCUS_SCALE}: max ${scaled.toFixed(2)} (past ${STAMP_GATE_DEFOCUS_TOLERANCE} fails); blurred against sharp: max ${shown} (40 or under fails)`,
  };
}

/** The glow case's glow: the threshold its pale patch's light is past and its grey patch's isn't. */
export const STAMP_GATE_GLOW: StampGroupGlow = { amount: 1, threshold: 0.5 };
/** The glow case's bloom, frame px. */
export const STAMP_GATE_BLOOM = 5;
const GLOW_PALE = { x0: 20, x1: 60, y0: 30, y1: 70 }, GLOW_GREY = { x0: 100, x1: 140, y0: 30, y1: 70 };
/** How far past the pale patch the spill is read, px. */
const GLOW_SPILL = 4;
/** Where the cover's grey, moved onto the pale patch, hides it: the pale patch and past its flood's soft edge. */
const GLOW_COVER = { x0: GLOW_PALE.x0 - 4, x1: GLOW_PALE.x1 + 4, y0: GLOW_PALE.y0 - 4, y1: GLOW_PALE.y1 + 4 };

type Box = typeof GLOW_PALE;
const block = ({ x0, x1, y0, y1 }: Box) => stampGatePolygon(x0, y0, x1, y0, x1, y1, x0, y1);

/** A dark ground, a pale patch and a grey one over it (each a group), and a mark the frame state moves. */
export function stampGateGlowPainting(): StampGatePainting {
  const brush = stampGateBrush('Glow', { flow: 1 });
  const fill = (color: `#${string}`, region: ReturnType<typeof block>) => ({ brush, size: 6, application: { kind: 'flood' as const }, well: { paint: { kind: 'color' as const, color } }, region });
  const painting = compileStampPaintRecipe(stampPaintRecipe(LENS_FLAT, (p) => {
    p.group('ground', { composite: 'opaque' }, (g) => g.passage('p', {}, (pass) => pass.fill('ground', fill('#20242c', block({ x0: -10, x1: 170, y0: -10, y1: 110 })))));
    p.group('pale', { composite: 'opaque' }, (g) => g.passage('p', {}, (pass) => pass.fill('pale', fill('#f4e6a8', block(GLOW_PALE)))));
    p.group('grey', { composite: 'opaque' }, (g) => g.passage('p', {}, (pass) => pass.fill('grey', fill('#5c646c', block(GLOW_GREY)))));
    p.group('mark', { composite: 'opaque' }, (g) => g.passage('p', {}, (pass) => pass.fill('mark', fill('#40506a', block({ x0: 70, x1: 90, y0: 80, y1: 92 })))));
  }));
  return { painting, ...LENS_SIZE, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

/** The glow case's lens: every plane at rest and sharp, blooming by STAMP_GATE_BLOOM. */
export const STAMP_GATE_GLOW_LENS: StampLensFrame = { planes: new Map([[STAMP_SINGLE_PLANE_ID, STAMP_GATE_REST_LOOK]]), bloom: STAMP_GATE_BLOOM, focus: null, moving: false };

const moved = (x: number) => ({ lay: { placement: { x, y: 0, rotation: 0, scale: 1 }, pivot: { x: 0, y: 0 } } });

/** The glow case's frame state: `glowing` groups at `glow`, the mark moved `markX` px, the grey moved `greyX` px. */
export function stampGateGlowState(glowing: readonly ('pale' | 'grey')[], markX: number, { glow = STAMP_GATE_GLOW, greyX = 0 }: { glow?: StampGroupGlow; greyX?: number } = {}): StampPaintFrameState {
  const states = new Map<string, object>(glowing.map((id) => [id, { glow }]));
  states.set('mark', moved(markX));
  if (greyX) states.set('grey', { ...states.get('grey'), ...moved(greyX) });
  return states;
}

/** How far the covered frames move the grey patch: onto the pale one. */
export const STAMP_GATE_GLOW_COVER_X = GLOW_PALE.x0 - GLOW_GREY.x0;

/**
 * The glow painting as two planes: the back holds the ground, pale patch and mark; a nearer one, the grey patch, whose
 * opaque paint, moved onto the pale by STAMP_GATE_GLOW_COVER_X, covers it.
 */
export function stampGateGlowCoverPlanes(painting: CompiledStampPaint): StampLaidPlanes {
  const problems: string[] = [];
  const planes = stampScenePlanes(painting, [
    { id: 'back', depth: 1, source: { kind: 'painted', groups: ['ground', 'pale', 'mark'] } },
    { id: 'cover', depth: 0.8, source: { kind: 'painted', groups: ['grey'] } },
  ], problems);
  if (!planes || problems.length) throw new Error(`stamp gate: the glow's planes: ${problems.join('; ')}`);
  return planes;
}

const WHOLE_FRAME: Box = { x0: 0, x1: LENS_SIZE.width, y0: 0, y1: LENS_SIZE.height };

/** The least and most a frame's RGB rises over `base`'s within `within`, and the most it rises within `box` grown by `by`, not inside it. */
function rise(frame: ArrayLike<number>, base: ArrayLike<number>, { box, by = 0, within = WHOLE_FRAME }: { box?: Box; by?: number; within?: Box } = {}) {
  let least = 0, most = 0, around = 0;
  for (let y = within.y0; y < within.y1; y++) for (let x = within.x0; x < within.x1; x++) for (let c = 0; c < 3; c++) {
    const i = (y * LENS_SIZE.width + x) * 4 + c, d = frame[i] - base[i];
    least = Math.min(least, d);
    most = Math.max(most, d);
    const inside = box && x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1;
    const near = box && x >= box.x0 - by && x < box.x1 + by && y >= box.y0 - by && y < box.y1 + by;
    if (near && !inside) around = Math.max(around, d);
  }
  return { least, most, around };
}

/**
 * Whether a glow adds light only past its threshold (the pale patch brightens and spills, darkening nothing; the grey
 * changes nothing), none at amount 0, none under opaque paint laid after it (`onSheet` against `onSheetDim`) or
 * nearer, and draws the same frame again from its picture, and after a frame moving the mark.
 */
export function checkStampGateGlow({ plain, grey, zero, pale, paleAgain, paleAfterMove, paleFresh, covered, coveredPlain, onSheet, onSheetDim }: Record<
  'plain' | 'grey' | 'zero' | 'pale' | 'paleAgain' | 'paleAfterMove' | 'paleFresh' | 'covered' | 'coveredPlain' | 'onSheet' | 'onSheetDim', ArrayLike<number>
>): StampGateWashCheck {
  // With nothing glowing, one plane at rest is output as painted; anything glowing goes round linear light and the
  // planes' composite, which rounds a level differently here and there. So grey glowing may sit a level off plain,
  // and the pale patch's rise is read over the grey frame, drawn the same way.
  const dim = stampGateFrameDifference(plain, grey), none = stampGateFrameDifference(plain, zero);
  const lit = rise(pale, grey, { box: GLOW_PALE, by: GLOW_SPILL });
  const again: StampGateFrameDifference = stampGateFrameDifference(pale, paleAgain), shifted = stampGateFrameDifference(paleFresh, paleAfterMove);
  // The bloom spreads what glows past the cover's edge into it, so the cover is read only past the bloom's reach.
  const reach = lensGaussianReach(STAMP_GATE_BLOOM);
  const inside = { x0: GLOW_COVER.x0 + reach, x1: GLOW_COVER.x1 - reach, y0: GLOW_COVER.y0 + reach, y1: GLOW_COVER.y1 - reach };
  const under = rise(covered, coveredPlain, { within: inside }), laidOver = rise(onSheet, onSheetDim, { within: inside });
  return {
    id: 'lens/glow: a glow adds light past its threshold alone, none at amount 0 or under opaque paint laid after it or nearer, and keeps through the picture cache',
    passed: dim.max <= 1 && none.max === 0 && lit.least >= 0 && lit.most >= 20 && lit.around >= 8 && under.most <= 1 && laidOver.most === 0 && again.max === 0 && shifted.max === 0,
    detail: `grey patch (under the threshold) glowing, through the planes' composite, against none, as painted: max ${dim.max} (past 1 fails); amount 0: max ${none.max} (past 0 fails); `
      + `pale patch glowing: rises ${lit.most} at most (under 20 fails), ${lit.around} within ${GLOW_SPILL} px past it (under 8 fails), least ${lit.least} (under 0 fails); `
      + `pale glowing under a nearer plane's paint, ${reach} px in from its edge: rises ${under.most} at most (past 1 fails); `
      + `under opaque paint laid after it on its own plane: rises ${laidOver.most} at most (past 0 fails); `
      + `drawn again from its picture: max ${again.max}; after a frame moving the mark against fresh: max ${shifted.max} (past 0 fails)`,
  };
}
