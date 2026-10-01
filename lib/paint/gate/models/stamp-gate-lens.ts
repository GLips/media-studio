// stamp-gate-lens.ts: the gate's lens cases, what a frame state's defocus and glow do to a laid group or outside layer
// (stamp-paint-defocus-glow.ts). A defocus is held to a gaussian worked out here on the CPU; a glow to adding light
// only past its threshold, nothing at amount 0, and the same frame when a checkpoint holding its light is restored.

import { stampGaussianReach } from '#lib/paint/painting/models/stamp-defocus.ts';
import { compileStampPaintRecipe, stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampGroupGlow, StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { STAMP_GATE_IMAGES, STAMP_GATE_WHITE, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import { stampGateFrameDifference, type StampGateFrameDifference } from './stamp-gate-frames.ts';
import type { StampGateWashCheck } from './stamp-gate-washes.ts';

export const STAMP_GATE_LENS_IDS = ['lens/defocus', 'lens/glow', 'lens/outside'];

const LENS_SIZE = { width: 160, height: 100 };
/** The defocus case's blur, stage px, and the scale it's also laid at: its layer then blurs by the blur over it. */
export const STAMP_GATE_DEFOCUS_SIGMA = 4;
export const STAMP_GATE_DEFOCUS_SCALE = 1.5;
/**
 * How far a defocused frame may sit from the CPU's gaussian of the sharp one, levels: each frame's dither and
 * rounding. Laid scaled, the layer's gaussian then the lay's bilinear upscale stand for the stage's gaussian of the
 * upscaled frame, close but not exact.
 */
export const STAMP_GATE_DEFOCUS_TOLERANCE = 2;

/**
 * Strokes of flat colour glazed in the middle of plain white paper, well clear of the frame's edges: laid by glaze,
 * a frame is linear in the layer, so the layer's gaussian is the frame's, round the paper's white.
 */
export function stampGateDefocusPainting(): StampGatePainting {
  const brush = stampGateBrush('Defocus', { flow: 0.8 });
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('patch', { composite: 'glaze', opacity: 1 }, (g) => g.pass('p', {}, (pass) => {
      pass.stroke('red', { brush, diameter: 12, material: { kind: 'color', color: '#c0302a' }, path: [{ x: 52, y: 38 }, { x: 108, y: 42 }] });
      pass.stroke('blue', { brush, diameter: 8, material: { kind: 'color', color: '#203a8a' }, path: [{ x: 60, y: 62 }, { x: 100, y: 56 }] });
    }));
  }));
  return { painting, paper: STAMP_GATE_WHITE, mixing: { kind: 'flat' }, ...LENS_SIZE, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

/** The defocus case's frame state: `blur` (none left out) and the lay's `scale` about the frame's centre. */
export function stampGateDefocusState(blur: number | undefined, scale = 1): StampPaintFrameState {
  const lay = scale === 1 ? {} : { lay: { placement: { x: 0, y: 0, rotation: 0, scale }, pivot: { x: LENS_SIZE.width / 2, y: LENS_SIZE.height / 2 } } };
  return new Map([['patch', { ...lay, ...(blur !== undefined && { blur }) }]]);
}

/**
 * A separable gaussian of `sigma` px over `channels` interleaved channels of a `width` × `height` image, round
 * `ground` (what lies past the image), weighted as the renderer weighs it: over three sigmas, normalised over every tap.
 */
export function stampGateGaussian(values: ArrayLike<number>, width: number, height: number, channels: number, sigma: number, ground: number): Float64Array {
  const reach = stampGaussianReach(sigma), weights = Array.from({ length: 2 * reach + 1 }, (_, k) => Math.exp(-0.5 * ((k - reach) ** 2) / (sigma * sigma)));
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

/** The most an RGBA frame's RGB sits from `expected` (RGBA, levels) anywhere, and how much it differs from `sharp` at most. */
function fromGaussian(frame: ArrayLike<number>, expected: ArrayLike<number>) {
  let most = 0;
  for (let i = 0; i < frame.length; i++) if (i % 4 !== 3) most = Math.max(most, Math.abs(frame[i] - expected[i]));
  return most;
}

/**
 * Whether a blur of 0 draws the sharp frame exactly, and a blurred frame, still and laid scaled, is the CPU's gaussian
 * of its sharp frame within tolerance (and not the sharp frame: the blur must show).
 */
export function checkStampGateDefocus({ sharp, zero, blurred, scaledSharp, scaledBlurred }: Record<'sharp' | 'zero' | 'blurred' | 'scaledSharp' | 'scaledBlurred', ArrayLike<number>>): StampGateWashCheck {
  const { width, height } = LENS_SIZE;
  const none = stampGateFrameDifference(sharp, zero);
  const still = fromGaussian(blurred, stampGateGaussian(sharp, width, height, 4, STAMP_GATE_DEFOCUS_SIGMA, 255));
  const scaled = fromGaussian(scaledBlurred, stampGateGaussian(scaledSharp, width, height, 4, STAMP_GATE_DEFOCUS_SIGMA, 255));
  const shown = stampGateFrameDifference(sharp, blurred).max;
  return {
    id: `lens/defocus: a defocus is a ${STAMP_GATE_DEFOCUS_SIGMA} px gaussian on the stage, laid still or scaled, and none at 0`,
    passed: none.max === 0 && still <= STAMP_GATE_DEFOCUS_TOLERANCE && scaled <= STAMP_GATE_DEFOCUS_TOLERANCE && shown > 40,
    detail: `blur 0 against none: max ${none.max} (past 0 fails); still against the CPU's gaussian: max ${still.toFixed(2)} (past ${STAMP_GATE_DEFOCUS_TOLERANCE} fails); `
      + `laid ×${STAMP_GATE_DEFOCUS_SCALE}: max ${scaled.toFixed(2)} (past ${STAMP_GATE_DEFOCUS_TOLERANCE} fails); blurred against sharp: max ${shown} (40 or under fails)`,
  };
}

/** The glow case's glow, and the threshold its pale patch's light is past and its grey patch's isn't. */
export const STAMP_GATE_GLOW: StampGroupGlow = { amount: 1, radius: 5, threshold: 0.5 };
const GLOW_PALE = { x0: 20, x1: 60, y0: 30, y1: 70 }, GLOW_GREY = { x0: 100, x1: 140, y0: 30, y1: 70 };
/** How far past the pale patch the spill is read, px. */
const GLOW_SPILL = 4;

const block = ({ x0, x1, y0, y1 }: typeof GLOW_PALE) => stampGatePolygon(x0, y0, x1, y0, x1, y1, x0, y1);

/** A dark ground, a pale patch and a grey one over it (each a group), and a mark the frame state moves. */
export function stampGateGlowPainting(): StampGatePainting {
  const brush = stampGateBrush('Glow', { flow: 1 });
  const fill = (color: `#${string}`, region: ReturnType<typeof block>) => ({ brush, diameter: 6, application: { kind: 'flood' as const }, material: { kind: 'color' as const, color }, region });
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('ground', { composite: 'opaque' }, (g) => g.pass('p', {}, (pass) => pass.fill('ground', fill('#20242c', block({ x0: -10, x1: 170, y0: -10, y1: 110 })))));
    p.group('pale', { composite: 'opaque' }, (g) => g.pass('p', {}, (pass) => pass.fill('pale', fill('#f4e6a8', block(GLOW_PALE)))));
    p.group('grey', { composite: 'opaque' }, (g) => g.pass('p', {}, (pass) => pass.fill('grey', fill('#5c646c', block(GLOW_GREY)))));
    p.group('mark', { composite: 'opaque' }, (g) => g.pass('p', {}, (pass) => pass.fill('mark', fill('#40506a', block({ x0: 70, x1: 90, y0: 80, y1: 92 })))));
  }));
  return { painting, paper: STAMP_GATE_WHITE, mixing: { kind: 'flat' }, ...LENS_SIZE, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

/** The glow case's frame state: `glowing` groups at `glow`, the mark moved `markX` px. */
export function stampGateGlowState(glowing: readonly ('pale' | 'grey')[], markX: number, glow: StampGroupGlow = STAMP_GATE_GLOW): StampPaintFrameState {
  return new Map<string, object>([
    ...glowing.map((id) => [id, { glow }] as const),
    ['mark', { lay: { placement: { x: markX, y: 0, rotation: 0, scale: 1 }, pivot: { x: 0, y: 0 } } }],
  ]);
}

/** The least and most a frame's RGB rises over `base`'s anywhere, and the most it rises within `box` grown by `by`, not inside it. */
function rise(frame: ArrayLike<number>, base: ArrayLike<number>, box?: typeof GLOW_PALE, by = 0) {
  let least = 0, most = 0, around = 0;
  for (let y = 0; y < LENS_SIZE.height; y++) for (let x = 0; x < LENS_SIZE.width; x++) for (let c = 0; c < 3; c++) {
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
 * Whether a glow adds light only past its threshold (the grey patch glowing changes nothing; the pale one brightens
 * itself and spills past its edge, darkening nothing), changes nothing at amount 0, and draws the same frame again
 * from the checkpoint that holds its light, and after a frame moving the mark.
 */
export function checkStampGateGlow({ plain, grey, zero, pale, paleAgain, paleAfterMove, paleFresh }: Record<'plain' | 'grey' | 'zero' | 'pale' | 'paleAgain' | 'paleAfterMove' | 'paleFresh', ArrayLike<number>>): StampGateWashCheck {
  const dim = stampGateFrameDifference(plain, grey), none = stampGateFrameDifference(plain, zero);
  const lit = rise(pale, plain, GLOW_PALE, GLOW_SPILL);
  const again: StampGateFrameDifference = stampGateFrameDifference(pale, paleAgain), moved = stampGateFrameDifference(paleFresh, paleAfterMove);
  return {
    id: `lens/glow: a glow adds light past its threshold alone, none at amount 0, and keeps through a checkpoint`,
    passed: dim.max === 0 && none.max === 0 && lit.least >= 0 && lit.most >= 20 && lit.around >= 8 && again.max === 0 && moved.max === 0,
    detail: `grey patch (under the threshold) glowing: max ${dim.max}; amount 0: max ${none.max} (past 0 fails); pale patch glowing: rises ${lit.most} at most `
      + `(under 20 fails), ${lit.around} within ${GLOW_SPILL} px past it (under 8 fails), least ${lit.least} (under 0 fails); `
      + `drawn again from its checkpoint: max ${again.max}; after a frame moving the mark against fresh: max ${moved.max} (past 0 fails)`,
  };
}

/** The outside layer's blur in the lens case, px. */
export const STAMP_GATE_OUTSIDE_BLUR = 3;

/**
 * Whether an outside layer blurred on the GPU lays as its content blurred on the CPU and laid sharp, within a defocus's
 * tolerance, and its glow adds light without darkening anything.
 */
export function checkStampGateOutsideLens({ blurred, cpuBlurred, sharp, glowing }: Record<'blurred' | 'cpuBlurred' | 'sharp' | 'glowing', ArrayLike<number>>): StampGateWashCheck {
  const twin = stampGateFrameDifference(blurred, cpuBlurred), shown = stampGateFrameDifference(sharp, blurred);
  let least = 0, most = 0;
  for (let i = 0; i < sharp.length; i++) if (i % 4 !== 3) {
    least = Math.min(least, glowing[i] - sharp[i]);
    most = Math.max(most, glowing[i] - sharp[i]);
  }
  return {
    id: 'lens/outside: an outside layer defocuses and glows as a group does',
    passed: twin.max <= STAMP_GATE_DEFOCUS_TOLERANCE && shown.max > 40 && least >= 0 && most >= 8,
    detail: `blurred ${STAMP_GATE_OUTSIDE_BLUR} px against its content blurred on the CPU: max ${twin.max} (past ${STAMP_GATE_DEFOCUS_TOLERANCE} fails), against sharp ${shown.max} (40 or under fails); `
      + `glowing rises ${most} at most (under 8 fails), least ${least} (under 0 fails)`,
  };
}
